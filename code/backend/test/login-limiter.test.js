import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLimiter } from '../src/platform/login-limiter.js';

describe('freno de intentos del login', () => {
  const reloj = () => {
    let t = 1_000_000;
    return { now: () => t, avanzar: (ms) => { t += ms; } };
  };

  test('bloquea tras el máximo de fallos y dice cuánto esperar', () => {
    const c = reloj();
    const limiter = createLoginLimiter({ maxFailures: 3, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 2; i++) limiter.recordFailure('99901|camila@demo-a.cl');
    assert.equal(limiter.retryAfterSeconds('99901|camila@demo-a.cl'), 0);
    limiter.recordFailure('99901|camila@demo-a.cl');
    assert.equal(limiter.retryAfterSeconds('99901|camila@demo-a.cl'), 60);
    c.avanzar(15_000);
    assert.equal(limiter.retryAfterSeconds('99901|camila@demo-a.cl'), 45);
  });

  test('la ventana vence y vuelve a permitir', () => {
    const c = reloj();
    const limiter = createLoginLimiter({ maxFailures: 1, windowMs: 60_000, now: c.now });
    limiter.recordFailure('k');
    assert.ok(limiter.retryAfterSeconds('k') > 0);
    c.avanzar(60_000);
    assert.equal(limiter.retryAfterSeconds('k'), 0);
  });

  test('cada cuenta cuenta por separado y un login correcto borra el contador', () => {
    const limiter = createLoginLimiter({ maxFailures: 1 });
    limiter.recordFailure('a');
    assert.ok(limiter.retryAfterSeconds('a') > 0);
    assert.equal(limiter.retryAfterSeconds('b'), 0);
    limiter.reset('a');
    assert.equal(limiter.retryAfterSeconds('a'), 0);
  });

  test('no crece sin límite: descarta las claves más antiguas', () => {
    const limiter = createLoginLimiter({ maxFailures: 1, maxKeys: 2 });
    limiter.recordFailure('1');
    limiter.recordFailure('2');
    limiter.recordFailure('3');
    assert.equal(limiter.retryAfterSeconds('1'), 0);
    assert.ok(limiter.retryAfterSeconds('3') > 0);
  });
});
