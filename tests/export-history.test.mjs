import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBidSummaryRows, buildChangeRows, buildSummaryRows, excelDateValue } from '../lib/export-rows.ts';
import { exportHistoryFixture } from './fixtures/export-history.mjs';

test('bid history: per lot/person, exact Brasília clocks, accepted history and UTC ordering', () => {
  const rows = buildBidSummaryRows(exportHistoryFixture());
  assert.equal(rows.length, 3);
  const ana = rows.find(row => row.auctionId === 'a' && row.participantId === 'p');
  assert.equal(ana.firstAmount, 50);
  assert.equal(ana.lastAmount, 60);
  assert.equal(ana.firstBidAt.toISOString(), '2026-10-26T01:00:00.123Z');
  assert.equal(ana.lastBidAt.toISOString(), '2026-10-26T01:00:15.987Z');
  assert.equal(ana.bidCount, 3);
  assert.equal(ana.changeCount, 2);
  assert.equal(ana.firstSource, 'WhatsApp');
  assert.equal(ana.lastStatus, 'Ativo');
  assert.equal(rows.find(row => row.auctionId === 'b').firstAmount, 200);
});

test('changes: direct replacement and withdrawn/rebid identify exact previous clock and values', () => {
  const rows = buildChangeRows(exportHistoryFixture());
  assert.deepEqual(rows.map(row => row.newAmount), [60, 40]);
  assert.equal(rows[0].previousBidAt.toISOString(), '2026-10-26T01:00:00.456Z');
  assert.equal(rows[1].previousBidAt.toISOString(), '2026-10-26T01:00:00.123Z');
  assert.match(rows[1].transition, /50,00 → R\$\s40,00/);
  assert.equal(rows[1].difference, -10);
  assert.equal(rows[1].warning, 'SIM');
  assert.equal(rows[0].historyNote, '');
  assert.equal(rows[0].phone, '+5511999999999');
});

test('missing clocks/values are explicit, fallback clocks are labelled, no inferred first_seen', () => {
  const data = exportHistoryFixture();
  data.bids = [
    { id: 'x', auction_id: 'a', participant_id: 'p', amount: 5, status: 'replaced', whatsapp_event_at: 'invalid', processed_at: '2026-10-26T04:00:00.789Z' },
    { id: 'y', auction_id: 'a', participant_id: 'p', amount: 6, status: 'withdrawn', received_at: '2026-10-26T04:00:01Z' },
    { id: 'z', auction_id: 'a', participant_id: 'p', amount: 7, status: 'active' },
  ];
  const [row] = buildBidSummaryRows(data);
  assert.equal(row.firstSource, 'Confirmação do bot');
  assert.equal(row.lastSource, 'Recebimento no banco');
  assert.equal(row.lastStatus, 'Retirado');
  assert.equal(row.bidCount, 3);
  assert.match(row.notes, /1 lance\(s\) sem horário/);
  data.bids = [data.bids[2]];
  assert.equal(buildBidSummaryRows(data)[0].firstBidAt, null);
  data.value_change_log[0].previous_amount = null;
  const change = buildChangeRows(data)[1];
  assert.equal(change.previousAmount, null);
  assert.equal(change.previousBidAt, null);
  assert.equal(change.difference, null);
  assert.match(change.transition, /Não registrado/);
  assert.match(change.historyNote, /não identificado/);
  assert.equal(excelDateValue('invalid'), null);
});

test('same instant uses exact bigint confirmation order and missing event never guesses old clock', () => {
  const data = exportHistoryFixture();
  data.bids = [
    { id: 'a', auction_id: 'a', participant_id: 'p', amount: 20, status: 'active', whatsapp_event_at: '2026-10-26T04:00:00Z', confirmation_order: '9007199254740993' },
    { id: 'z', auction_id: 'a', participant_id: 'p', amount: 10, status: 'replaced', whatsapp_event_at: '2026-10-26T04:00:00Z', confirmation_order: '9007199254740992' },
  ];
  const [row] = buildBidSummaryRows(data);
  assert.equal(row.firstAmount, 10);
  assert.equal(row.lastAmount, 20);
  assert.equal(buildChangeRows(data)[0].previousBidAt, null);
});

test('unrelated participant or mismatched linked value cannot become previous bid', () => {
  const data = exportHistoryFixture();
  data.bids.find(row => row.id === 'first').participant_id = 'q';
  assert.equal(buildChangeRows(data)[1].previousBidAt, null);
  data.bids.find(row => row.id === 'first').participant_id = 'p';
  data.bids.find(row => row.id === 'first').amount = 500;
  assert.equal(buildChangeRows(data)[1].previousBidAt, null);
});

test('summary warns on export limits and cleanup; empty history remains empty', () => {
  assert.deepEqual(buildBidSummaryRows({}), []);
  const rows = buildSummaryRows({ bids: Array(50000).fill({}) });
  assert.match(rows.find(row => row.metric === 'Limites do histórico').value, /ATENÇÃO/);
  assert.match(rows.find(row => row.metric === 'Histórico disponível').value, /12 horas/);
});
