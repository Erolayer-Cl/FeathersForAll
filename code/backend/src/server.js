import pino from 'pino';
import { createApp } from './app.js';
import { createOllamaClient } from './modules/tutor/llm-client.js';
import { createDb } from './platform/db.js';
import { createRag, ragConfigFromEnv } from './modules/tutor/rag/create-rag.js';

const production = process.env.NODE_ENV === 'production';
// "true"/"false" explícito gana; si no viene, se usa el valor por defecto del ambiente.
const flag = (name, fallback) => (process.env[name] === undefined ? fallback : process.env[name] === 'true');
const config = {
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  llmEndpoint: process.env.LLM_ENDPOINT ?? 'http://localhost:11434',
  llmModel: process.env.LLM_MODEL ?? 'qwen2.5:3b',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  llmTemperature: Number(process.env.LLM_TEMPERATURE ?? 0.6),
  // Ventana de contexto: con apuntes en el prompt, el valor por defecto de Ollama puede quedarse corto.
  llmNumCtx: process.env.LLM_NUM_CTX ? Number(process.env.LLM_NUM_CTX) : 4096,
  // Modelo en memoria entre preguntas (auditoría 2026-10): con el valor de Ollama (5 min) la primera
  // pregunta tras una pausa tarda ~19 s en CPU por la carga del modelo. Ocupa ~3,4 GB de RAM mientras tanto.
  llmKeepAlive: process.env.LLM_KEEP_ALIVE ?? '30m',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  // Duración del JWT del login: 8 h por defecto (una jornada escolar; no hay refresh token).
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 8 * 3600),
};
const ragConfig = ragConfigFromEnv();

const logger = pino({ level: config.logLevel });

const llm = createOllamaClient({
  endpoint: config.llmEndpoint,
  model: config.llmModel,
  timeoutMs: config.llmTimeoutMs,
  temperature: config.llmTemperature,
  numCtx: config.llmNumCtx,
  keepAlive: config.llmKeepAlive,
});

// Sin DATABASE_URL: chat + RAG en archivo JSON (como antes). Con DATABASE_URL: notas + RAG en pgvector.
const db = config.databaseUrl ? createDb({ connectionString: config.databaseUrl, logger }) : undefined;
if (db && (!config.jwtSecret || config.jwtSecret.length < 32)) {
  logger.fatal('DATABASE_URL requiere JWT_SECRET de al menos 32 caracteres');
  process.exit(1);
}

const rag = await createRag(ragConfig, { db });

const server = createApp({
  logger,
  llm,
  db,
  jwtSecret: config.jwtSecret,
  jwtTtlSeconds: config.jwtTtlSeconds,
  rag,
  tenantId: ragConfig.tenantId,
  defaultCourseId: ragConfig.defaultCourseId,
  // En producción no hay ruta de carga de desarrollo y el chat exige token.
  // ENABLE_DEV_ROUTES / CHAT_REQUIRE_AUTH permiten cambiarlo en el clúster local del laboratorio (S07).
  enableIngestApi: flag('ENABLE_DEV_ROUTES', !production),
  chatRequiresAuth: flag('CHAT_REQUIRE_AUTH', production),
}).listen(config.port, () => {
  logger.info({
    port: config.port,
    llm_endpoint: config.llmEndpoint,
    llm_model: config.llmModel,
    embedding_model: ragConfig.embeddingModel,
    db: db ? 'enabled' : 'disabled',
    rag_store: rag.backend,
    default_course: ragConfig.defaultCourseId,
  }, 'servidor iniciado');
});

// Shutdown graceful (12-Factor 9): deja terminar las respuestas en curso, máximo 10 s.
function shutdown(signal) {
  logger.info({ signal }, 'apagando');
  server.close(async () => {
    await db?.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
