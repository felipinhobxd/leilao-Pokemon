import test from 'node:test';
import assert from 'node:assert/strict';
import {readableIssue,cleanupReason,readCleanupReport} from '../lib/operation-health.ts';
test('operational errors do not expose provider HTML, signed URLs or bearer credentials',()=>{
  assert.equal(readableIssue(null),'');assert.ok(!readableIssue('<!doctype html><html>error</html>').includes('<'));
  const text=readableIssue('Erro https://example.com?token=secret Bearer abc.def\n Tente depois');
  assert.ok(!text.includes('secret'));assert.ok(!text.includes('abc.def'));assert.ok(!text.includes('\n'));assert.equal(readableIssue('x'.repeat(1000)).length,400);
});

test('cleanup report exposes only known reasons and valid historical outcomes',()=>{
 assert.equal(readCleanupReport(null),null);
 assert.equal(readCleanupReport({status:'completed',at:'invalid'}),null);
 assert.equal(readCleanupReport({status:'unknown',at:'2026-10-26T03:00:00Z'}),null);
 const valid=readCleanupReport({status:'blocked',at:'2026-10-26T03:00:00Z',reason:'backup_coverage_incomplete',deleted:0});
 assert.match(cleanupReason(valid.reason),/alterados depois/);
 const invalid=readCleanupReport({status:'failed',at:'2026-10-26T03:00:00Z',reason:'<html>secret',deleted:-1});
 assert.equal(invalid.reason,'');assert.equal(invalid.deleted,0);
 assert.equal(typeof cleanupReason('toString'),'string');
});
