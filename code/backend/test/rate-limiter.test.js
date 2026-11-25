// Limitador de solicitudes por llave (platform/rate-limiter.js): ventanas, simultáneas, reloj inyectado.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, tutorLimiterFromEnv } from '../src/platform/rate-limiter.js';
import { intFromEnv } from '../src/platform/env.js';

/** Reloj manual. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createRateLimiter: ventanas', () => {
  test('deja pasar hasta el máximo y rechaza la siguiente con el tiempo que falta', () => {
    const c = clock();
    const rl = createRateLimiter({ limits: [{ max: 3, windowMs: 60_000 }], maxConcurrent: 0, now: c.now });
    for (let i = 0; i < 3; i++) assert.equal(rl.acquire('ana').allowed, true, `pedido ${i + 1}`);
    c.advance(20_000);
    const denied = rl.acquire('ana');
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'rate');
    assert.equal(denied.retryAfterSeconds, 40);
  });

  test('al vencer la ventana vuelve a dejar pasar', () => {
    const c = clock();
    const rl = createRateLimiter({ limits: [{ max: 2, windowMs: 60_000 }], maxConcurrent: 0, now: c.now });
    rl.acquire('ana'); rl.acquire('ana');
    assert.equal(rl.acquire('ana').allowed, false);
    c.advance(60_000);
    assert.equal(rl.acquire('ana').allowed, true);
  });

  test('cada llave cuenta lo suyo: otro estudiante no se ve afectado', () => {
    const rl = createRateLimiter({ limits: [{ max: 1, windowMs: 60_000 }], maxConcurrent: 0 });
    assert.equal(rl.acquire('ana').allowed, true);
    assert.equal(rl.acquire('ana').allowed, false);
    assert.equal(rl.acquire('benja').allowed, true);
  });

  test('un rechazo no gasta cupo: insistir no alarga la espera', () => {
    const c = clock();
    const rl = createRateLimiter({ limits: [{ max: 1, windowMs: 60_000 }], maxConcurrent: 0, now: c.now });
    rl.acquire('ana');
    for (let i = 0; i < 50; i++) rl.acquire('ana');
    c.advance(60_000);
    assert.equal(rl.acquire('ana').allowed, true, 'tras la ventana entra, aunque haya insistido 50 veces');
  });

  test('con varias ventanas manda la más estricta y avisa la espera más larga', () => {
    const c = clock();
    const rl = createRateLimiter({
      limits: [{ max: 2, windowMs: 60_000 }, { max: 3, windowMs: 3_600_000 }],
      maxConcurrent: 0,
      now: c.now,
    });
    rl.acquire('ana'); rl.acquire('ana');
    assert.equal(rl.acquire('ana').retryAfterSeconds, 60);
    c.advance(60_000);
    assert.equal(rl.acquire('ana').allowed, true);
    c.advance(60_000);
    const denied = rl.acquire('ana');
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterSeconds, 3600 - 120);
  });

  test('el cupo restante baja a medida que se usa', () => {
    const rl = createRateLimiter({ limits: [{ max: 3, windowMs: 60_000 }], maxConcurrent: 0 });
    assert.equal(rl.acquire('ana').remaining, 2);
    assert.equal(rl.acquire('ana').remaining, 1);
  });
});

describe('createRateLimiter: simultáneas', () => {
  test('rechaza cuando hay demasiadas preguntas en curso y vuelve a aceptar al liberar', () => {
    const rl = createRateLimiter({ limits: [{ max: 100, windowMs: 60_000 }], maxConcurrent: 2, concurrentRetrySeconds: 5 });
    const a = rl.acquire('ana');
    rl.acquire('ana');
    const denied = rl.acquire('ana');
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'concurrent');
    assert.equal(denied.retryAfterSeconds, 5);
    a.release();
    assert.equal(rl.acquire('ana').allowed, true);
  });

  test('release es idempotente: llamarlo dos veces no libera un lugar ajeno', () => {
    const rl = createRateLimiter({ limits: [], maxConcurrent: 1 });
    const a = rl.acquire('ana');
    a.release(); a.release();
    const b = rl.acquire('ana');
    assert.equal(b.allowed, true);
    a.release();
    assert.equal(rl.acquire('ana').allowed, false);
  });

  test('un rechazo por simultáneas no gasta cupo de la ventana', () => {
    const rl = createRateLimiter({ limits: [{ max: 2, windowMs: 60_000 }], maxConcurrent: 1 });
    const a = rl.acquire('ana');
    for (let i = 0; i < 20; i++) assert.equal(rl.acquire('ana').reason, 'concurrent');
    a.release();
    assert.equal(rl.acquire('ana').allowed, true, 'solo había gastado 1 de 2');
  });

  test('maxConcurrent 0 desactiva el tope de simultáneas', () => {
    const rl = createRateLimiter({ limits: [], maxConcurrent: 0 });
    for (let i = 0; i < 200; i++) assert.equal(rl.acquire('ana').allowed, true);
  });
});

describe('createRateLimiter: memoria y configuración', () => {
  test('descarta las llaves más antiguas al pasar maxKeys, y liberar una descartada no falla', () => {
    const rl = createRateLimiter({ limits: [{ max: 5, windowMs: 60_000 }], maxConcurrent: 1, maxKeys: 3 });
    const first = rl.acquire('k1');
    rl.acquire('k2'); rl.acquire('k3'); rl.acquire('k4');
    assert.equal(rl.size(), 3);
    assert.doesNotThrow(() => first.release());
  });

  test('rechaza límites mal escritos en vez de dejarlos apagados', () => {
    assert.throws(() => createRateLimiter({ limits: [{ max: 0, windowMs: 1000 }] }), RangeError);
    assert.throws(() => createRateLimiter({ limits: [{ max: 5, windowMs: 0 }] }), RangeError);
    assert.throws(() => createRateLimiter({ limits: [{ max: 1.5, windowMs: 1000 }] }), RangeError);
  });

  test('intFromEnv: vacío usa el valor por defecto; basura falla', () => {
    assert.equal(intFromEnv({}, 'X', 7), 7);
    assert.equal(intFromEnv({ X: '' }, 'X', 7), 7);
    assert.equal(intFromEnv({ X: '12' }, 'X', 7), 12);
    assert.equal(intFromEnv({ X: '0' }, 'X', 7), 0);
    assert.throws(() => intFromEnv({ X: 'diez' }, 'X', 7), /X debe ser un entero/);
    assert.throws(() => intFromEnv({ X: '-1' }, 'X', 7), /X debe ser un entero/);
  });

  test('tutorLimiterFromEnv: valores por defecto y topes desactivables con 0', () => {
    const def = tutorLimiterFromEnv({});
    assert.deepEqual(def.limits, [{ max: 10, windowMs: 60_000 }, { max: 100, windowMs: 3_600_000 }]);
    assert.equal(def.maxConcurrent, 2);
    const custom = tutorLimiterFromEnv({ TUTOR_RATE_PER_MIN: '5', TUTOR_RATE_PER_HOUR: '0', TUTOR_MAX_CONCURRENT: '1' });
    assert.deepEqual(custom.limits, [{ max: 5, windowMs: 60_000 }]);
    assert.equal(custom.maxConcurrent, 1);
    assert.throws(() => tutorLimiterFromEnv({ TUTOR_RATE_PER_MIN: 'mucho' }), /TUTOR_RATE_PER_MIN/);
  });
});
