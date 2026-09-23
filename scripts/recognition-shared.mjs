// Launcher compartilhado dos comandos de reconhecimento local.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const recognition = join(root, "recognition");
const isWindows = platform() === "win32";
const venvPython = isWindows
  ? join(recognition, ".venv", "Scripts", "python.exe")
  : join(recognition, ".venv", "bin", "python");

export function pickPython() {
  if (existsSync(venvPython)) return venvPython;
  return isWindows ? "python" : "python3";
}

// Executa um comando e resolve com o exit code (sequencial de verdade).
export function run(bin, args) {
  return new Promise(resolve => {
    const child = spawn(bin, args, { stdio: "inherit", cwd: recognition });
    child.on("error", error => {
      console.error(`[recognition] falha ao executar ${bin}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", code => resolve(code ?? 0));
  });
}

// Embedding primario (vencedor do bake-off) e idiomas com scans/indice.
// Catalogo mantem todos os idiomas (metadados sao leves e uteis para o OCR);
// scans + indice ficam em pt-BR (acervo principal) e en.
const PRIMARY_EMBEDDING = "siglip2-base-384";
const SCAN_LANGUAGES = "pt-BR,en";
const CATALOG_LANGUAGES = "pt-BR,en,es,ja";
// batch=8 validado; 16/32 causam OOM em maquinas com pouca RAM.
const INDEX_BATCH = "8";

export async function recognitionLauncher(command) {
  if (command === "install") {
    if (isWindows) {
      const code = await run("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", join(recognition, "install-windows.ps1")]);
      if (code !== 0) process.exitCode = code;
      return;
    }
    let code = await run(pickPython(), ["-m", "pip", "install", "-r", join(recognition, "requirements.txt")]);
    if (code !== 0) return void (process.exitCode = code);
    code = await run(pickPython(), [join(recognition, "scripts", "download_models.py")]);
    if (code !== 0) return void (process.exitCode = code);
    code = await run(pickPython(), [join(recognition, "scripts", "build_catalog.py"), "--languages", CATALOG_LANGUAGES]);
    if (code !== 0) return void (process.exitCode = code);
    code = await run(pickPython(), [join(recognition, "scripts", "download_scans.py"), "--languages", SCAN_LANGUAGES, "--workers", "16"]);
    if (code !== 0) return void (process.exitCode = code);
    // pt-BR primeiro para o servico ficar util cedo; en em seguida (retomavel).
    code = await run(pickPython(), [join(recognition, "scripts", "build_index.py"),
      "--model", PRIMARY_EMBEDDING, "--batch", INDEX_BATCH, "--languages", "pt-BR", "--only-missing"]);
    if (code !== 0) return void (process.exitCode = code);
    code = await run(pickPython(), [join(recognition, "scripts", "build_index.py"),
      "--model", PRIMARY_EMBEDDING, "--batch", INDEX_BATCH, "--languages", SCAN_LANGUAGES, "--only-missing"]);
    process.exitCode = code;
    return;
  }
  if (command === "local") {
    if (!existsSync(venvPython)) {
      console.error("[recognition] Ambiente Python nao instalado. Rode: npm run recognition:install");
      process.exitCode = 1;
      return;
    }
    // No --preload: lazy load on first request + idle unload (see
    // recognition_server.py) keeps the RAM free between wizard sessions.
    const code = await run(venvPython, [join(recognition, "recognition_server.py")]);
    if (code !== 0) process.exitCode = code;
    return;
  }
  if (command === "index") {
    const model = process.env.RECOGNITION_EMBEDDING || PRIMARY_EMBEDDING;
    const langs = process.env.RECOGNITION_LANGUAGES || SCAN_LANGUAGES;
    const py = pickPython();

    // Index construction is deliberately CPU-only on Windows. The target
    // machines commonly use DirectML and SigLIP2 can return NaN during a long
    // bulk build even when runtime inference is otherwise usable. Runtime
    // recognition remains GPU-capable and has its own provider handling.
    const previousProvider = process.env.RECOGNITION_PROVIDERS;
    if (isWindows) process.env.RECOGNITION_PROVIDERS = "cpu";
    try {
      let code = await run(py, [join(recognition, "scripts", "build_catalog.py"), "--languages", CATALOG_LANGUAGES]);
      if (code !== 0) return void (process.exitCode = code);
      code = await run(py, [join(recognition, "scripts", "download_scans.py"), "--languages", langs, "--workers", "16"]);
      if (code !== 0) return void (process.exitCode = code);
      code = await run(py, [join(recognition, "scripts", "build_index.py"),
        "--model", model, "--batch", INDEX_BATCH, "--languages", langs, "--only-missing"]);
      process.exitCode = code;
    } finally {
      if (previousProvider === undefined) delete process.env.RECOGNITION_PROVIDERS;
      else process.env.RECOGNITION_PROVIDERS = previousProvider;
    }
    return;
  }
  console.error(`Comando desconhecido: ${command}`);
  process.exit(1);
}
