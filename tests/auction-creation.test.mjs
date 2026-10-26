import test from 'node:test';
import assert from 'node:assert/strict';
import { CreationRejectedError, submitAuctionCreation, restoreCreationCard, restoreBatchCreation } from '../lib/auction-creation.ts';

const eventId = '00000000-0000-0000-0000-000000000091';
const operation = { eventId, payload: { queue: { starts_at: '2026-10-26T18:00:00Z' } } };
const response = (data, status = 200) => Response.json(data, { status });
function transport(responses) {
  const calls = [];
  return { calls, authFetch: async (url, init) => {
    calls.push({ url, init }); const next = responses.shift();
    assert.ok(next, 'unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  } };
}

for (const kind of ['single', 'batch']) {
  const data = kind === 'single' ? { auction: { id: 'auction', lot_number: 1 } } : { queue: { id: 'queue' } };
  const send = (io, retry = true) => submitAuctionCreation({ ...io, kind, operation, retry });
  test(`${kind}: absent retry + definitive rejection + confirmed absence unlocks editing`, async () => {
    const io = transport([response({ data: null }), response({ error: 'Horário inválido' }, 400), response({ data: null })]);
    await assert.rejects(send(io), error => error instanceof CreationRejectedError && /Horário inválido/.test(error.message));
    assert.equal(io.calls.length, 3); assert.equal(io.calls[1].init.method, 'POST');
    assert.deepEqual(JSON.parse(io.calls[1].init.body), { ...operation.payload, eventId });
  });
  test(`${kind}: first definitive rejection is also confirmed before unlocking`, async () => {
    const io = transport([response({ error: 'Grupo indisponível' }, 409), response({ data: null })]);
    await assert.rejects(send(io, false), CreationRejectedError); assert.equal(io.calls.length, 2);
  });
  test(`${kind}: a committed creation is recovered without another POST`, async () => {
    const io = transport([response({ data })]); assert.deepEqual(await send(io), data);
    assert.equal(io.calls.length, 1); assert.equal(io.calls[0].init, undefined);
  });
  test(`${kind}: a commit discovered after rejection is success, never an invitation to recreate`, async () => {
    const io = transport([response({ data: null }), response({ error: 'Horário inválido' }, 400), response({ data })]);
    assert.deepEqual(await send(io), data); assert.equal(io.calls.length, 3);
  });
  test(`${kind}: failed or malformed recovery cannot unlock or POST`, async () => {
    for (const value of [response({ error: 'Indisponível' }, 503), response({}), response({ data: {} }), new Error('network')]) {
      const io = transport([value]); await assert.rejects(send(io), error => !(error instanceof CreationRejectedError));
      assert.equal(io.calls.length, 1);
    }
  });
  test(`${kind}: inconclusive recovery after rejection keeps the operation frozen`, async () => {
    for (const value of [response({ error: 'Offline' }, 503), response({}), new Error('network')]) {
      const io = transport([response({ data: null }), response({ error: 'Lote em uso' }, 409), value]);
      await assert.rejects(send(io), error => !(error instanceof CreationRejectedError));
    }
  });
  test(`${kind}: network, transient HTTP and malformed successful responses retain uncertainty`, async () => {
    for (const value of [new Error('network'), response({ error: 'Offline' }, 503), response({ error: 'Timeout' }, 408),
      response({ error: 'Rate limited' }, 429), response({ data: {} }, 201), new Response('<html>proxy</html>', { status: 502 })]) {
      const io = transport([value]); await assert.rejects(send(io, false), error => !(error instanceof CreationRejectedError));
      assert.equal(io.calls.length, 1);
    }
  });
  test(`${kind}: lost response retry preserves ID, payload and exact schedule`, async () => {
    const io = transport([new Error('response lost'), response({ data: null }), response({ data }, 201)]);
    await assert.rejects(send(io, false)); assert.deepEqual(await send(io), data);
    const posts = io.calls.filter(call => call.init?.method === 'POST'); assert.equal(posts.length, 2);
    assert.equal(posts[0].init.body, posts[1].init.body);
  });
}

test('restored single fields include prices, card details and already uploaded images', () => {
  const restored = restoreCreationCard({ card: { name: 'Pikachu', card_number: '25', variant: 'Holo', language: 'en',
    condition: 'NM', image_url: 'https://fixture.invalid/main.jpg', extra_images: ['https://fixture.invalid/detail.jpg'] },
    auction: { lot_number: 37, starting_price: 10, bid_increment: 2, buyout_price: 50, option_count: 8,
      pricing_mode: 'custom', custom_values: [10, 20, 50], custom_buyout_last: false } });
  assert.equal(restored.name, 'Pikachu'); assert.equal(restored.cardNumber, '25');
  assert.equal(restored.variant, 'Holo'); assert.equal(restored.lotNumber, '37');
  assert.equal(restored.startingPrice, '10'); assert.equal(restored.increment, '2'); assert.equal(restored.buyout, '50');
  assert.equal(restored.customValues, '10, 20, 50'); assert.equal(restored.customBuyoutLast, false);
  assert.equal(restored.extraImages.length, 1); assert.equal(restored.optionCount, '8');
});

test('restored batch retains auction order, quiz answer, prices and Brasília schedule', () => {
  const restored = restoreBatchCreation({ queue: { group_id: 'group', starts_at: '2026-10-26T18:00:00Z', ends_at: '2026-10-27T04:00:00Z', interval_seconds: 15 },
    items: [{ card: { name: 'Auction' }, auction: { lot_number: 33, starting_price: 10, bid_increment: 2, duration_seconds: 180 } },
      { card: { name: 'Quiz', image_url: 'https://fixture.invalid/quiz.jpg' }, auction: {},
        giveaway: { kind: 'quiz', options: ['A', 'B'], correctIndex: 0, question: 'Qual?' } }] });
  assert.deepEqual(restored.cards.map(card => card.name), ['Auction', 'Quiz']);
  assert.equal(restored.cards[0].durationMinutes, '3'); assert.equal(restored.cards[0].startingPrice, '10');
  assert.equal(restored.cards[1].giveawayCorrectIndex, '0'); assert.equal(restored.cards[1].giveawayQuestion, 'Qual?');
  assert.equal(restored.cards[1].giveawayOptions, 'A\nB'); assert.equal(restored.groupId, 'group');
  assert.equal(restored.scheduledInput, '2026-10-26T15:00'); assert.equal(restored.commonEndInput, '2026-10-27T01:00');
  assert.equal(restored.intervalValue, '15'); assert.equal(restored.firstLot, '33');
});
