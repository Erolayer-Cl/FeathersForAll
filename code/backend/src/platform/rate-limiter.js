import { intFromEnv } from './env.js';

/**
 * Limitador de solicitudes por llave (el "portero": "máximo X por minuto").
 *
 * Distinto de `login-limiter.js`, que cuenta solo los intentos FALLIDOS: aquí se cuenta cada solicitud aceptada,
 * porque lo que se protege es el costo (cada pregunta al tutor ocupa el LLM varios segundos).
 *
 * Aplica dos tipos de tope a la vez; basta que uno se pase para rechazar:
 *   - ventanas fijas (`limits`): p. ej. 10 por minuto y 100 por hora;
 *   - solicitudes simultáneas (`maxConcurrent`): preguntas de la misma llave que aún no terminan.
 *
 * Una solicitud rechazada NO gasta cupo.
 *
 * Límites conocidos (aceptados para el MVP, igual que el limitador del login):
 *   - vive en memoria y por proceso: con varias réplicas cada pod cuenta lo suyo (tope real = réplicas × max);
 *     en producción iría en Redis o en el Ingress.
 *   - las ventanas son fijas, no deslizantes: en el borde de dos ventanas se pueden hacer hasta 2×max seguidas.
 *   - `maxKeys` descarta las llaves más antiguas, así la memoria no crece sin límite.
 *
 * @param {object} [opts]
 * @param {{max: number, windowMs: number}[]} [opts.limits]
 * @param {number} [opts.maxConcurrent]  0 = sin tope de simultáneas
 * @param {number} [opts.maxKeys]
 * @param {number} [opts.concurrentRetrySeconds]
 * @param {() => number} [opts.now]  reloj, inyectable en las pruebas
 */
export function createRateLimiter({
  limits = [{ max: 10, windowMs: 60_000 }, { max: 100, windowMs: 3_600_000 }],
  maxConcurrent = 2,
  maxKeys = 10_000,
  concurrentRetrySeconds = 3,
  now = Date.now,
} = {}) {
  for (const { max, windowMs } of limits) {
    if (!Number.isInteger(max) || max < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
      throw new RangeError('Cada límite necesita "max" (entero ≥ 1) y "windowMs" (> 0)');
    }
  }

  /** llave -> { windows: [{ count, resetAt }] (en el orden de `limits`), inflight } */
  const state = new Map();

  function stateOf(key) {
    let s = state.get(key);
    if (!s) {
      if (state.size >= maxKeys) state.delete(state.keys().next().value); // la primera llave es la más antigua
      s = { windows: limits.map(() => ({ count: 0, resetAt: 0 })), inflight: 0 };
      state.set(key, s);
    }
    return s;
  }

  return {
    limits,
    maxConcurrent,

    /**
     * Pide un cupo para una solicitud de `key`.
     * Si `allowed`, hay que llamar a `release()` cuando termine (se puede llamar más de una vez).
     * @returns {{allowed: true, release: () => void, remaining: number}
     *   | {allowed: false, reason: 'rate' | 'concurrent', retryAfterSeconds: number}}
     */
    acquire(key) {
      const t = now();
      const s = stateOf(key);
      s.windows.forEach((w) => {
        if (w.resetAt <= t) { w.count = 0; w.resetAt = 0; }
      });

      // Se avisa la espera MÁS LARGA entre las ventanas llenas (si esperara menos, volvería a toparse).
      let wait = 0;
      s.windows.forEach((w, i) => {
        if (w.count >= limits[i].max) wait = Math.max(wait, Math.ceil((w.resetAt - t) / 1000));
      });
      if (wait > 0) return { allowed: false, reason: 'rate', retryAfterSeconds: wait };

      if (maxConcurrent > 0 && Number.isFinite(maxConcurrent) && s.inflight >= maxConcurrent) {
        return { allowed: false, reason: 'concurrent', retryAfterSeconds: concurrentRetrySeconds };
      }

      s.windows.forEach((w, i) => {
        if (w.resetAt === 0) w.resetAt = t + limits[i].windowMs;
        w.count += 1;
      });
      s.inflight += 1;

      let released = false;
      const remaining = limits.length ? Math.min(...s.windows.map((w, i) => limits[i].max - w.count)) : Infinity;
      return {
        allowed: true,
        remaining,
        release() {
          if (released) return;
          released = true;
          const current = state.get(key); // si la llave fue descartada por maxKeys, no hay nada que devolver
          if (current && current.inflight > 0) current.inflight -= 1;
        },
      };
    },

    size: () => state.size,
  };
}

/**
 * Limitador del tutor desde variables de entorno. 0 en un tope lo desactiva.
 *   TUTOR_RATE_PER_MIN     preguntas por minuto y por estudiante   (10)
 *   TUTOR_RATE_PER_HOUR    preguntas por hora y por estudiante     (100)
 *   TUTOR_MAX_CONCURRENT   preguntas simultáneas por estudiante    (2)
 */
export function tutorLimiterFromEnv(env = process.env, overrides = {}) {
  const perMin = intFromEnv(env, 'TUTOR_RATE_PER_MIN', 10);
  const perHour = intFromEnv(env, 'TUTOR_RATE_PER_HOUR', 100);
  const maxConcurrent = intFromEnv(env, 'TUTOR_MAX_CONCURRENT', 2);
  const limits = [];
  if (perMin > 0) limits.push({ max: perMin, windowMs: 60_000 });
  if (perHour > 0) limits.push({ max: perHour, windowMs: 3_600_000 });
  return createRateLimiter({ limits, maxConcurrent, ...overrides });
}
