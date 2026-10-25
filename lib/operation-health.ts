/** Never return provider HTML, credentials or signed URLs to the dashboard. */
export function readableIssue(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (/<(?:html|!doctype)/i.test(raw)) return 'O provedor respondeu com uma página de erro. Aguarde a recuperação do serviço.';
  return raw.replace(/https?:\/\/\S+/gi, '[endereço omitido]')
    .replace(/(?:Bearer\s+|eyJ)[\w.\-]+/gi, '[credencial omitida]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 400);
}

export type OperationHealth = {
  checkedAt: string;
  worker: { status: string; online: boolean; heartbeat: string | null; version: string | null; issue: string; mention?: { at?: string; issue?: string }; backup: { status?: string; at?: string; error?: string; cloud?: boolean }; database: { failedAt?: string; recoveredAt?: string } } | null;
  backups: { name: string; at: string }[];
  backupReadFailed: boolean;
  notices: { id: string; kind: string; attempts: number; nextAttempt: string; issue: string; retryable: boolean; locked: boolean }[];
  failures: { id: string; auctionId: string; cardName?: string; lot?: number; issue: string; attempts: number; at: string }[];
  sectionsUnavailable: string[];
};
