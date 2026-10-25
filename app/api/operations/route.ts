import { authorize, failure, HttpError } from '@/lib/backend';
import { readableIssue } from '@/lib/operation-health';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Explicit refresh only. No timers, extra Realtime subscriptions or log ingestion.
export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const [worker, notices, dispatches, backups] = await Promise.all([
      db.from('whatsapp_bot_workers').select('status,heartbeat_at,version,last_error,operational_health').order('heartbeat_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      db.from('whatsapp_auction_notices').select('id,kind,attempts,next_attempt_at,last_error,locked_at').is('sent_at', null).order('created_at').limit(50),
      db.from('whatsapp_dispatches').select('id,auction_id,last_error,attempts,updated_at,auction:auctions(lot_number,card:cards(name))').eq('status', 'failed').order('updated_at', { ascending: false }).limit(30),
      db.storage.from('business-backups').list('backups', { limit: 3, sortBy: { column: 'name', order: 'desc' } }),
    ]);
    const health = worker.data?.operational_health ?? {};
    return Response.json({
      checkedAt: new Date().toISOString(),
      worker: worker.data ? { status: worker.data.status, online: Date.now() - Date.parse(worker.data.heartbeat_at) <= 35_000, heartbeat: worker.data.heartbeat_at, version: worker.data.version, issue: readableIssue(worker.data.last_error), mention: {at: health.mention?.at, issue: readableIssue(health.mention?.issue)}, backup: { status: health.backup?.status, at: health.backup?.at, error: readableIssue(health.backup?.error), cloud: health.backup?.cloud }, database: { failedAt: health.database?.failedAt, recoveredAt: health.database?.recoveredAt } } : null,
      backups: (backups.data ?? []).filter(row => /^backup-\d{8}-\d{4}\.json(?:\.gz)?$/.test(row.name)).map(row => ({ name: row.name, at: row.updated_at || row.created_at })),
      backupReadFailed: Boolean(backups.error),
      notices: (notices.data ?? []).map(row => ({ id: row.id, kind: row.kind, attempts: row.attempts, nextAttempt: row.next_attempt_at, issue: readableIssue(row.last_error), locked: Boolean(row.locked_at), retryable: row.attempts > 0 && !row.locked_at })),
      failures: (dispatches.data ?? []).map(row => {
        const auction = Array.isArray(row.auction) ? row.auction[0] : row.auction;
        const card = Array.isArray(auction?.card) ? auction.card[0] : auction?.card;
        return { id: row.id, auctionId: row.auction_id, lot: auction?.lot_number, cardName: card?.name, issue: readableIssue(row.last_error), attempts: row.attempts, at: row.updated_at };
      }),
      sectionsUnavailable: [worker.error && 'Conexão do bot', notices.error && 'Avisos de encerramento', dispatches.error && 'Publicações'].filter(Boolean),
    }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { db } = await authorize(request, true);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Envie JSON.');
    const body = await request.json();
    if (!uuid.test(String(body?.id)) || typeof body?.nextAttempt !== 'string' || body.nextAttempt.length > 80 || !Number.isFinite(Date.parse(body.nextAttempt))) throw new HttpError(400, 'Aviso inválido. Atualize o diagnóstico.');
    // Compare-and-set: never unlock an active sender, resend a delivered notice,
    // reset attempts or bypass the group's persistent 15 second delivery spacing.
    const { data, error } = await db.from('whatsapp_auction_notices')
      .update({ next_attempt_at: new Date().toISOString() })
      .eq('id', body.id).eq('next_attempt_at', body.nextAttempt).gt('attempts', 0)
      .is('sent_at', null).is('locked_at', null).select('id');
    if (error) throw new Error('notice_retry_failed');
    if (!data?.length) throw new HttpError(409, 'Este aviso mudou ou já está sendo enviado. Atualize o diagnóstico.');
    return Response.json({ message: 'Nova tentativa liberada. O bot conectado enviará o aviso respeitando a fila e o intervalo de 15 segundos.' }, { headers });
  } catch (error) { return failure(error); }
}
