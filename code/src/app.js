import express from 'express';
import { fileURLToPath } from 'node:url';
import { requestContext } from './platform/request-context.js';
import { notFound, problemHandler } from './platform/problem.js';
import { createTutorRouter } from './modules/tutor/tutor.routes.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * @param {object} deps
 * @param {import('pino').Logger} deps.logger
 * @param {{chat: Function, ping: Function}} deps.llm
 */
export function createApp({ logger, llm }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestContext(logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    res.json({ status: 'ok', llm: (await llm.ping()) ? 'up' : 'down' });
  });

  app.use(createTutorRouter({ llm }));

  // UI provisoria del chat; el diseño final se sirve desde Vercel más adelante (ADR 0003).
  app.use(express.static(publicDir));

  app.use(notFound);
  app.use(problemHandler);
  return app;
}
