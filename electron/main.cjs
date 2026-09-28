// LEILÃO POKÉMON — Desktop (Electron)
// O instalador traz o Next.js standalone já compilado. O primeiro uso NÃO
// executa `next build`: o aplicativo só sobe a stack local e abre a UI.
const { app, BrowserWindow, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = Number(process.env.LEILAO_DESKTOP_PORT || 3000);
let mainWindow = null;
let stackProcess = null;

const BUNDLED_ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
const isElectron = Boolean(process.versions.electron);
const bundledNodeBin = app.isPackaged && process.platform === "win32"
  ? path.join(process.resourcesPath, "node", "node.exe")
  : null;
const nodeBin = bundledNodeBin || (isElectron ? process.execPath : "node");

function startupLogFile() {
  const configured = String(process.env.LEILAO_DESKTOP_LOG_FILE ?? "").trim();
  if (configured) return configured;
  try { return path.join(app.getPath("logs"), "desktop-startup.log"); } catch { return null; }
}

function startupLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    const file = startupLogFile();
    if (file) fs.appendFileSync(file, line + "\n", "utf8");
  } catch {}
}

// The desktop panel is an embedded Chromium renderer. Hardware acceleration
// can produce a blank white surface on some Windows GPU/driver combinations;
// the application is an admin dashboard, so reliable rendering is preferable.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

function readDotEnv(file) {
  try {
    const values = {};
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const content = line.startsWith("export ") ? line.slice(7).trim() : line;
      const separator = content.indexOf("=");
      if (separator <= 0) continue;
      const key = content.slice(0, separator).trim();
      let value = content.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

// Secrets configurados no build ficam no bot/.env do runtime empacotado.
// process.env tem prioridade para permitir override local sem recompilar.
const nodeEnv = {
  ...readDotEnv(path.join(BUNDLED_ROOT, "bot", ".env")),
  ...readDotEnv(path.join(BUNDLED_ROOT, ".env.local")),
  ...process.env,
  NODE_ENV: "production",
  LEILAO_DESKTOP_STANDALONE: "1",
  LEILAO_DESKTOP_PORT: String(PORT),
};
if (!bundledNodeBin && isElectron) nodeEnv.ELECTRON_RUN_AS_NODE = "1";

function isServerRunning() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/health`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3_000, () => { req.destroy(); resolve(false); });
  });
}

function waitForServer(timeoutMs = 180_000) {
  const started = Date.now();
  return new Promise(resolve => {
    const check = async () => {
      if (await isServerRunning()) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(check, 2_000);
    };
    check();
  });
}

function startStack() {
  const script = path.join(BUNDLED_ROOT, "scripts", "start-all.mjs");
  const standaloneServer = path.join(BUNDLED_ROOT, ".next", "standalone", "server.js");
  if (!fs.existsSync(script)) throw new Error("O launcher do aplicativo não foi encontrado.");
  if (!fs.existsSync(standaloneServer)) throw new Error("O instalador não contém o servidor Next.js standalone.");
  if (app.isPackaged && (!bundledNodeBin || !fs.existsSync(bundledNodeBin))) {
    throw new Error("O instalador não contém o runtime Node.js 24 necessário pelos serviços locais.");
  }
  startupLog("[stack] iniciando stack desktop via start-all.mjs");
  stackProcess = spawn(nodeBin, [script], {
    cwd: BUNDLED_ROOT,
    env: nodeEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = chunk => {
    const line = chunk.toString().trim();
    if (line) startupLog(`[stack] ${line}`);
  };
  stackProcess.stdout.on("data", log);
  stackProcess.stderr.on("data", log);
  stackProcess.on("error", error => startupLog(`[stack] erro: ${error?.message || error}`));
  stackProcess.on("exit", code => startupLog(`[stack] saiu (code ${code})`));
}

function killStack() {
  if (!stackProcess) return;
  try { stackProcess.kill("SIGTERM"); } catch {}
  const child = stackProcess;
  setTimeout(() => { try { if (child.exitCode === null) child.kill("SIGKILL"); } catch {} }, 3_000);
  stackProcess = null;
}

const htmlProgress = (title, sub) => `data:text/html;charset=utf-8,
  <body style="font-family:sans-serif;background:#1a1a2e;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="text-align:center;max-width:560px;padding:40px">
      <div style="font-size:48px;margin-bottom:16px">🦭</div>
      <h2 style="color:#e74c3c;margin:0 0 8px">${title}</h2>
      <p style="color:#aaa;font-size:14px">${sub}</p>
      <div style="width:300px;height:6px;background:#16213e;border-radius:3px;margin:20px auto;overflow:hidden">
        <div style="width:100%;height:100%;background:#e74c3c;border-radius:3px;animation:slide 2s infinite"></div>
      </div>
      <style>@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}</style>
    </div>
  </body>`;

const htmlError = msg => `data:text/html;charset=utf-8,
  <body style="font-family:sans-serif;background:#1a1a2e;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="text-align:center;max-width:620px;padding:40px">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <h2 style="color:#e74c3c;margin:0 0 10px">Falha ao iniciar</h2>
      <p style="color:#aaa;font-size:14px;line-height:1.5">${msg}</p>
      <p style="color:#777;font-size:13px;margin-top:20px">Clique em "Recarregar" para tentar novamente.</p>
    </div>
  </body>`;

const SMOKE_MODE = process.env.LEILAO_DESKTOP_SMOKE === "1";

async function runSmokeMode() {
  let smokeWindow = null;
  try {
    startupLog("[smoke] iniciando Chromium + runtime empacotado...");
    smokeWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      backgroundColor: "#0f1115",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindow = smokeWindow;

    startStack();

    const serverOk = await waitForServer(180_000);
    if (!serverOk) throw new Error("/api/health não respondeu em 3 minutos.");

    startupLog("[smoke] servidor Next respondeu. Carregando a UI no Chromium...");
    await smokeWindow.loadURL(`http://127.0.0.1:${PORT}/`);

    const state = await smokeWindow.webContents.executeJavaScript(
      \`(() => {
        const body = document.body;
        return {
          readyState: document.readyState,
          title: document.title,
          text: String(body?.innerText || "").trim(),
          htmlLength: body?.innerHTML?.length || 0,
        };
      })()\`,
      true,
    );

    if (state?.readyState !== "complete") throw new Error("Documento Electron não chegou a readyState=complete.");
    if (Number(state?.htmlLength) <= 500) throw new Error(`DOM muito pequeno: ${state?.htmlLength ?? 0} bytes.`);
    if (!String(state?.text || "").includes("Leilão Pokémon")) {
      throw new Error("Chromium carregou a página, mas o texto esperado não apareceu no DOM.");
    }

    startupLog(
      `[smoke] renderer OK: title="${state.title}", html=${state.htmlLength}, text=${state.text.length} chars.`,
    );

    try { smokeWindow.destroy(); } catch {}
    mainWindow = null;
    killStack();
    setTimeout(() => app.exit(0), 500);
  } catch (error) {
    startupLog(`[smoke] erro: ${error?.stack || error}`);
    try { smokeWindow?.destroy(); } catch {}
    mainWindow = null;
    killStack();
    setTimeout(() => app.exit(1), 500);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Leilão Pokémon",
    show: true,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "reload", label: "Recarregar" },
    { role: "quit", label: "Sair" },
  ]));

  mainWindow.maximize();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (mainWindow && !mainWindow.isDestroyed() && !validatedURL.startsWith("data:") && errorCode !== -3) {
      mainWindow.loadURL(htmlError(`Não foi possível carregar o painel (${errorCode}): ${errorDescription}`));
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(htmlError(`A interface fechou inesperadamente (${details.reason}). Clique em Recarregar.`));
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });

  // Carrega a UI de inicialização ANTES de qualquer await. Assim a janela
  // nunca fica presa em about:blank branco enquanto o servidor responde.
  void mainWindow.loadURL(htmlProgress("Iniciando o Leilão Pokémon…", "Abrindo o painel já preparado e os serviços locais."))
    .catch(error => console.error("[ui] falha ao carregar tela inicial:", error?.message || error));

  try {
    if (await isServerRunning()) {
      void mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
      return;
    }

    startStack();

    const ok = await waitForServer();
    if (ok && mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(htmlError("O servidor não respondeu. Abra novamente o Leilão Pokémon ou use Recarregar."));
    }
  } catch (error) {
    startupLog(`[init] erro: ${error?.stack || error}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(htmlError(String(error?.message || error)));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => SMOKE_MODE ? runSmokeMode() : createWindow());
}

app.on("window-all-closed", () => { killStack(); app.quit(); });
app.on("before-quit", () => killStack());
