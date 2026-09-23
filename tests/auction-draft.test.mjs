import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUCTION_DRAFT_MAX_CARDS,
  AUCTION_DRAFT_MAX_CANDIDATES,
  AUCTION_DRAFT_VERSION,
  buildDraftState,
  buildDraftTitle,
  normalizeDraftCard,
  restoreDraftState,
} from '../lib/auction-draft.ts';

const baseCard = (overrides = {}) => ({
  imageUrl: 'https://cdn.example.com/cards/abc.webp',
  extraImages: ['https://cdn.example.com/cards/def.webp'],
  name: 'Pikachu',
  collection: 'Base Set',
  cardNumber: '25/102',
  variant: 'Normal',
  condition: 'NM — Near Mint',
  language: 'pt-BR',
  pricingMode: 'increment',
  customValues: '',
  customBuyoutLast: true,
  lotNumber: '1',
  startingPrice: '5',
  increment: '1',
  buyout: '',
  durationMinutes: '2',
  optionCount: '6',
  recognitionStage: 'identified',
  recognitionMessage: '193 ms · 2 consulta(s) ao catálogo',
  recognitionCandidates: [
    { id: 'x', name: 'Pikachu', collection: 'Base Set', cardNumber: '25/102', localId: '25', denominator: 102, language: 'en', variant: 'Holo', score: 87 },
    { id: 'y', name: 'Raichu', collection: 'Base Set', cardNumber: '14/102', localId: '14', denominator: 102, language: 'en', score: 61 },
    { id: '', name: 'Sem id vira lixo', collection: '', cardNumber: '', localId: '', denominator: null, language: 'en', score: 10 },
    'não sou objeto',
  ],
  manualFields: { name: true, language: false, bogus: true },
  ...overrides,
});

const baseInput = (cards) => ({
  step: 2,
  firstLot: '3',
  groupId: '99999999-9999-9999-9999-999999999999',
  intervalValue: '30',
  intervalUnit: 'seconds',
  publication: 'scheduled',
  scheduledInput: '2026-09-25T20:00',
  cards,
});

test('buildDraftState serializa o estado do wizard com versão e cards normalizados', () => {
  const state = buildDraftState(baseInput([baseCard()]));
  assert.equal(state.version, AUCTION_DRAFT_VERSION);
  assert.equal(state.step, 2);
  assert.equal(state.firstLot, '3');
  assert.equal(state.cards.length, 1);
  assert.equal(state.cards[0].name, 'Pikachu');
});

test('round trip: restore(JSON(build)) devolve exatamente o que foi salvo', () => {
  const state = buildDraftState(baseInput([baseCard(), baseCard({ name: 'Charizard', lotNumber: '2', pricingMode: 'custom', customValues: '1, 2, 5, 10' })]));
  const restored = restoreDraftState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
});

test('estágios transitórios de reconhecimento não sobrevivem ao rascunho', () => {
  const state = buildDraftState(baseInput([baseCard({ recognitionStage: 'queued' }), baseCard({ recognitionStage: 'analyzing' }), baseCard({ recognitionStage: 'review' })]));
  assert.equal(state.cards[0].recognitionStage, 'idle');
  assert.equal(state.cards[1].recognitionStage, 'idle');
  assert.equal(state.cards[2].recognitionStage, 'review');
});

test('candidatos: sem id são descartados e o máximo é respeitado', () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, name: `N${index}`, collection: 'S', cardNumber: '1/10', localId: '1', denominator: 10, language: 'en', score: 50 }));
  const state = buildDraftState(baseInput([baseCard({ recognitionCandidates: many })]));
  assert.equal(state.cards[0].recognitionCandidates.length, AUCTION_DRAFT_MAX_CANDIDATES);
  assert.deepEqual(state.cards[0].recognitionCandidates.map(candidate => candidate.id), ['c0', 'c1', 'c2', 'c3', 'c4']);
  const fromBase = buildDraftState(baseInput([baseCard()]));
  assert.equal(fromBase.cards[0].recognitionCandidates.length, 2, 'candidato sem id e não-objeto caem fora');
});

test('manualFields: só campos reconhecíveis com true sobrevivem', () => {
  const state = buildDraftState(baseInput([baseCard()]));
  assert.deepEqual(state.cards[0].manualFields, { name: true });
});

test('defaults defensivos: condição/idioma/variante/pricing inválidos normalizam', () => {
  const state = buildDraftState(baseInput([baseCard({ condition: 'qualquer coisa', language: 'es', variant: '', pricingMode: 'estranho', extraImages: ['a', 'https://ok/1', 42, null, 'https://ok/2', 'https://ok/3', 'https://ok/4'] })]));
  const card = state.cards[0];
  assert.equal(card.condition, 'NM — Near Mint');
  assert.equal(card.language, 'other', 'es saiu dos idiomas de operação');
  assert.equal(card.variant, 'Normal');
  assert.equal(card.pricingMode, 'increment');
  assert.deepEqual(card.extraImages, ['https://ok/1', 'https://ok/2', 'https://ok/3', 'https://ok/4'], 'não-strings caem e máximo de 4');
});

test('step fora do intervalo volta para um valor válido', () => {
  assert.equal(buildDraftState(baseInput([baseCard()])).step, 2);
  assert.equal(buildDraftState({ ...baseInput([baseCard()]), step: 99 }).step, 4);
  assert.equal(buildDraftState({ ...baseInput([baseCard()]), step: 0 }).step, 1);
  assert.equal(buildDraftState({ ...baseInput([baseCard()]), step: 'x' }).step, 1);
});

test('guards: sem cartas ou com cartas demais rejeita', () => {
  assert.throws(() => buildDraftState(baseInput([])), /pelo menos uma carta/);
  assert.throws(() => buildDraftState(baseInput(Array.from({ length: AUCTION_DRAFT_MAX_CARDS + 1 }, () => baseCard()))), /máximo/);
});

test('restore rejeita versão não suportada e payload sem cartas', () => {
  const state = buildDraftState(baseInput([baseCard()]));
  assert.throws(() => restoreDraftState({ ...JSON.parse(JSON.stringify(state)), version: AUCTION_DRAFT_VERSION + 1 }), /versão/);
  assert.throws(() => restoreDraftState({ ...JSON.parse(JSON.stringify(state)), cards: [] }), /sem cartas/);
  assert.throws(() => restoreDraftState('não sou objeto'), /corrompido/);
  assert.throws(() => normalizeDraftCard(42), /corrompido/);
});

test('mensagem de reconhecimento é truncada para não inflar o payload', () => {
  const state = buildDraftState(baseInput([baseCard({ recognitionMessage: 'x'.repeat(500) })]));
  assert.equal(state.cards[0].recognitionMessage.length, 300);
});

test('buildDraftTitle: data de Brasília + contagem de cartas', () => {
  const when = new Date('2026-09-23T17:32:00Z');
  assert.equal(buildDraftTitle(when, 12), 'Rascunho de 23/09/2026 14:32 · 12 cartas');
  assert.equal(buildDraftTitle(when, 1), 'Rascunho de 23/09/2026 14:32 · 1 carta');
});
