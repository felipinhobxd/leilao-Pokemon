import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export function startAll(commands) {
  const children = [];
  let stopping;
  const stop = (code = 0) => stopping ??= (async () => {
    await Promise.all(children.map(child => new Promise(resolve => {
      if (!child.pid) return resolve();
      if (process.platform === 'win32') {
        // Node's Windows SIGTERM kills only the parent. Kill the complete owned tree.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.once('error', resolve);
        killer.once('exit', resolve);
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        // Keep the process-group kill even if the supervisor exits first.
        const timer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          resolve();
        }, 6000);
        timer.unref();
        child.once('close', () => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          clearTimeout(timer); resolve();
        });
        if (child.exitCode !== null || child.signalCode !== null) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          clearTimeout(timer); resolve();
        }
      }
    })));
    process.exitCode = code;
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  })();
  const onInterrupt = () => void stop(0);
  const onTerminate = () => void stop(0);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  for (const command of commands) {
    const child = spawn(process.execPath, command.args, { cwd: command.cwd, stdio: 'inherit', detached: process.platform !== 'win32' });
    children.push(child);
    child.once('error', error => { console.error(error.message); void stop(1); });
    child.once('exit', code => { if (!stopping) void stop(code || 1); });
  }
  return { children, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    for (const file of ['.next/BUILD_ID', 'node_modules/next/dist/bin/next', 'bot/.env', 'bot/node_modules/@whiskeysockets/baileys/package.json']) {
      try { await access(path.join(root, file)); }
      catch { throw new Error(`Ausente: ${file}. Execute npm.cmd ci, npm.cmd --prefix bot ci e npm.cmd run build; configure bot/.env.`); }
    }
    startAll([
      { cwd: root, args: [path.join(root, 'node_modules/next/dist/bin/next'), 'start', ...process.argv.slice(2)] },
      { cwd: path.join(root, 'bot'), args: ['--env-file=.env', 'service.mjs'] },
    ]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
