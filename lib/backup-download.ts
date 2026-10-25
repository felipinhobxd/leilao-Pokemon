import type { SupabaseClient } from '@supabase/supabase-js';
import { readBusinessBackup, compressBusinessBackup } from './business-backup.mjs';

export async function prepareBackupDownload(db: SupabaseClient, userId: string, now = new Date()) {
  const backup = await readBusinessBackup(db);
  const parsed = JSON.parse(backup.payload);
  if (!parsed?.tables || !Array.isArray(parsed.tables.auctions) || !Array.isArray(parsed.tables.cards)) throw new Error('backup_invalid');
  const filename = `leilao-backup-${now.toISOString().replace(/[:.]/g,'-')}.json.gz`;
  const payload = backup.payload;
  const bucket = 'business-backups';
  const { data: info, error: bucketError } = await db.storage.getBucket(bucket);
  if (bucketError) {
    if (String(bucketError.statusCode)!=='404') throw new Error('backup_storage_unavailable');
    const { error: createError } = await db.storage.createBucket(bucket,{public:false});
    if (createError) throw new Error('backup_storage_unavailable');
  } else if (info?.public !== false) throw new Error('backup_bucket_not_private');
  // One private manual snapshot per administrator, replaced on next export.
  // Never lists or deletes the automatic backups maintained by the bot.
  const path = `manual/backup-${userId}.json.gz`;
  const compressed = await compressBusinessBackup(payload);
  const { error: uploadError } = await db.storage.from(bucket).upload(path,compressed,{contentType:'application/gzip',upsert:true});
  if (uploadError) throw new Error('backup_storage_unavailable');
  const { data: signed, error: signError } = await db.storage.from(bucket).createSignedUrl(path,120,{download:filename});
  if (signError || !signed?.signedUrl) throw new Error('backup_storage_unavailable');
  // Replace the previous manual format only after the new private copy exists.
  try { await db.storage.from(bucket).remove([`manual/backup-${userId}.json`]); } catch {}
  return {downloadUrl:signed.signedUrl,filename,exported_at:backup.exported_at,bytes:Buffer.byteLength(payload),compressedBytes:compressed.length};
}
