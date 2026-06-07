import { spawn, exec } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const DEFAULT_PORT = 4096;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port++) {
    if (!(await isPortInUse(port))) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function waitForPort(port, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const server = createServer();
      server.once('error', () => resolve());
      server.once('listening', () => {
        server.close();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(check, 300);
        }
      });
      server.listen(port, '127.0.0.1');
    };
    check();
  });
}

/**
 * Find the process (PID + name) listening on the given TCP port (Windows).
 * Uses PowerShell's Get-NetTCPConnection for reliable output parsing,
 * then resolves the process name via Get-Process.
 * Returns { pid, name } or null if no process found.
 */
async function getProcessByPort(port) {
  try {
    // Step 1: get PID via PowerShell (more reliable than netstat parsing)
    const { stdout: pidOut } = await execAsync(
      `powershell -NoProfile -Command "& { try { $p=Get-NetTCPConnection -LocalPort ${port} -ErrorAction Stop; $p.OwningProcess } catch { exit 1 } }"`
    );
    const pid = parseInt(pidOut.trim(), 10);
    if (isNaN(pid) || pid === 0) return null;

    // Step 2: verify the process is still alive and get its name
    const { stdout: nameOut } = await execAsync(
      `powershell -NoProfile -Command "& { try { $p=Get-Process -Id ${pid} -ErrorAction Stop; $p.ProcessName } catch { exit 1 } }"`
    );
    const name = nameOut.trim().toLowerCase().replace('.exe', '');
    if (!name) return null;

    return { pid, name };
  } catch {
    // Fallback to netstat if PowerShell method fails
    try {
      const { stdout } = await execAsync(
        `netstat -ano -p tcp | findstr ":${port} "`
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const rawPid = parts[parts.length - 1];
        const pid = parseInt(rawPid, 10);
        if (!isNaN(pid) && pid !== 0) {
          // Try to get process name via tasklist
          try {
            const { stdout: tlOut } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`);
            const name = tlOut.trim().split(',')[0]?.replace(/"/g, '').toLowerCase().replace('.exe', '');
            return { pid, name: name || 'unknown' };
          } catch {
            return { pid, name: 'unknown' };
          }
        }
      }
    } catch {
      // netstat unavailable or no matches
    }
    return null;
  }
}

async function main() {
  // 打印 opencode 版本信息
  try {
    const { stdout } = await execAsync('opencode --version')
    console.log(`  ◇ opencode ${stdout.trim()}`)
  } catch {
    console.log('  ◇ opencode — 无法获取版本信息')
  }

  const alreadyRunning = await isPortInUse(DEFAULT_PORT);

  let backendProc = null;
  let needToStartBackend = false;
  let backendArgs = [];
  let backendPort = DEFAULT_PORT;

  if (alreadyRunning) {
    const procInfo = await getProcessByPort(DEFAULT_PORT);
    if (procInfo && procInfo.name === 'opencode') {
      console.log(`  ✓ Port ${DEFAULT_PORT} already in use (PID ${procInfo.pid}) — skipping opencode serve`);
    } else if (procInfo) {
      // Port is occupied by another program — find next available port
      console.log(`  ◆ Port ${DEFAULT_PORT} is occupied by "${procInfo.name}" (PID ${procInfo.pid}) — finding next available port`);
      backendPort = await findAvailablePort(DEFAULT_PORT + 1);
      console.log(`  ◆ Starting opencode serve on port ${backendPort}...`);
      needToStartBackend = true;
      backendArgs = ['serve', '--hostname', '0.0.0.0', '--port', String(backendPort)];
    } else {
      // Stale TCP residual (TIME_WAIT) — find next available port
      backendPort = await findAvailablePort(DEFAULT_PORT + 1);
      console.log(`  ◆ Port ${DEFAULT_PORT} is stale (TIME_WAIT) — starting opencode serve on port ${backendPort}`);
      needToStartBackend = true;
      backendArgs = ['serve', '--hostname', '0.0.0.0', '--port', String(backendPort)];
    }
  } else {
    console.log(`  ◆ Starting opencode serve on port ${DEFAULT_PORT}...`);
    needToStartBackend = true;
    backendArgs = ['serve', '--hostname', '0.0.0.0'];
  }

  if (needToStartBackend) {
    backendProc = spawn('opencode', backendArgs, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env },
    });
    backendProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`  ✗ opencode serve exited with code ${code}`);
      }
    });
    try {
      await waitForPort(backendPort);
      console.log('  ✓ opencode serve is ready');
    } catch {
      console.error('  ✗ Timed out waiting for opencode serve');
    }
  }

  const viteProc = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', '5173'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_OPENCODE_PORT: String(backendPort),
    },
  });

  viteProc.on('close', (code) => {
    if (backendProc) {
      backendProc.kill();
    }
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    if (backendProc) {
      backendProc.kill();
    }
    process.exit(0);
  });
}

main();
