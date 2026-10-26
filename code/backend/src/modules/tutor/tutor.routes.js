import { Router } from 'express';
import { MODES } from './system-prompt.js';
import { HttpProblem } from '../../platform/problem.js';
import { COURSE_ID_PATTERN, UUID_PATTERN } from './rag/rag.routes.js';
import { streamTurn } from './turn.js';

export const MAX_MESSAGES = 50;
export const MAX_CONTENT_LENGTH = 4000;
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
 * El cliente manda toda la conversación y nada se guarda. El portal del estudiante usa las
 * conversaciones guardadas (conversaciones.routes.js), que comparten la misma lógica (turn.js).
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

    await streamTurn({ req, res, llm, rag, tenantId: tenant, courseId, mode, messages: req.body.messages });
  });

  return router;
}
