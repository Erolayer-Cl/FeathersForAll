/**
 * Freno de fuerza bruta para el login: cuenta los intentos FALLIDOS por clave (RBD + correo)
 * dentro de una ventana de tiempo. Pasado el máximo, el login responde 429 hasta que la ventana
 * vence; un login correcto borra el contador.
 *
 * Vive en memoria y por proceso: con varias réplicas (HPA, S07) cada pod cuenta lo suyo y un
 * reinicio lo borra. Basta para el MVP; en producción va a Redis o al Ingress/WAF (ver ADR 0007).
 *
 * @param {object} [opts]
 * @param {number} [opts.maxFailures]  fallos permitidos por ventana
 * @param {number} [opts.windowMs]     duración de la ventana
 * @param {number} [opts.maxKeys]      tope de claves en memoria (descarta las más antiguas)
 * @param {() => number} [opts.now]    reloj, inyectable en las pruebas
 */
export function createLoginLimiter({ maxFailures = 5, windowMs = 15 * 60_000, maxKeys = 10_000, now = Date.now } = {}) {
  /** clave -> { count, resetAt } */
  const failures = new Map();

  function current(key) {
    const entry = failures.get(key);
    if (entry && entry.resetAt <= now()) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    /** Segundos que faltan para poder volver a intentar; 0 si puede intentar ahora. */
    retryAfterSeconds(key) {
      const entry = current(key);
      return entry && entry.count >= maxFailures ? Math.ceil((entry.resetAt - now()) / 1000) : 0;
    },

    recordFailure(key) {
      const entry = current(key);
      if (entry) {
        entry.count += 1;
        return;
      }
      // Un Map recorre en orden de inserción: la primera clave es la más antigua.
      if (failures.size >= maxKeys) failures.delete(failures.keys().next().value);
      failures.set(key, { count: 1, resetAt: now() + windowMs });
    },

    reset(key) {
      failures.delete(key);
    },
  };
}
