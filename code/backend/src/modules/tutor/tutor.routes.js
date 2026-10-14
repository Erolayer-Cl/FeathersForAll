import { Router } from 'express';
import { MODES, SYSTEM_PROMPTS } from './system-prompt.js';
import { HttpProblem } from '../../platform/problem.js';
import { prepareTurn } from './rag/rag-prompt.js';
import { COURSE_ID_PATTERN, UUID_PATTERN } from './rag/rag.routes.js';

const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 4000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

function validateBody(body, coursePattern) {
  if (body?.mode !== undefined && !MODES.includes(body.mode)) {
    return `"mode" debe ser uno de: ${MODES.join(', ')}`;
  }
  if (body?.course_id !== undefined && !(typeof body.course_id === 'string' && coursePattern.test(body.course_id))) {
    return coursePattern === UUID_PATTERN
      ? '"course_id" debe ser un UUID'
      : '"course_id" solo admite letras, números, "-" y "_" (máx. 64)';
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
 * Ruta de desarrollo (fuera del contrato OpenAPI): chat con el tutor.
 * El endpoint oficial POST /courses/{courseId}/tutor-questions reutilizará la misma lógica.
 *
 * Cómo responde (ver prepareTurn en rag/rag-prompt.js):
 *  - charla (saludo, gracias, "¿quién eres?", "estoy nervioso"…) → conversa con el LLM, sin contenidos.
 *  - pregunta de materia con apuntes relevantes → LLM anclado SOLO a esos apuntes, con fuentes [n].
 *  - pregunta de materia sin apuntes relevantes → "No encuentro eso…" fijo, SIN llamar al LLM (no inventa).
 *  - curso sin apuntes → aviso fijo, SIN llamar al LLM.
 *
 * Colegio: si hay JWT, sale del token (claim tenant_id) y se verifica que el usuario pueda usar el curso
 * (estudiante matriculado, docente del curso o admin). Sin token se usa `tenantId` de la config (solo desarrollo).
 * El cliente nunca elige el colegio.
 */
export function createTutorRouter({ llm, rag, tenantId = 'dev', defaultCourseId }) {
  const router = Router();
  const coursePattern = rag?.backend === 'postgres' ? UUID_PATTERN : COURSE_ID_PATTERN;

  router.post('/v1/dev/chat', async (req, res) => {
    const invalid = validateBody(req.body, coursePattern);
    if (invalid) throw new HttpProblem(400, 'Solicitud inválida', invalid);

    const mode = req.body.mode ?? 'tutor';
    const tenant = req.user?.colegioId ?? tenantId;
    const courseId = req.body.course_id ?? defaultCourseId;

    if (rag && courseId && req.user && !(await rag.canUseCourse({ tenantId: tenant, courseId, user: req.user }))) {
      // 404 y no 403: no se revela si el curso existe.
      throw new HttpProblem(404, 'No encontrado', 'El curso no existe o no participas en él', 'not-found');
    }

    const turn = await prepareTurn({
      rag,
      tenantId: tenant,
      courseId,
      messages: req.body.messages,
      systemPrompt: SYSTEM_PROMPTS[mode],
    });

    if (turn.kind !== 'plain') {
      // Solo el tipo de turno y el puntaje: nunca el contenido de la pregunta (menores de edad).
      req.log.info({ rag: turn.kind, best_score: turn.best ?? null }, 'tutor');
      res.set('X-Tutor-Turn', turn.kind);
      res.set('X-Rag-Grounded', String(turn.kind === 'grounded'));
    }

    // Respuestas fijas: no se llama al LLM, así no hay nada que pueda inventar.
    if (turn.kind === 'no-info' || turn.kind === 'no-notes') {
      res.status(200).type('text/plain; charset=utf-8').send(turn.reply);
      return;
    }
    if (turn.kind === 'grounded') {
      res.set('X-Rag-Sources', encodeURIComponent(JSON.stringify(turn.sources)));
    }

    const system = turn.kind === 'plain' ? SYSTEM_PROMPTS[mode] : turn.system;
    const history = turn.kind === 'plain' ? req.body.messages : turn.messages;
    const messages = [{ role: 'system', content: system }, ...history.map(({ role, content }) => ({ role, content }))];

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
      if (!abort.signal.aborted) req.log.warn({ err: err.message }, 'respuesta del LLM interrumpida');
      res.destroy();
    }
  });

  return router;
}
