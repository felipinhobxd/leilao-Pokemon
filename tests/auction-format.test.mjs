import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuctionCaption,
  buildPollPlan,
  buildPollTitle,
  DEFAULT_POLL_OPTIONS,
  MAX_POLL_OPTIONS,
} from '../lib/auction-wizard.ts';
import { buildAuctionCaption as buildBotCaption } from '../bot/format.mjs';

test('generates 1 to 5 native poll options automatically', () => {
  const plan = buildPollPlan(1, 1, 5);
  assert.equal(plan.overflow, false);
  assert.deepEqual(plan.options.map(option => option.label), [
    'R$ 1,00', 'R$ 2,00', 'R$ 3,00', 'R$ 4,00', 'R$ 5,00 🦭',
  ]);
});

test('generates 0.50 increments through buyout', () => {
  const plan = buildPollPlan(0.5, 0.5, 3);
  assert.deepEqual(plan.options.map(option => option.label), [
    'R$ 0,50', 'R$ 1,00', 'R$ 1,50', 'R$ 2,00', 'R$ 2,50', 'R$ 3,00 🦭',
  ]);
});

test('does not silently truncate polls over the WhatsApp limit', () => {
  const plan = buildPollPlan(1, 0.1, 5);
  assert.equal(plan.overflow, true);
  assert.equal(plan.optionCount, 41);
  assert.equal(plan.options.length, 0);
  assert.equal(plan.minimumIncrement, 0.37);
  assert.equal(MAX_POLL_OPTIONS, 12);
});

test('without buyout defaults to six options and supports advanced count', () => {
  const normal = buildPollPlan(2, 0.5, null);
  assert.equal(normal.options.length, DEFAULT_POLL_OPTIONS);
  assert.deepEqual(normal.options.map(option => option.label), [
    'R$ 2,00', 'R$ 2,50', 'R$ 3,00', 'R$ 3,50', 'R$ 4,00', 'R$ 4,50',
  ]);
  assert.equal(buildPollPlan(2, 0.5, null, 12).options.length, 12);
});

test('formats compact WhatsApp caption with lot, card number, condition and flag', () => {
  const expected = '♡ 19. Gligar (140/264) NM 🇧🇷\n· ☆';
  assert.equal(buildAuctionCaption({ lotNumber: 19, name: 'Gligar', cardNumber: '140/264', condition: 'NM — Near Mint', language: 'pt-BR' }), expected);
  assert.equal(buildPollTitle(19), '19. Lances');
  assert.equal(buildBotCaption({ name: 'Gligar', card_number: '140/264', condition: 'NM — Near Mint', language: 'pt-BR' }, { lot_number: 19 }), expected);
});
