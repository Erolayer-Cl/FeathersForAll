import { HttpProblem } from '../../platform/problem.js';

/**
 * Toma un cupo del limitador del tutor para esta pregunta, o responde 429 (RFC 7807) con `Retry-After`.
 * El cupo se devuelve cuando la respuesta termina o el cliente se va (evento `close`); mientras el tutor responde,
 * cuenta como pregunta en curso (tope de simultáneas).
 *
 * La llave es el usuario del JWT; sin token (solo desarrollo) es la IP. Nunca se mira ni se registra el contenido.
 *
 * @param {ReturnType<import('../../platform/rate-limiter.js').createRateLimiter> | null | undefined} limiter  null = sin límite
 */
export function takeTutorSlot(limiter, req, res) {
  if (!limiter) return;
  const key = req.user ? `tutor|u|${req.user.id}` : `tutor|ip|${req.ip}`;
  const slot = limiter.acquire(key);
  if (!slot.allowed) {
    res.set('Retry-After', String(slot.retryAfterSeconds));
    req.log?.warn({ reason: slot.reason, retry_after_s: slot.retryAfterSeconds }, 'tutor: pregunta rechazada por límite');
    const detail = slot.reason === 'concurrent'
      ? 'Todavía estoy respondiendo tu pregunta anterior. Espera a que termine para hacer otra.'
      : `Hiciste muchas preguntas seguidas. Vuelve a intentarlo en ${slot.retryAfterSeconds} segundos.`;
    throw new HttpProblem(429, 'Demasiadas preguntas', detail, 'too-many-requests');
  }
  res.once('close', slot.release);
}
