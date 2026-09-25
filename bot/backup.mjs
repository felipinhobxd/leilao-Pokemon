// Backup automático dos dados de leilão: o supervisor baixa TODAS as tabelas de
// negócio via RPC export_business_backup e grava bot/backups/backup-YYYY-MM-DD.json.
// Motivação: o painel tem um "Excluir TUDO" com frase de confirmação — e não
// existia NENHUMA cópia dos dados. O bot roda 24h na máquina do operador, então
// é ele quem tira a cópia diária de segurança (independe da Vercel/Supabase UI).
// Retenção: os 30 arquivos mais recentes (BOT_BACKUP_KEEP).
//
// 2026-09-24: o backup também SOBE para o Supabase Storage (bucket privado
// "business-backups", cria se não existir, retenção BOT_BACKUP_CLOUD_KEEP=7) —
// o disco local deixa de ser o único ponto de guarda. Bucket privado + acesso
// apenas com service key (o painel nunca tem a key).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
export const BACKUPS_DIR = join(here, "backups");
export const BACKUP_BUCKET = "business-backups";

export async function uploadBackupToCloud(db, payload, now = new Date()) {
  const { data: buckets } = await db.storage.listBuckets();
  if (!Array.isArray(buckets) || !buckets.some(bucket => bucket.name === BACKUP_BUCKET)) {
    const { error } = await db.storage.createBucket(BACKUP_BUCKET, { public: false });
    if (error) throw new Error(`bucket_create_failed: ${error.message}`);
  }
  const pad = value => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const { error } = await db.storage
    .from(BACKUP_BUCKET)
    .upload(`backups/backup-${stamp}.json`, Buffer.from(payload, "utf8"), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
  // Retenção na nuvem: mantém os N mais recentes (padrão 7 — ponto de
  // recuperação externo semanal; o disco continua guardando 30).
  const keep = Math.max(1, Number(process.env.BOT_BACKUP_CLOUD_KEEP || 7));
  const { data: listed } = await db.storage.from(BACKUP_BUCKET).list("backups", { limit: 100, sortBy: { column: "name", order: "desc" } });
  for (const stale of (listed ?? []).slice(keep)) {
    if (!/^backup-\d{8}-\d{4}\.json$/.test(String(stale.name))) continue;
    await db.storage.from(BACKUP_BUCKET).remove([`backups/${stale.name}`]);
  }
  return `backups/backup-${stamp}.json`;
}

export async function runBusinessBackup(db, now = new Date()) {
  const { data, error } = await db.rpc("export_business_backup");
  if (error) throw new Error(error.message);
  const payload = JSON.stringify({ exported_at: now.toISOString(), tables: data ?? {} }, null, 1);
  const pad = value => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const path = join(BACKUPS_DIR, `backup-${stamp}.json`);
  writeFileSync(path, payload, "utf8");
  const keep = Math.max(1, Number(process.env.BOT_BACKUP_KEEP || 30));
  const files = readdirSync(BACKUPS_DIR)
    .filter(name => /^backup-\d{8}-\d{4}\.json$/.test(name))
    .sort()
    .reverse();
  for (const stale of files.slice(keep)) {
    try { rmSync(join(BACKUPS_DIR, stale), { force: true }); } catch { /* melhor deixar o arquivo do que falhar o backup */ }
  }
  let cloudPath = null;
  try {
    cloudPath = await uploadBackupToCloud(db, payload, now);
  } catch (reason) {
    // Nuvem é complemento: falha dela NUNCA derruba o backup local diário.
    console.warn("Backup: falha ao subir para o Storage (fica só o local):", reason?.message || reason);
  }
  return { path, bytes: Buffer.byteLength(payload), kept: Math.min(files.length + 1, keep), cloudPath };
}
