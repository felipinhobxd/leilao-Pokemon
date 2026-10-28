import test from 'node:test';
import assert from 'node:assert/strict';
import { backupRetention, finiteNumber } from './numeric-config.mjs';

test('invalid retention preserves every existing backup, including the latest', () => {
  const files = ['latest', 'older', 'oldest'];
  for (const value of ['invalid', 'NaN', 'Infinity', '-1', '0', '1.5']) {
    assert.deepEqual(files.slice(backupRetention(value, 30)), []);
  }
  assert.equal(backupRetention(undefined, 30), 30);
  assert.equal(backupRetention('', 7), 7);
  assert.deepEqual(files.slice(backupRetention('2', 30)), ['oldest']);
});

test('invalid heartbeat/QR/photo delay never reaches Node as NaN or Infinity', () => {
  for (const value of ['bad', 'NaN', 'Infinity', undefined, '']) {
    assert.equal(finiteNumber(value, 12, 10, 15) * 1000, 12000);
    assert.equal(finiteNumber(value, 90, 45, 180) * 1000, 90000);
    assert.equal(finiteNumber(value, 5000, 0), 5000);
  }
  assert.equal(finiteNumber('0', 12, 10, 15), 10);
  assert.equal(finiteNumber('100', 12, 10, 15), 15);
});
