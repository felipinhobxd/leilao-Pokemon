// Backup automático dos dados de leilão: o supervisor baixa TODAS as tabelas de
// negócio via RPC export_business_backup e grava bot/backups/backup-YYYY-MM-DD.json.
// Motivação: o painel tem um "Excluir TUDO" com frase de confirmação — e não
// existia NENHUMA cópia dos dados. O bot roda 24h na máquina do operador, então
// é ele quem tira a cópia diária de segurança (independe da Vercel/Supabase UI).
// Retenção: os 30 arquivos mais recentes (BOT_BACKUP_KEEP).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
export const BACKUPS_DIR = join(here, "backups");

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
  return { path, bytes: Buffer.byteLength(payload), kept: Math.min(files.length + 1, keep) };
}
