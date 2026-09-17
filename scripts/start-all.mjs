import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// Optional companions (e.g. the local recognition service) get ONE bounded
// supervised restart: a native crash (Windows 0xC0000005) kills the Python
// process in a way Python cannot catch, and the service itself recovers on
// the next start (crash journal -> provider demotion -> CPU). The bound
// (max restarts within a window) guarantees we never restart-loop an
// unstable service: after the budget is spent it stays down and the site
// keeps running on the browser pipeline, as before.
const RESTART_MAX = 2;
const RESTART_WINDOW_MS = 10 * 60_000;
const RESTART_COOLDOWN_MS = 5_000;

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
  const launch = (command, index) => {
    const bin = command.bin ?? process.execPath;
    const child = spawn(bin, command.args, { cwd: command.cwd, stdio: 'inherit', detached: process.platform !== 'win32' });
    children[index] = child;
    child.once('error', error => { console.error(error.message); void stop(1); });
    if (command.optional) {
      // Optional companions may die alone: the site degrades to the in-browser
      // pipeline instead of taking everything down. A bounded restart gives a
      // natively-crashed recognition service one chance to recover on CPU.
      const restarts = [];
      child.once('exit', code => {
        if (stopping) return;
        const label = command.label ?? bin;
        const now = Date.now();
        while (restarts.length && now - restarts[0] > RESTART_WINDOW_MS) restarts.shift();
        if (restarts.length < RESTART_MAX) {
          restarts.push(now);
          console.error(`[start] ${label} saiu (code ${code}); reiniciando em ${RESTART_COOLDOWN_MS / 1000}s ` +
            `(${restarts.length}/${RESTART_MAX} em 10 min)…`);
          setTimeout(() => {
            if (!stopping) launch(command, index);
          }, RESTART_COOLDOWN_MS);
        } else {
          console.error(`[start] ${label} saiu (code ${code}) e esgotou os reinícios ` +
            `(${RESTART_MAX} em 10 min); continuando sem ele. ` +
            `Rode "python recognition/scripts/benchmark_runtime.py" para investigar o provider.`);
        }
      });
    } else {
      child.once('exit', code => { if (!stopping) void stop(code || 1); });
    }
  };
  commands.forEach((command, index) => launch(command, index));
  return { children, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    for (const file of ['.next/BUILD_ID', 'node_modules/next/dist/bin/next', 'bot/.env', 'bot/node_modules/@whiskeysockets/baileys/package.json']) {
      try { await access(path.join(root, file)); }
      catch { throw new Error(`Ausente: ${file}. Execute npm.cmd ci, npm.cmd --prefix bot ci e npm.cmd run build; configure bot/.env.`); }
    }
    const commands = [
      { cwd: root, args: [path.join(root, 'node_modules/next/dist/bin/next'), 'start', ...process.argv.slice(2)] },
      { cwd: path.join(root, 'bot'), args: ['--env-file=.env', 'service.mjs'] },
    ];
    // Local recognition service (optional): two-route pipeline (visual + OCR).
    // Not installed -> the site silently uses the in-browser fallback pipeline.
    const isWindows = process.platform === 'win32';
    const venvPython = path.join(root, 'recognition', '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
    try {
      await access(venvPython);
      commands.push({
        cwd: path.join(root, 'recognition'),
        bin: venvPython,
        args: [path.join(root, 'recognition', 'recognition_server.py'), '--preload'],
        optional: true,
        label: 'reconhecimento local',
      });
      console.log('[start] serviço de reconhecimento local incluído (127.0.0.1:8765)');
    } catch {
      console.log('[start] reconhecimento local não instalado — rode npm run recognition:install (o site usará o pipeline do navegador)');
    }
    startAll(commands);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
