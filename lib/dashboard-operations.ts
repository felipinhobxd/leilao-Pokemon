import type { createServerSupabaseClient } from './supabase-server';

const statuses = ['sent', 'failed', 'scheduled', 'sending', 'cancelled'] as const;
type Counts = Record<(typeof statuses)[number], number>;
type Operations = {
  worker: { worker_id: string; status: string; heartbeat_at: string | null; version: string | null } | null;
  group: { id: string; name: string } | null;
  counts: Counts;
};

export async function readDashboardOperations(db: ReturnType<typeof createServerSupabaseClient>, windowStart: string): Promise<Operations> {
  // Enable only after installing the migration. No failed capability probes
  // against a project whose log allowance is nearly exhausted.
  if (process.env.DASHBOARD_OPERATIONS_RPC_ENABLED === '1') {
    const { data, error } = await db.rpc('read_dashboard_operations', { p_window_start: windowStart });
    if (error || !data || !data.counts || statuses.some(key => !Number.isSafeInteger(data.counts[key]) || data.counts[key] < 0)) {
      throw new Error('dashboard_operations_read_failed');
    }
    return data as Operations;
  }
  const [worker, group, ...results] = await Promise.all([
    db.from('whatsapp_bot_workers').select('worker_id,status,heartbeat_at,version').order('heartbeat_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db.from('whatsapp_groups').select('id,name,is_default').eq('active', true).eq('is_default', true).maybeSingle(),
    ...statuses.map(status => db.from('whatsapp_dispatches').select('status', { count: 'exact', head: true }).eq('status', status).gte('updated_at', windowStart)),
  ]);
  if (worker.error || group.error || results.some(result => result.error)) throw new Error('dashboard_operations_read_failed');
  const counts = Object.fromEntries(statuses.map((status, i) => [status, results[i].count ?? 0])) as Counts;
  return { worker: worker.data, group: group.data, counts };
}
