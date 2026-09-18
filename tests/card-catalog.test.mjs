import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCardAgainstCatalog, isStrictCatalogMode } from '../lib/card-catalog.ts';

const originalFetch = globalThis.fetch;

function withFetch(mock, run) {
  globalThis.fetch = mock;
  return run().finally(() => { globalThis.fetch = originalFetch; });
}

test('carta presente no catalogo: checked=true, exists=true', async () => {
  await withFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ exists: true, cardId: 'svp-001', setId: 'svp' }),
  }), async () => {
    const check = await validateCardAgainstCatalog({ language: 'pt-BR', set: 'svp', number: '001' });
    assert.equal(check.checked, true);
    assert.equal(check.exists, true);
    assert.equal(check.cardId, 'svp-001');
    assert.equal(check.setId, 'svp');
  });
});

test('carta ausente no catalogo: checked=true, exists=false (fantasma rejeitado pela rota)', async () => {
  await withFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ exists: false, cardId: null, setId: null }),
  }), async () => {
    const check = await validateCardAgainstCatalog({ language: 'pt-BR', set: 'xxx', number: '999' });
    assert.equal(check.checked, true);
    assert.equal(check.exists, false, 'a rota usa isso para rejeitar o lote com erro claro');
  });
});

test('servico inacessivel: checked=false com motivo (degradacao honesta, sem strict)', async () => {
  await withFetch(async () => { throw new Error('fetch failed'); }, async () => {
    const check = await validateCardAgainstCatalog({ language: 'pt-BR', set: 'svp', number: '001' });
    assert.equal(check.checked, false, 'Vercel nao ve o localhost do PC do bot');
    assert.equal(check.exists, false);
    assert.ok(check.unreachable, 'o motivo fica registrado para o log da rota');
  });
});

test('resposta http nao-ok: checked=false', async () => {
  await withFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => {
    const check = await validateCardAgainstCatalog({ language: 'pt-BR', set: 'svp', number: '001' });
    assert.equal(check.checked, false);
    assert.match(check.unreachable, /HTTP 500/);
  });
});

test('sem colecao ou sem numero nao ha o que validar', async () => {
  await withFetch(async () => { throw new Error('fetch não deve ser chamado'); }, async () => {
    const noSet = await validateCardAgainstCatalog({ language: 'pt-BR', set: '', number: '001' });
    assert.equal(noSet.checked, false);
    assert.equal(noSet.unreachable, undefined, 'sem referência: nenhuma chamada, nenhum motivo');
    const noNumber = await validateCardAgainstCatalog({ language: 'pt-BR', set: 'svp', number: '' });
    assert.equal(noNumber.checked, false);
  });
});

test('modo estrito e opt-in via RECOGNITION_STRICT_CATALOG', async () => {
  const original = process.env.RECOGNITION_STRICT_CATALOG;
  delete process.env.RECOGNITION_STRICT_CATALOG;
  assert.equal(isStrictCatalogMode(), false, 'default: degrada honestamente');
  process.env.RECOGNITION_STRICT_CATALOG = '1';
  assert.equal(isStrictCatalogMode(), true);
  if (original === undefined) delete process.env.RECOGNITION_STRICT_CATALOG;
  else process.env.RECOGNITION_STRICT_CATALOG = original;
});
