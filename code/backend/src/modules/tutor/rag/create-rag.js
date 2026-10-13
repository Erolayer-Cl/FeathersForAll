import { createOllamaEmbedder } from '../embeddings-client.js';
import { createPgVectorStore } from './pg-vector-store.js';
import { createRagService } from './rag-service.js';
import { createVectorStore } from './vector-store.js';

// Datos de db/90_seed_demo.sql: Colegio Demo A y el curso Matemáticas 7°A (docente Ana Rojas).
export const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_COURSE_ID = 'c0000000-0000-0000-0000-000000000001';

/** Configuración del RAG desde variables de entorno (12-Factor 3). */
export function ragConfigFromEnv(env = process.env) {
  return {
    endpoint: env.LLM_ENDPOINT ?? 'http://localhost:11434',
    embeddingModel: env.EMBEDDING_MODEL ?? 'bge-m3',
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 60000),
    storePath: env.RAG_STORE_PATH ?? 'data/rag-store.json',
    topK: Number(env.RAG_TOP_K ?? 4),
    minScore: Number(env.RAG_MIN_SCORE ?? 0.5),
    chunkChars: Number(env.RAG_CHUNK_CHARS ?? 800),
    // Colegio y curso del chat cuando la petición NO trae token (solo desarrollo).
    // Con token (JWT) el colegio sale siempre del token.
    tenantId: env.DEFAULT_TENANT_ID ?? DEMO_TENANT_ID,
    defaultCourseId: env.DEFAULT_COURSE_ID ?? DEMO_COURSE_ID,
  };
}

/**
 * @param {object} config ragConfigFromEnv()
 * @param {{db?: ReturnType<import('../../../platform/db.js').createDb>}} [deps]
 *   Con `db` los apuntes viven en PostgreSQL (pgvector + RLS); sin ella, en un archivo JSON (solo desarrollo).
 * @returns {Promise<ReturnType<typeof createRagService> & {backend: 'postgres' | 'archivo'}>}
 */
export async function createRag(config, { db } = {}) {
  const store = db ? createPgVectorStore({ db }) : createVectorStore({ path: config.storePath });
  const service = createRagService({
    embedder: createOllamaEmbedder({
      endpoint: config.endpoint,
      model: config.embeddingModel,
      timeoutMs: config.timeoutMs,
    }),
    store,
    topK: config.topK,
    minScore: config.minScore,
    chunk: { maxChars: config.chunkChars, overlapChars: Math.round(config.chunkChars * 0.15) },
  });
  return { ...service, backend: db ? 'postgres' : 'archivo' };
}
