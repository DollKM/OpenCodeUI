import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

async function main() {
  const alreadyRunning = await isPortInUse(BACKEND_PORT);

  let backendProc = null;

  if (alreadyRunning) {
    console.log(`  ✓ Port ${BACKEND_PORT} already in use — skipping opencode serve`);
  } else {
    console.log(`  ◆ Starting opencode serve on port ${BACKEND_PORT}...`);
    backendProc = spawn('opencode', ['serve', '--hostname', '0.0.0.0'], {
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
