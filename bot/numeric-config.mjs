export function finiteNumber(value, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const number = String(value ?? '').trim() === '' ? fallback : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// Invalid retention disables pruning: a configuration typo must never erase backups.
export function backupRetention(value, fallback) {
  if (String(value ?? '').trim() === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : Infinity;
}
