import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuctionCaption,
  buildCustomValuesPlan,
  buildPollPlan,
  buildPollTitle,
  DEFAULT_POLL_OPTIONS,
  MAX_POLL_OPTIONS,
  parseCustomValues,
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

test('parses custom bid values with commas, semicolons and decimals', () => {
  assert.deepEqual(parseCustomValues('1, 2, 5'), [1, 2, 5]);
  assert.deepEqual(parseCustomValues('1; 1,50; 3'), [1, 1.5, 3]);
  assert.deepEqual(parseCustomValues('2,50'), [2.5]);
  assert.equal(parseCustomValues(''), null);
  assert.equal(parseCustomValues('1, abc'), null);
  assert.equal(parseCustomValues('1, 0, 5'), null);
});

test('custom values build a poll with exact operator-provided amounts', () => {
  const plan = buildCustomValuesPlan([1, 2, 5, 10], true);
  assert.equal(plan.error, null);
  assert.deepEqual(plan.options.map(option => option.amount), [1, 2, 5, 10]);
  assert.deepEqual(plan.options.map(option => option.isBuyout), [false, false, false, true]);
  assert.equal(plan.options[3].label, 'R$ 10,00 🦭');
  assert.equal(plan.startingPrice, 1);
  assert.equal(plan.buyoutPrice, 10);
  // Incremento = menor intervalo (1): o guard do banco (maior lance +
  // incremento) nunca bloqueia uma opção seguinte da própria lista.
  assert.equal(plan.bidIncrement, 1);
});

test('custom values without buyout mark keep every option a regular bid', () => {
  const plan = buildCustomValuesPlan([3, 7, 20], false);
  assert.equal(plan.error, null);
  assert.equal(plan.buyoutPrice, null);
  assert.deepEqual(plan.options.map(option => option.isBuyout), [false, false, false]);
  assert.equal(plan.bidIncrement, 4);
});

test('custom values reject duplicates, descents and overlong lists', () => {
  assert.match(buildCustomValuesPlan([1, 1, 2], true).error ?? '', /ordem crescente/);
  assert.match(buildCustomValuesPlan([5, 2], true).error ?? '', /ordem crescente/);
  assert.match(buildCustomValuesPlan([1], true).error ?? '', /ao menos 2/);
  const tooMany = Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, i) => i + 1);
  assert.match(buildCustomValuesPlan(tooMany, true).error ?? '', /máximo/);
  assert.match(buildCustomValuesPlan([1.005, 2], true).error ?? '', /2 casas decimais/);
});
