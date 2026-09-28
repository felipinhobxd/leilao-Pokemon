// LEILÃO POKÉMON — Desktop (Electron)
// O instalador traz o Next.js standalone já compilado. O primeiro uso NÃO
// executa `next build`: o aplicativo só sobe a stack local e abre a UI.
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage } = require("electron");
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

let launching = false;

function desktopPublicConfig() {
  const candidates = [
    path.join(BUNDLED_ROOT, ".next", "standalone", "desktop-public-config.json"),
    path.join(BUNDLED_ROOT, "desktop-public-config.json"),
  ];
  for (const file of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && typeof value.url === "string") return value;
    } catch {}
  }
  return {
    url: String(process.env.NEXT_PUBLIC_SUPABASE_URL || ""),
    publishableKey: String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""),
  };
}

function desktopConfigFile() {
  return path.join(app.getPath("userData"), "desktop-secure-config.json");
}

function readDesktopSecret() {
  const envSecret = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (envSecret) return envSecret;
  try {
    const payload = JSON.parse(fs.readFileSync(desktopConfigFile(), "utf8"));
    if (!payload?.encryptedSecret || !safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(Buffer.from(payload.encryptedSecret, "base64")).trim();
  } catch {
    return "";
  }
}

function saveDesktopSecret(secret) {
  const value = String(secret || "").trim();
  if (value.length < 20) throw new Error("A chave secreta do Supabase parece inválida.");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("A criptografia segura do Windows não está disponível neste computador.");
  }
  fs.mkdirSync(path.dirname(desktopConfigFile()), { recursive: true });
  fs.writeFileSync(
    desktopConfigFile(),
    JSON.stringify({
      version: 1,
      provider: "windows-safe-storage",
      encryptedSecret: safeStorage.encryptString(value).toString("base64"),
      updatedAt: new Date().toISOString(),
    }, null, 2),
    "utf8",
  );
}

function buildNodeEnv() {
  const publicConfig = desktopPublicConfig();
  const secret = readDesktopSecret();
  const env = {
    ...readDotEnv(path.join(BUNDLED_ROOT, "bot", ".env")),
    ...readDotEnv(path.join(BUNDLED_ROOT, ".env.local")),
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || publicConfig.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || publicConfig.publishableKey,
    NODE_ENV: "production",
    LEILAO_DESKTOP_STANDALONE: "1",
    LEILAO_DESKTOP_PORT: String(PORT),
  };
  if (!env.SUPABASE_SERVICE_ROLE_KEY && secret) env.SUPABASE_SERVICE_ROLE_KEY = secret;
  if (!env.SUPABASE_SECRET_KEY && secret) env.SUPABASE_SECRET_KEY = secret;
  if (!env.SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL) env.SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  if (isElectron && !bundledNodeBin) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

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
    env: buildNodeEnv(),
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

const htmlSetup = config => {
  const project = String(config?.url || "").replace(/^https?:\/\//, "").replace(/\?.*$/, "") || "Supabase";
  const escapeHtml = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  return `data:text/html;charset=utf-8,
  <body style="font-family:Segoe UI,sans-serif;background:#0f1115;color:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <div style="width:min(620px,calc(100vw - 48px));padding:34px;border:1px solid #2b2f36;border-radius:18px;background:#171a20;box-shadow:0 20px 60px rgba(0,0,0,.35)">
      <div style="font-size:42px">🎴</div>
      <h1 style="margin:8px 0 6px">Configurar Leilão Pokémon</h1>
      <p style="color:#a1a1aa;line-height:1.55">Esta instalação usa o mesmo banco do painel web. Na primeira abertura, informe a chave secreta do Supabase. Ela fica criptografada pelo Windows e não é colocada dentro do instalador.</p>
      <p style="font-size:13px;color:#71717a;margin:12px 0 22px">Projeto: <b style="color:#d4d4d8">${escapeHtml(project)}</b></p>
      <label style="display:block;font-size:14px;font-weight:600;margin-bottom:8px">Chave secreta do Supabase</label>
      <input id="secret" type="password" autocomplete="off" spellcheck="false" placeholder="sb_secret_... ou service_role" style="box-sizing:border-box;width:100%;padding:13px 14px;border-radius:10px;border:1px solid #3f4652;background:#0f1115;color:#fff;font-size:14px">
      <button id="save" style="margin-top:16px;width:100%;padding:13px;border:0;border-radius:10px;background:#e74c3c;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Salvar e abrir painel</button>
      <p id="msg" style="min-height:20px;color:#fca5a5;font-size:13px;margin:12px 0 0"></p>
      <small style="color:#71717a;display:block;margin-top:18px;line-height:1.5">A chave é usada somente pelo servidor local e pelo bot do aplicativo.</small>
    </div>
    <script>
      const input=document.getElementById("secret");
      const button=document.getElementById("save");
      const msg=document.getElementById("msg");
      button.onclick=async()=>{
        button.disabled=true; msg.textContent="";
        try {
          await window.desktop.saveSecret(input.value);
          msg.style.color="#86efac";
          msg.textContent="Configuração salva. Abrindo o painel…";
        } catch (error) {
          msg.textContent=error?.message || "Não foi possível salvar a configuração.";
          button.disabled=false;
        }
      };
      input.addEventListener("keydown",event=>{if(event.key==="Enter")button.click();});
      input.focus();
    </script>
  </body>`;
};

async function launchConfiguredApp() {
  if (launching || !mainWindow || mainWindow.isDestroyed()) return;
  launching = true;
  try {
    const publicConfig = desktopPublicConfig();
    const secret = readDesktopSecret();

    if (app.isPackaged && (!publicConfig.url || !publicConfig.publishableKey || !secret)) {
      await mainWindow.loadURL(htmlSetup(publicConfig));
      return;
    }

    await mainWindow.loadURL(htmlProgress("Iniciando o Leilão Pokémon…", "Abrindo o painel e os serviços locais."));
    if (await isServerRunning()) {
      await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    } else {
      startStack();
      const ok = await waitForServer();
      if (ok && mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(htmlError("O servidor local não respondeu. Confira a configuração e tente novamente."));
        return;
      }
    }

    const rendered = await waitForRendererContent(20_000);
    if (!rendered && mainWindow && !mainWindow.isDestroyed()) {
      startupLog("[renderer] conteúdo vazio após a navegação.");
      await mainWindow.loadURL(htmlError(
        "O servidor respondeu, mas o painel não renderizou. Abra Recarregar para tentar novamente. O diagnóstico foi salvo no log."
      ));
    }
  } catch (error) {
    startupLog(`[init] erro: ${error?.stack || error}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(htmlError(String(error?.message || error)));
  } finally {
    launching = false;
  }
}

ipcMain.handle("desktop-config:save", async (_event, secret) => {
  saveDesktopSecret(secret);
  void launchConfiguredApp();
  return { ok: true };
});

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

async function waitForRendererContent(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    try {
      const state = await mainWindow.webContents.executeJavaScript(
        '(() => { const body = document.body; return { readyState: document.readyState, title: document.title, text: String(body?.innerText || "").trim(), htmlLength: body?.innerHTML?.length || 0 }; })()',
        true,
      );
      if (
        state?.readyState === "complete" &&
        Number(state?.htmlLength) > 500 &&
        String(state?.text || "").length > 20 &&
        String(state?.text || "").includes("Leilão Pokémon") &&
        (
          String(state?.text || "").includes("Acesso administrativo") ||
          String(state?.text || "").includes("OPERAÇÃO AO VIVO") ||
          String(state?.text || "").includes("Configurar Leilão Pokémon")
        )
      ) {
        return state;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return null;
}

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

    const state = await waitForRendererContent();
    if (!state) throw new Error("Chromium não renderizou conteúdo da aplicação em 60 segundos.");
    if (state.readyState !== "complete") throw new Error("Documento Electron não chegou a readyState=complete.");
    if (Number(state.htmlLength) <= 500) throw new Error(`DOM muito pequeno: ${state.htmlLength ?? 0} bytes.`);
    if (!String(state.text || "").includes("Leilão Pokémon")) {
      throw new Error("Chromium carregou a página, mas o texto esperado não apareceu no DOM.");
    }
    startupLog("[smoke] renderer OK: conteúdo visível confirmado no Chromium.");

    startupLog(`[smoke] renderer OK: title="${state.title}", html=${state.htmlLength}, text=${state.text.length} chars.`);
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

  void mainWindow.loadURL(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Leilão Pokémon</title></head>' +
    '<body style="margin:0;background:#0f1115;color:#f7f8fb;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">' +
    '<main style="text-align:center;padding:40px"><div style="font-size:52px">🎴</div><h1 style="margin:10px 0">Leilão Pokémon</h1><p style="color:#a8b2c4;margin:0">Iniciando o painel…</p></main></body></html>'
  );

  mainWindow.maximize();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    startupLog(`[renderer] level=${level} ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("dom-ready", () => startupLog("[renderer] DOM pronto."));
  mainWindow.webContents.on("did-finish-load", () => startupLog("[renderer] página terminou de carregar."));
  mainWindow.webContents.on("unresponsive", () => startupLog("[renderer] Chromium sem resposta."));
  mainWindow.webContents.on("responsive", () => startupLog("[renderer] Chromium respondeu novamente."));
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

  void launchConfiguredApp();

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
