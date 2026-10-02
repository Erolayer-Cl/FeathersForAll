import express from 'express';
import { requestContext } from './platform/request-context.js';
import { notFound, problemHandler } from './platform/problem.js';
import { createTutorRouter } from './modules/tutor/tutor.routes.js';

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

  app.use(notFound);
  app.use(problemHandler);
  return app;
}
