export async function logCurrentLeader(db, auctionId, { now = Date.now, log = console.log } = {}) {
  // Preserve the financial ordering; embed the candidates instead of querying
  // each participant separately just to print the terminal summary.
  const { data: bids, error } = await db.from('bids')
    .select('participant_id,amount,processed_at,confirmation_order,whatsapp_event_at,participant:participants(display_name,phone_e164,status,suspension_until)')
    .eq('auction_id', auctionId).eq('status', 'active')
    .order('amount', { ascending: false })
    .order('whatsapp_event_at', { ascending: true, nullsFirst: true })
    .order('processed_at', { ascending: true })
    .order('confirmation_order', { ascending: true }).limit(20);
  if (error || !bids?.length) return;
  const clock = now();
  for (const bid of bids) {
    const person = Array.isArray(bid.participant) ? bid.participant[0] : bid.participant;
    if (!person || person.status !== 'active') continue;
    if (person.suspension_until && Date.parse(person.suspension_until) > clock) continue;
    const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(bid.amount));
    log(`🏆 Maior lance: ${person.display_name}${person.phone_e164 ? ` (${person.phone_e164})` : ''} → ${amount}`);
    return;
  }
}
