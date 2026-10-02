import { Router } from 'express';
import { MODES, SYSTEM_PROMPTS } from './system-prompt.js';
import { HttpProblem } from '../../platform/problem.js';

const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 4000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

function validateBody(body) {
  if (body?.mode !== undefined && !MODES.includes(body.mode)) {
    return `"mode" debe ser uno de: ${MODES.join(', ')}`;
  }
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return `"messages" debe ser un arreglo de 1 a ${MAX_MESSAGES} elementos`;
  }
  for (const [i, m] of messages.entries()) {
    if (!ALLOWED_ROLES.has(m?.role)) return `messages[${i}].role debe ser "user" o "assistant"`;
    if (typeof m.content !== 'string' || !m.content.trim() || m.content.length > MAX_CONTENT_LENGTH) {
      return `messages[${i}].content debe ser texto de 1 a ${MAX_CONTENT_LENGTH} caracteres`;
    }
  }
  if (messages.at(-1).role !== 'user') return 'El último mensaje debe ser del usuario';
  return null;
}

/**
 * Ruta de desarrollo (fuera del contrato OpenAPI): chat directo con el LLM.
 * El endpoint oficial POST /courses/{courseId}/tutor-questions reutilizará el mismo cliente.
 */
export function createTutorRouter({ llm }) {
  const router = Router();

  router.post('/v1/dev/chat', async (req, res) => {
    const invalid = validateBody(req.body);
    if (invalid) throw new HttpProblem(400, 'Solicitud inválida', invalid);

    const mode = req.body.mode ?? 'tutor';
    const messages = [
      { role: 'system', content: SYSTEM_PROMPTS[mode] },
      ...req.body.messages.map(({ role, content }) => ({ role, content })),
    ];

    // Si el cliente cierra la conexión, se corta también la generación en el LLM.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    const stream = llm.chat(messages, { signal: abort.signal });

    // Se espera el primer fragmento antes de enviar cabeceras: si el LLM está
    // caído, todavía se puede responder un 503 RFC 7807 en vez de un 200 vacío.
    const first = await stream.next();

    res.status(200);
    res.type('text/plain; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      if (!first.done) res.write(first.value);
      for await (const chunk of stream) res.write(chunk);
      res.end();
    } catch (err) {
      // Las cabeceras ya salieron: se corta la conexión para que el cliente
      // detecte la respuesta incompleta y lo muestre como error.
      if (!abort.signal.aborted) req.log.warn({ err: err.message }, 'respuesta del LLM interrumpida');
      res.destroy();
    }
  });

  return router;
}
