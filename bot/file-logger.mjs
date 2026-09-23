// Log de arquivo do bot: o console do supervisor (que também recebe as linhas
// do filho via pipe) passa a ser TEE'd para bot/logs/bot-YYYY-MM-DD.log.
// Arquivo por dia + limpeza de logs com mais de 14 dias — o operador deixou de
// depender do console do Windows aberto para saber o que aconteceu de
// madrugada (reconexões, restart noturno, erros de envio, avisos globais).
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
export const LOGS_DIR = join(here, "logs");
const RETENTION_DAYS = Number(process.env.BOT_LOG_RETENTION_DAYS || 14);
const PREFIX = process.env.BOT_LOG_PREFIX || "bot";

let currentDay = "";
let prunedToday = false;

function dayStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pruneOldLogs() {
  if (prunedToday) return;
  prunedToday = true;
  try {
    const cutoff = Date.now() - Math.max(1, RETENTION_DAYS) * 86_400_000;
    for (const name of readdirSync(LOGS_DIR)) {
      const path = join(LOGS_DIR, name);
      try {
        if (name.startsWith(`${PREFIX}-`) && statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch { /* arquivo sumiu no meio da limpeza — sem crise */ }
    }
  } catch { /* diretório ainda não existe / sem permissão — o tee tenta de novo amanhã */ }
}

function write(level, args) {
  try {
    const now = new Date();
    const day = dayStamp(now);
    if (day !== currentDay) {
      currentDay = day;
      mkdirSync(LOGS_DIR, { recursive: true });
      pruneOldLogs();
    }
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const body = util.format(...args).replace(/\r?\n$/, "");
    appendFileSync(join(LOGS_DIR, `${PREFIX}-${day}.log`), `[${time}] [${level}] ${body}\n`, "utf8");
  } catch { /* disco cheio/permissão: nunca derrubar o bot por causa do log */ }
}

function patch(name, level) {
  const original = console[name].bind(console);
  console[name] = (...args) => {
    write(level, args);
    original(...args);
  };
}

patch("log", "INFO");
patch("info", "INFO");
patch("warn", "WARN");
patch("error", "ERROR");
