import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import ExcelJS from 'exceljs';
import { exportHistoryFixture } from './fixtures/export-history.mjs';

const backend = 'data:text/javascript,' + encodeURIComponent(`
export const state = { data: null, calls: 0, fail: false };
export async function authorize(request) { if (!request.headers.has('authorization')) { const e=new Error('Login necessário');e.status=401;throw e; } return {db:{}}; }
export async function snapshot() { state.calls++; if(state.fail) throw new Error('database_read_failed'); return state.data; }
export function failure(e) { return Response.json({error:e.message},{status:e.status??500}); }
`);
const hook = registerHooks({ resolve(s, c, next) {
  if (s === '@/lib/backend') return { url: backend, shortCircuit: true };
  if (['@/lib/export-rows', '@/lib/brasilia-time'].includes(s)) return { url: new URL(`../lib/${s.split('/').at(-1)}.ts`, import.meta.url).href, shortCircuit: true };
  return next(s, c);
} });
const { GET } = await import('../app/api/export/route.ts');
const { state } = await import(backend);
hook.deregister();

test('real Excel route: protected download, one snapshot, XLSX date/money/history roundtrip', async () => {
  state.data = exportHistoryFixture(); state.calls = 0;
  const denied = await GET(new Request('http://local/api/export'));
  assert.equal(denied.status, 401);
  assert.equal(state.calls, 0);
  const response = await GET(new Request('http://local/api/export', { headers: { authorization: 'Bearer test' } }));
  assert.equal(response.status, 200);
  assert.equal(state.calls, 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-disposition'), /leilao-pokemon.xlsx/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = book.getWorksheet('Lances por participante');
  assert.equal(sheet.getCell('E2').value, 50);
  assert.equal(sheet.getCell('H2').value, 60);
  assert.equal(sheet.getCell('F2').value.toISOString(), '2026-10-26T01:00:00.123Z');
  assert.equal(sheet.getCell('I2').value.toISOString(), '2026-10-26T01:00:15.987Z');
  assert.equal(sheet.getCell('F2').numFmt, 'dd/mm/yyyy hh:mm:ss.000');
  assert.equal(sheet.views[0].xSplit, 3);
  assert.equal(sheet.getCell('B2').value, '=Pikachu', 'user text is not a formula');
  const changes = book.getWorksheet('Alterações de valores');
  assert.match(changes.getCell('K3').value, /50,00 → R\$\s40,00/);
  assert.equal(changes.getCell('L3').value.toISOString(), '2026-10-26T01:00:00.123Z');
  assert.equal(changes.getCell('J3').value.toISOString(), '2026-10-26T01:00:00.456Z');
  const sales = book.getWorksheet('Vendas');
  assert.equal(sales.getCell('G2').value, 60);
  assert.equal(sales.getCell('G3').value.formula, 'SUM(G2:G2)');
  const raw = book.getWorksheet('Lances');
  assert.equal(raw.getCell('J1').value, 'Horário WhatsApp (Brasília)');
  assert.equal(raw.getCell('J2').value.toISOString(), '2026-10-26T01:00:15.987Z');
  assert.equal(book.getWorksheet('Resumo').getCell('B5').value, 60);
});

test('snapshot failure produces an error response instead of a corrupt spreadsheet', async () => {
  state.fail = true;
  try {
    const response = await GET(new Request('http://local/api/export', { headers: { authorization: 'Bearer test' } }));
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'database_read_failed');
  } finally { state.fail = false; }
});
