import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { parseLimit } from '../../platform/pagination.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import * as Q from '../../../db/queries.js';
import { MODES } from './system-prompt.js';
import { MAX_CONTENT_LENGTH, MAX_MESSAGES } from './tutor.routes.js';
import { streamTurn } from './turn.js';

const TITLE_CHARS = 60;

const notFound = () => new HttpProblem(404, 'No encontrado', 'La conversación o el curso no existe, o no es tuyo', 'not-found');
const soloEstudiante = (user) => {
  if (user.rol !== 'estudiante') {
    throw new HttpProblem(403, 'Prohibido', 'Las conversaciones con el tutor son solo de cada estudiante', 'forbidden');
  }
};

/** Título de la conversación: el inicio de la primera pregunta, en una línea. Cuenta caracteres reales (no parte un emoji). */
export function conversationTitle(text) {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length > TITLE_CHARS ? `${chars.slice(0, TITLE_CHARS - 1).join('').trimEnd()}…` : chars.join('');
}

/** Fila de la base -> schema TutorConversation del contrato. */
const toConversation = (row) => ({
  id: row.id,
  course_id: row.curso_id,
  mode: row.modo,
  title: row.titulo,
  ...(row.mensajes !== undefined && { messages_count: row.mensajes }),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const toMessage = (row) => ({ role: row.rol, content: row.contenido, sources: row.fuentes, created_at: row.created_at });

/**
 * Conversaciones guardadas del Tutor IA (ADR 0008). Requiere req.user (requireAuth).
 * Solo el estudiante dueño las ve, escribe y borra: la API responde 403 a los demás roles y,
 * además, la base lo exige (RLS de 05_conversaciones_tutor.sql). Nunca se registra su contenido en los logs.
 *
 * El id de la conversación lo genera el cliente: el primer mensaje la crea. Así no hace falta un
 * POST previo ni Idempotency-Key, y un turno que falla (LLM caído, el estudiante se fue) no deja
 * conversaciones vacías: se guarda pregunta + respuesta juntas solo cuando la respuesta terminó.
 */
export function createConversacionesRouter({ db, llm, rag }) {
  const router = Router();
  const read = (user, fn) => db.withUser(user, fn, { readOnly: true });
  const cursoVisible = async (c, courseId) => (await c.query('SELECT puede_ver_curso($1) AS ok', [courseId])).rows[0].ok === true;

  router.get('/v1/courses/:courseId/tutor-conversations', async (req, res) => {
    soloEstudiante(req.user);
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const limit = parseLimit(req.query.limit);
    const rows = await read(req.user, async (c) => {
      if (!(await cursoVisible(c, courseId))) throw notFound();
      return (await c.query(Q.CONVERSACIONES_CURSO, [courseId, limit])).rows;
    });
    res.json({ data: rows.map(toConversation) });
  });

  router.get('/v1/tutor-conversations/:conversationId', async (req, res) => {
    soloEstudiante(req.user);
    const id = uuidParam(req.params.conversationId, 'conversationId');
    const found = await read(req.user, async (c) => {
      const conv = (await c.query(Q.CONVERSACION, [id])).rows[0];
      if (!conv) return null;
      const messages = (await c.query(Q.MENSAJES_CONVERSACION, [id, 1000])).rows;
      return { ...toConversation(conv), messages: messages.map(toMessage) };
    });
    if (!found) throw notFound();
    res.json(found);
  });

  router.delete('/v1/tutor-conversations/:conversationId', async (req, res) => {
    soloEstudiante(req.user);
    const id = uuidParam(req.params.conversationId, 'conversationId');
    // Sin permiso o de otro usuario: el RLS deja 0 filas y se responde 404.
    const deleted = await db.withUser(req.user, async (c) => (await c.query(Q.BORRAR_CONVERSACION, [id])).rowCount);
    if (deleted === 0) throw notFound();
    res.status(204).end();
  });

  router.post('/v1/courses/:courseId/tutor-conversations/:conversationId/messages', async (req, res) => {
    soloEstudiante(req.user);
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const id = uuidParam(req.params.conversationId, 'conversationId');
    const { content, mode: requestedMode } = req.body ?? {};
    if (typeof content !== 'string' || !content.trim() || content.length > MAX_CONTENT_LENGTH) {
      throw invalid(`"content" debe ser texto de 1 a ${MAX_CONTENT_LENGTH} caracteres`);
    }
    if (requestedMode !== undefined && !MODES.includes(requestedMode)) {
      throw invalid(`"mode" debe ser uno de: ${MODES.join(', ')}`);
    }
    const text = content.trim();

    // Historial guardado (si la conversación ya existe) y su modo, que manda sobre el del cuerpo.
    const { mode, history } = await read(req.user, async (c) => {
      if (!(await cursoVisible(c, courseId))) throw notFound();
      const conv = (await c.query(Q.CONVERSACION, [id])).rows[0];
      if (!conv) return { mode: requestedMode ?? 'tutor', history: [] };
      if (conv.curso_id !== courseId) throw notFound();
      const rows = (await c.query(Q.MENSAJES_CONVERSACION, [id, MAX_MESSAGES - 1])).rows;
      return { mode: conv.modo, history: rows.map((r) => ({ role: r.rol, content: r.contenido })) };
    });
    // El historial debe empezar con una pregunta (el recorte por cantidad puede dejar una respuesta primero).
    while (history[0]?.role === 'assistant') history.shift();

    res.set('X-Conversation-Mode', mode);
    await streamTurn({
      req,
      res,
      llm,
      rag,
      tenantId: req.user.colegioId,
      courseId,
      mode,
      messages: [...history, { role: 'user', content: text }],
      // Pregunta y respuesta se guardan juntas, y solo si la respuesta terminó.
      onAnswer: (answer) =>
        db.withUser(req.user, async (c) => {
          await c.query(Q.CREAR_CONVERSACION, [id, courseId, mode, conversationTitle(text)]);
          await c.query(Q.INSERTAR_MENSAJE, [id, 'user', text, '[]']);
          await c.query(Q.INSERTAR_MENSAJE, [id, 'assistant', answer.text, JSON.stringify(answer.sources)]);
          await c.query(Q.TOCAR_CONVERSACION, [id]);
        }),
    });
  });

  return router;
}
