import { chunkText } from './chunker.js';

const EMBED_BATCH = 16;

/**
 * Orquesta ingesta y recuperación. No conoce a Ollama ni al almacén concreto:
 * recibe un `embedder` ({ embed(texts) }) y un `store` (ver vector-store.js).
 *
 * @param {object} deps
 * @param {{embed: (texts: string[]) => Promise<number[][]>}} deps.embedder
 * @param {object} deps.store  vector-store.js (archivo) o pg-vector-store.js (PostgreSQL); sus métodos pueden ser sync o async
 * @param {number} [deps.topK]      fragmentos a recuperar
 * @param {number} [deps.minScore]  similitud mínima (0–1); bajo ese valor se considera "sin información"
 * @param {{maxChars?: number, overlapChars?: number}} [deps.chunk]
 */
export function createRagService({ embedder, store, topK = 4, minScore = 0.5, chunk = {} }) {
  async function embedAll(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      out.push(...(await embedder.embed(texts.slice(i, i + EMBED_BATCH))));
    }
    return out;
  }

  return {
    hasCourse: async (ref) => store.hasCourse(ref),
    listDocuments: async (ref) => store.listDocuments(ref),
    /** `ref.actor` = quien borra ({ id, rol }); en PostgreSQL la base decide si puede. */
    deleteDocument: async (ref) => store.deleteDocument(ref),
    /** El almacén en archivo (solo desarrollo) no tiene usuarios: todo curso es usable. */
    canUseCourse: async (ref) => (store.canUseCourse ? store.canUseCourse(ref) : true),
    courseOwner: async (ref) => (store.courseOwner ? store.courseOwner(ref) : null),

    /**
     * Indexa (o reemplaza) un documento de texto del curso.
     * `actor` ({ id, rol }) es quien lo sube; en PostgreSQL solo el docente del curso o el admin pueden.
     */
    async ingest({ tenantId, courseId, docId, text, actor }) {
      const pieces = chunkText(text, chunk);
      if (pieces.length === 0) throw new RangeError('El documento no tiene texto');
      const embeddings = await embedAll(pieces);
      await store.replaceDocument({
        tenantId,
        courseId,
        docId,
        text,
        actor,
        chunks: pieces.map((piece, i) => ({ text: piece, embedding: embeddings[i] })),
      });
      return { doc_id: docId, chunks: pieces.length };
    },

    /**
     * Busca en los apuntes del curso.
     * @returns {Promise<{hits: {doc_id: string, chunk_index: number, text: string, score: number}[], best: number | null, timings: {embed_ms: number, search_ms: number}}>}
     *   `hits` ya filtrados por `minScore`; `best` es la mejor similitud encontrada (útil para ajustar el umbral);
     *   `timings`: cuánto tardó el embedding de la pregunta y la búsqueda en el almacén.
     */
    async retrieve({ tenantId, courseId, query }) {
      const t0 = performance.now();
      const [embedding] = await embedder.embed([query]);
      const t1 = performance.now();
      const found = await store.search({ tenantId, courseId, embedding, topK });
      const timings = { embed_ms: Math.round(t1 - t0), search_ms: Math.round(performance.now() - t1) };
      return { hits: found.filter((h) => h.score >= minScore), best: found[0]?.score ?? null, timings };
    },
  };
}
