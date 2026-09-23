// Doctor — check-up pré-leilão (npm run doctor).
//
// O operador tem 4 processos (site, bot, reconhecimento, Supabase) + migrações
// aplicadas manualmente + arquivos de estado (backup, figurinha). Nada avisava
// quando algo desses ficou faltando ANTES da noite de leilão. Este script
// verifica tudo em ~5s e imprime exatamente o que fazer quando algo falta.
//
// Uso:  npm run doctor          (no PC do bot, com npm run start rodando ou não)
//       npm run doctor -- --verbose
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const results = [];

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function check(label, pass, { warn = false, detail = "", fix = "" } = {}) {
  results.push({ label, state: pass ? "pass" : warn ? "warn" : "fail", detail, fix });
}

async function fetchWithTimeout(url, ms, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const envLocal = parseEnvFile(join(root, ".env.local"));
const botEnv = parseEnvFile(join(root, "bot", ".env"));
const recEnv = parseEnvFile(join(root, "recognition", ".env"));
const verbose = process.argv.includes("--verbose");

console.log("\n🩺 Check-up do leilão — rodando verificações...\n");

// ---------------------------------------------------------------- segredos
const secretSite = envLocal.RECOGNITION_SERVICE_SHARED_SECRET ?? "";
const secretRec = recEnv.RECOGNITION_SERVICE_SHARED_SECRET ?? "";
check("Segredo do reconhecimento configurado no site (.env.local)", secretSite.length >= 32,
  { warn: secretSite.length > 0, fix: "Gere um segredo de 64 caracteres e salve em .env.local como RECOGNITION_SERVICE_SHARED_SECRET" });
check("Segredo IDÊNTICO no serviço local (recognition/.env)", secretSite === secretRec && secretRec.length >= 32,
  { warn: secretSite.length >= 32 && secretRec.length >= 32, fix: "Copie o MESMO valor de RECOGNITION_SERVICE_SHARED_SECRET para recognition/.env" });

// ---------------------------------------------------------------- migrations
const supabaseUrl = (envLocal.NEXT_PUBLIC_SUPABASE_URL ?? botEnv.SUPABASE_URL ?? "").replace(/\/$/, "");
const serviceKey = envLocal.SUPABASE_SERVICE_ROLE_KEY ?? botEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!supabaseUrl || !serviceKey) {
  check("Conexão com o Supabase", false, { fix: "Confira NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local" });
} else {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  // Tabelas da rodada de avisos (20260923093000), brindes/lembretes (20260924120000) e rascunhos (20260924150000).
  const expectedTables = ["participant_warnings", "value_change_log", "admin_notifications", "whatsapp_quick_polls", "payment_reminders", "auction_drafts"];
  const missingTables = [];
  for (const table of expectedTables) {
    try {
      const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, 4000, { headers });
      if (response.status === 404) missingTables.push(table);
    } catch {
      missingTables.push(table);
    }
  }
  if (missingTables.length === 0) {
    check("Migrations aplicadas (tabelas novas)", true);
  } else {
    const known = {
      participant_warnings: "20260923093000_global_warnings_value_history.sql",
      value_change_log: "20260923093000_global_warnings_value_history.sql",
      admin_notifications: "20260923093000_global_warnings_value_history.sql",
      whatsapp_quick_polls: "20260924120000_quick_polls_extra_images_reminders.sql",
      payment_reminders: "20260924120000_quick_polls_extra_images_reminders.sql",
      auction_drafts: "20260924150000_auction_drafts.sql",
    };
    const files = [...new Set(missingTables.map(table => known[table]))];
    check("Migrations aplicadas (tabelas novas)", false,
      { detail: `faltando: ${missingTables.join(", ")}`, fix: `Abra o SQL Editor do Supabase e cole, na ordem: ${files.map(file => `supabase/migrations/${file}`).join(" → ")}` });
  }
  // RPCs das rodadas 23120000 (backup), 24120000 (baixa de pagamento) e 24150000 (rascunhos).
  try {
    const specResponse = await fetchWithTimeout(`${supabaseUrl}/rest/v1/`, 6000, { headers: { ...headers, Accept: "application/openapi+json" } });
    const spec = await specResponse.json();
    const paths = Object.keys(spec?.paths ?? {});
    const expectedRpcs = ["/rpc/export_business_backup", "/rpc/mark_purchase_paid", "/rpc/cleanup_old_auctions", "/rpc/upsert_auction_draft", "/rpc/delete_auction_draft"];
    const missingRpcs = expectedRpcs.filter(rpc => !paths.includes(rpc));
    check("Migrations aplicadas (RPCs: backup, baixa de pagamento, limpeza 30d, rascunhos)", missingRpcs.length === 0,
      { warn: false, detail: missingRpcs.length ? `faltando: ${missingRpcs.join(", ")}` : "", fix: missingRpcs.length ? `Aplique no SQL Editor: supabase/migrations/20260923120000_business_backup.sql → 20260924120000_quick_polls_extra_images_reminders.sql → 20260924140000_backup_covers_new_tables.sql → 20260924150000_auction_drafts.sql` : "" });
  } catch {
    check("Migrations aplicadas (RPCs: backup, baixa de pagamento, limpeza 30d, rascunhos)", false, { fix: "Sem resposta do Supabase ao listar RPCs — confira a URL/chave no .env.local" });
  }
  // Heartbeat do bot.
  try {
    const workerResponse = await fetchWithTimeout(`${supabaseUrl}/rest/v1/whatsapp_bot_workers?select=worker_id,status,heartbeat_at&order=heartbeat_at.desc&limit=1`, 4000, { headers });
    const workers = await workerResponse.json();
    const worker = Array.isArray(workers) ? workers[0] : null;
    const ageMs = worker?.heartbeat_at ? Date.now() - Date.parse(worker.heartbeat_at) : Infinity;
    const fresh = Number.isFinite(ageMs) && ageMs < 60_000;
    check(fresh ? `Bot no ar (${worker.status}, heartbeat ${Math.round(ageMs / 1000)}s atrás)` : "Bot no ar", fresh,
      { warn: Number.isFinite(ageMs) && ageMs < 5 * 60_000, detail: worker?.heartbeat_at ? `último heartbeat ${new Date(worker.heartbeat_at).toLocaleString("pt-BR")}` : "nenhum heartbeat registrado", fix: "Rode npm run start no PC do bot (o bot precisa ficar ligado durante o leilão)" });
  } catch {
    check("Bot no ar", false, { fix: "Sem acesso à tabela whatsapp_bot_workers — confira o .env.local e se o Supabase está alcançável" });
  }
}

// ---------------------------------------------------------------- serviço de reconhecimento
try {
  const healthResponse = await fetchWithTimeout("http://127.0.0.1:8765/health", 2500);
  const health = await healthResponse.json();
  check(`Reconhecimento ${health.ready ? "pronto" : health.warming ? "aquecendo" : "carregado"} (catálogo ${health.catalog?.cards ?? 0}, índice ${health.catalog?.indexSize ?? 0})`,
    health.ready === true, { warn: health.warming === true, fix: "Reinicie com npm run start; a 1ª foto carrega os modelos (~30s) e o estado fica pronto" });
} catch {
  check("Reconhecimento (127.0.0.1:8765)", false, { fix: "Serviço de reconhecimento fora do ar — rode npm run start (sem ele o wizard usa o pipeline lento do navegador)" });
}

// ---------------------------------------------------------------- figurinha de abertura (P-05)
const stickerPath = join(root, "bot", "data", "announcement-sticker.json");
check("Figurinha de abertura capturada (!figurinha)", existsSync(stickerPath),
  { warn: true, detail: existsSync(stickerPath) ? "" : "sem figurinha o aviso de abertura fica desligado", fix: "Com o bot rodando: envie a figurinha em qualquer conversa e digite !figurinha na mesma conversa" });

// ---------------------------------------------------------------- backups
const backupsDir = join(root, "bot", "backups");
try {
  const files = readdirSync(backupsDir).filter(name => /^backup-\d{8}-\d{4}\.json$/.test(name)).sort();
  const latest = files.at(-1);
  const ageHours = latest ? (Date.now() - statSync(join(backupsDir, latest)).mtimeMs) / 3_600_000 : Infinity;
  check(latest ? `Backup de dados recente (${latest}, ${ageHours.toFixed(1)} h atrás)` : "Backup de dados", latest && ageHours < 48,
    { warn: latest && ageHours < 72, fix: "O bot salva automaticamente às 4h30 quando roda 24h; botão 'Baixar backup' no painel para uma cópia agora" });
} catch {
  check("Backup de dados (bot/backups/)", false, { warn: true, fix: "Deixe o bot rodando até passar das 4h30 uma vez para gerar o primeiro backup automático" });
}

// ---------------------------------------------------------------- Vercel (informativo)
const vercelHint = envLocal.RECOGNITION_ALLOWED_ORIGINS_TESTED ? "" : "";
check("Aviso: painel publicado (Vercel)", vercelHint === "",
  { warn: true, detail: "o painel https precisa da MESMA variável RECOGNITION_SERVICE_SHARED_SECRET nas configurações da Vercel (server-only)", fix: "Vercel → Settings → Environment Variables → adicionar RECOGNITION_SERVICE_SHARED_SECRET com o valor do .env.local" });

// ---------------------------------------------------------------- relatório
const passes = results.filter(result => result.state === "pass").length;
const warns = results.filter(result => result.state === "warn").length;
const fails = results.filter(result => result.state === "fail").length;
for (const result of results) {
  const icon = result.state === "pass" ? "✅" : result.state === "warn" ? "⚠️ " : "❌";
  console.log(`${icon} ${result.label}${result.detail && (verbose || result.state !== "pass") ? ` — ${result.detail}` : ""}`);
  if (result.state !== "pass" && result.fix) console.log(`     → ${result.fix}`);
}
console.log(`\n${passes} ok · ${warns} atenção · ${fails} problema(s)`);
if (fails > 0) {
  console.log("Resolva os itens ❌ acima antes da noite de leilão.\n");
  process.exitCode = 1;
} else if (warns > 0) {
  console.log("Tudo essencial em ordem; revise os ⚠️ quando puder.\n");
} else {
  console.log("Tudo pronto. Bom leilão! 🃏🔥\n");
}
