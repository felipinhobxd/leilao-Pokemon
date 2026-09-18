import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_SECONDS,
  __resetRateLimitForTests,
  enforceUserRateLimit,
} from '../lib/rate-limit.ts';

const NO_REDIS = { ...process.env };
delete NO_REDIS.REDIS_URL;

test('limite respeitado por janela e usuario (fallback in-memory)', async () => {
  __resetRateLimitForTests();
  const now = 1_700_000_000_000;
  for (let i = 1; i <= 3; i++) {
    const decision = await enforceUserRateLimit('test', 'user-a', { limit: 3, windowSeconds: 60, now });
    assert.equal(decision.allowed, true, `requisicao ${i} dentro do limite deve passar`);
    assert.equal(decision.backend, 'memory', 'sem REDIS_URL o backend e in-memory');
    assert.equal(decision.remaining, 3 - i);
  }
  const denied = await enforceUserRateLimit('test', 'user-a', { limit: 3, windowSeconds: 60, now });
  assert.equal(denied.allowed, false, 'a 4a requisicao em 1 minuto e negada');
  assert.equal(denied.remaining, 0);
  assert.ok(denied.retryAfterSeconds >= 1 && denied.retryAfterSeconds <= 60, 'Retry-After em segundos dentro da janela');
});

test('limites sao independentes por usuario e por escopo', async () => {
  __resetRateLimitForTests();
  const now = 1_700_000_000_000;
  const first = await enforceUserRateLimit('test', 'user-a', { limit: 1, windowSeconds: 60, now });
  assert.equal(first.allowed, true);
  const sameUser = await enforceUserRateLimit('test', 'user-a', { limit: 1, windowSeconds: 60, now });
  assert.equal(sameUser.allowed, false, 'mesmo usuario esgota o proprio limite');
  const otherUser = await enforceUserRateLimit('test', 'user-b', { limit: 1, windowSeconds: 60, now });
  assert.equal(otherUser.allowed, true, 'outro usuario tem limite proprio');
  const otherScope = await enforceUserRateLimit('other-scope', 'user-a', { limit: 1, windowSeconds: 60, now });
  assert.equal(otherScope.allowed, true, 'escopo diferente tem contador proprio');
});

test('janela fixa: contadores resetam na janela seguinte', async () => {
  __resetRateLimitForTests();
  const t0 = 1_699_999_980_000; // alinhado ao início de uma janela de 60s
  const windowSeconds = 60;
  await enforceUserRateLimit('test', 'user-a', { limit: 1, windowSeconds, now: t0 });
  const denied = await enforceUserRateLimit('test', 'user-a', { limit: 1, windowSeconds, now: t0 + 1000 });
  assert.equal(denied.allowed, false, 'ainda na mesma janela');
  assert.equal(denied.retryAfterSeconds, 59, 'Retry-After aponta o fim da janela');
  const next = await enforceUserRateLimit('test', 'user-a', { limit: 1, windowSeconds, now: t0 + windowSeconds * 1000 });
  assert.equal(next.allowed, true, 'janela nova, contador novo');
});

test('defaults: 50 por 60s e limites invalidos clampados', async () => {
  __resetRateLimitForTests();
  const now = 1_700_000_000_000;
  const decision = await enforceUserRateLimit('test', 'user-d', { now });
  assert.equal(decision.limit, DEFAULT_RATE_LIMIT);
  assert.equal(decision.backend, 'memory');
  const weird = await enforceUserRateLimit('test', 'user-e', { limit: 0, windowSeconds: 0, now });
  assert.equal(weird.limit, 1, 'limite clampado para 1');
  assert.equal(weird.allowed, true, 'com limite 1 a primeira requisicao passa');
  const second = await enforceUserRateLimit('test', 'user-e', { limit: 0, windowSeconds: 0, now });
  assert.equal(second.allowed, false, 'e a segunda e negada');
});

test('defaults da rota: 50/60 documentados como contrato', () => {
  assert.equal(DEFAULT_RATE_LIMIT, 50);
  assert.equal(DEFAULT_RATE_WINDOW_SECONDS, 60);
});
