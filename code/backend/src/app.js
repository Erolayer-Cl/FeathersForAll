import express from 'express';
import { requestContext } from './platform/request-context.js';
import { notFound, problemHandler } from './platform/problem.js';
import { optionalAuth, requireAuth } from './platform/auth.js';
import { createTutorRouter } from './modules/tutor/tutor.routes.js';
import { createRagRouter } from './modules/tutor/rag/rag.routes.js';
import { createNotasRouter } from './modules/notas/notas.routes.js';

/**
 * @param {object} deps
 * @param {import('pino').Logger} deps.logger
 * @param {{chat: Function, ping: Function}} deps.llm
 * @param {ReturnType<import('./platform/db.js').createDb>} [deps.db] sin db no se montan las rutas de notas
 * @param {string} [deps.jwtSecret]         secreto HS256 del JWT
 * @param {object} [deps.rag]               servicio RAG (omitir = tutor sin apuntes)
 * @param {string} [deps.tenantId]          colegio del chat cuando la petición NO trae token (solo desarrollo)
 * @param {string} [deps.defaultCourseId]   curso usado si el chat no envía `course_id`
 * @param {boolean} [deps.enableIngestApi]  expone la carga de apuntes por API (solo desarrollo)
 * @param {boolean} [deps.chatRequiresAuth] el chat exige JWT (producción)
 */
export function createApp({
  logger, llm, db, jwtSecret, rag, tenantId = 'dev', defaultCourseId,
  enableIngestApi = true, chatRequiresAuth = false,
}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestContext(logger));

  // Antes del parser global: la carga de apuntes trae su propio límite de tamaño.
  // Con PostgreSQL exige JWT (la base valida además que sea el docente del curso o el admin).
  if (rag && enableIngestApi) {
    const guard = rag.backend === 'postgres' ? [requireAuth(jwtSecret)] : [];
    app.use('/v1/dev/courses', ...guard, createRagRouter({ rag, tenantId }));
  }
  app.use(express.json({ limit: '100kb' }));

  // Sondas de Kubernetes (S07). Livez: el proceso responde (sin dependencias, para no reiniciar
  // pods por culpa de Ollama o la BD). Readyz: puede atender (la BD responde, si está configurada).
  // El LLM no cuenta: si Ollama cae, el chat ya responde 503 RFC 7807 y el resto de la API sigue.
  app.get('/livez', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    const dbUp = db ? await db.ping() : true;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ready' : 'not-ready', db: db ? (dbUp ? 'up' : 'down') : 'disabled' });
  });

  app.get('/health', async (_req, res) => {
    const [llmUp, dbUp] = await Promise.all([llm.ping(), db?.ping()]);
    res.json({
      status: 'ok',
      llm: llmUp ? 'up' : 'down',
      db: db ? (dbUp ? 'up' : 'down') : 'disabled',
      rag: rag ? rag.backend : 'disabled',
    });
  });

  // Chat: con token, el colegio y los permisos salen del JWT; sin token (solo desarrollo) usa la config.
  app.use('/v1/dev/chat', chatRequiresAuth ? requireAuth(jwtSecret) : optionalAuth(jwtSecret));
  app.use(createTutorRouter({ llm, rag, tenantId, defaultCourseId }));

  if (db) {
    // Las rutas con datos de colegio exigen JWT.
    app.use(['/v1/me', '/v1/courses', '/v1/assessments'], requireAuth(jwtSecret));
    app.use(createNotasRouter({ db }));
  }

  app.use(notFound);
  app.use(problemHandler);
  return app;
}
