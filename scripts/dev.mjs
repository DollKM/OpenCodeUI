import { spawn, exec } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const BACKEND_PORT = 4096;

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
 * Find the PID of the process listening on the given TCP port (Windows).
 * Returns null if no process found or on error.
 */
async function getPidByPort(port) {
  try {
    const { stdout } = await execAsync(
      `netstat -ano -p tcp | findstr ":${port} "`
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const match = line.trim().match(/(\d+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        if (!isNaN(pid)) return pid;
      }
    }
  } catch {
    // netstat / findstr not available or no matches
  }
  return null;
}

/**
 * Check whether a process with the given PID is still alive (Windows).
 */
async function isPidAlive(pid) {
  try {
    const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /NH`);
    return !stdout.includes('No tasks');
  } catch {
    return false;
  }
}

async function main() {
  const alreadyRunning = await isPortInUse(BACKEND_PORT);

  let backendProc = null;
  let needToStartBackend = false;
  let backendArgs = [];

  if (alreadyRunning) {
    const pid = await getPidByPort(BACKEND_PORT);
    if (pid !== null && await isPidAlive(pid)) {
      console.log(`  ✓ Port ${BACKEND_PORT} already in use (PID ${pid}) — skipping opencode serve`);
    } else {
      console.log(`  ◆ Port ${BACKEND_PORT} is stale (TCP residual) — starting opencode serve with explicit port`);
      needToStartBackend = true;
      backendArgs = ['serve', '--hostname', '0.0.0.0', '--port', String(BACKEND_PORT)];
    }
  } else {
    console.log(`  ◆ Starting opencode serve on port ${BACKEND_PORT}...`);
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
      await waitForPort(BACKEND_PORT);
      console.log('  ✓ opencode serve is ready');
    } catch {
      console.error('  ✗ Timed out waiting for opencode serve');
    }
  }

  const viteProc = spawn('npx', ['vite', '--host', '0.0.0.0'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
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
