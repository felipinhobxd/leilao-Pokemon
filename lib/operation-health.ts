/** Never return provider HTML, credentials or signed URLs to the dashboard. */
export function readableIssue(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (/<(?:html|!doctype)/i.test(raw)) return 'O provedor respondeu com uma página de erro. Aguarde a recuperação do serviço.';
  return raw.replace(/https?:\/\/\S+/gi, '[endereço omitido]')
    .replace(/(?:Bearer\s+|eyJ)[\w.\-]+/gi, '[credencial omitida]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 400);
}

export type BackupProtection = {
  state: 'confirmed' | 'expired' | 'object_unavailable' | 'awaiting_confirmation' | 'missing';
  latestSnapshotAt: string | null; latestConfirmedAt: string | null;
  validSnapshotAt: string | null; validConfirmedAt: string | null; validUntil: string | null;
};
export type CleanupReport = {status: 'blocked' | 'completed' | 'failed'; at: string; reason: string; deleted: number};
const cleanupReasons: Record<string,string> = {
  confirmed_cloud_backup_missing: 'Não havia cópia confirmada e válida na nuvem.',
  daily_cloud_backup_missing: 'O supervisor não confirmou o backup diário.',
  backup_coverage_incomplete: 'Há registros novos ou alterados depois da cópia. A limpeza aguardará um backup que os cubra.',
  maintenance_busy: 'O banco estava ocupado com outra operação. A limpeza foi adiada para preservar o atendimento.',
  unsupported_cleanup_isolation: 'A transação não permitiu uma conferência atual dos dados.',
  backup_unavailable: 'Não foi possível confirmar o backup diário. A limpeza foi adiada.',
  cleanup_failed: 'A tentativa de limpeza falhou. Aguarde a próxima tentativa do supervisor.',
};
export const cleanupReason = (value?: string) => Object.hasOwn(cleanupReasons,value ?? '') ? cleanupReasons[value ?? ''] : 'Motivo não informado pelo supervisor.';
export function readCleanupReport(value: unknown): CleanupReport | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string,unknown>;
  if (!['blocked','completed','failed'].includes(String(row.status)) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) return null;
  return {status:row.status as CleanupReport['status'],at:row.at,reason:typeof row.reason === 'string' && Object.hasOwn(cleanupReasons,row.reason) ? row.reason : '',deleted:Number.isSafeInteger(row.deleted) && Number(row.deleted)>=0 ? Number(row.deleted) : 0};
}

export type VoteHealth = { at: string | null; pending: number; review: number; issue: string };
export function readVoteHealth(value: unknown): VoteHealth | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const count = (key: string) => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0 ? Math.min(10000, Number(row[key])) : 0;
  return { at: typeof row.at === 'string' && Number.isFinite(Date.parse(row.at)) ? row.at : null, pending: count('pending'), review: count('review'),
    issue: ['storage_error', 'capacity', 'corrupt', 'review', 'retrying'].includes(String(row.issue)) ? String(row.issue) : '' };
}

export type OperationHealth = {
  checkedAt: string;
  worker: { status: string; online: boolean; heartbeat: string | null; version: string | null; issue: string; protectionVersion?: number; cleanup?: CleanupReport | null; votes?: VoteHealth | null; mention?: { at?: string; issue?: string }; backup: { status?: string; at?: string; error?: string; cloud?: boolean }; database: { failedAt?: string; recoveredAt?: string } } | null;
  backupProtection?: BackupProtection | null;
  backupReadFailed: boolean;
  notices: { id: string; kind: string; attempts: number; nextAttempt: string; issue: string; retryable: boolean; locked: boolean }[];
  failures: { id: string; auctionId: string; cardName?: string; lot?: number; issue: string; attempts: number; at: string }[];
  sectionsUnavailable: string[];
};
