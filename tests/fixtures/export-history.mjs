export function exportHistoryFixture() {
  const bid = (id, participant, auction, amount, time, extra = {}) => ({ id, participant_id: participant, auction_id: auction, amount, status: 'active', whatsapp_event_at: time, whatsapp_event_id: `event-${id}`, ...extra });
  return {
    cards: [{ id: 'c', name: '=Pikachu', card_number: '25' }],
    participants: [{ id: 'p', display_name: 'Ana', phone_e164: '+5511999999999', first_seen_at: '2000-01-01T00:00:00Z' }, { id: 'q', display_name: 'Bia' }],
    auctions: [{ id: 'a', card_id: 'c', lot_number: 1 }, { id: 'b', card_id: 'c', lot_number: 2 }],
    bids: [
      bid('third', 'p', 'a', 60, '2026-10-26T04:00:15.987Z'),
      bid('second', 'p', 'a', 40, '2026-10-26T01:00:00.456-03:00', { status: 'withdrawn' }),
      bid('first', 'p', 'a', 50, '2026-10-26T04:00:00.123Z', { status: 'replaced', replaced_by: 'second' }),
      bid('other-person', 'q', 'a', 100, '2026-10-26T03:00:00Z'),
      bid('other-auction', 'p', 'b', 200, '2026-10-26T05:00:00Z'),
      bid('rejected', 'p', 'a', 999, '2026-10-26T06:00:00Z', { status: 'rejected' }),
      bid('late', 'p', 'a', 999, '2026-10-26T07:00:00Z', { status: 'late' }),
    ],
    value_change_log: [
      { id: 'v1', auction_id: 'a', participant_id: 'p', previous_amount: 50, new_amount: 40, external_event_id: 'event-second', occurred_at: '2026-10-26T01:00:00.456-03:00', change_kind: 'change' },
      { id: 'v2', auction_id: 'a', participant_id: 'p', previous_amount: 40, new_amount: 60, external_event_id: 'event-third', occurred_at: '2026-10-26T04:00:15.987Z', change_kind: 'withdraw_rebid' },
    ],
    purchases: [{ id: 'sale', auction_id: 'a', card_id: 'c', participant_id: 'p', amount: 60, status: 'confirmed', confirmed_at: '2026-10-26T05:00:00Z' }],
    payments: [], deliveries: [], warnings: [], participant_warnings: [], auction_events: [],
  };
}
