import test from 'node:test';
import assert from 'node:assert/strict';
import {readableIssue} from '../lib/operation-health.ts';
test('operational errors do not expose provider HTML, signed URLs or bearer credentials',()=>{
  assert.equal(readableIssue(null),'');assert.ok(!readableIssue('<!doctype html><html>error</html>').includes('<'));
  const text=readableIssue('Erro https://example.com?token=secret Bearer abc.def\n Tente depois');
  assert.ok(!text.includes('secret'));assert.ok(!text.includes('abc.def'));assert.ok(!text.includes('\n'));assert.equal(readableIssue('x'.repeat(1000)).length,400);
});
