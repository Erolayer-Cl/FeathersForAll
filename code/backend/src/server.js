import pino from 'pino';
import { createApp } from './app.js';
import { createOllamaClient } from './modules/tutor/llm-client.js';

const config = {
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  llmEndpoint: process.env.LLM_ENDPOINT ?? 'http://localhost:11434',
  llmModel: process.env.LLM_MODEL ?? 'qwen2.5:3b',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  llmTemperature: Number(process.env.LLM_TEMPERATURE ?? 0.6),
};

const logger = pino({ level: config.logLevel });

const llm = createOllamaClient({
  endpoint: config.llmEndpoint,
  model: config.llmModel,
  timeoutMs: config.llmTimeoutMs,
  temperature: config.llmTemperature,
});

const server = createApp({ logger, llm }).listen(config.port, () => {
  logger.info({ port: config.port, llm_endpoint: config.llmEndpoint, llm_model: config.llmModel }, 'servidor iniciado');
});

// Shutdown graceful (12-Factor 9): deja terminar las respuestas en curso, máximo 10 s.
function shutdown(signal) {
  logger.info({ signal }, 'apagando');
  server.close(() => process.exit(0));
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
