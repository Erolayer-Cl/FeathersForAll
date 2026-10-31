// Almacén vectorial simple (memoria + archivo JSON) para el RAG de desarrollo.
//
// Es la pieza que se reemplaza por PostgreSQL + pgvector (ADR 0002, D1) cuando exista la BD:
// la interfaz (replaceDocument / deleteDocument / listDocuments / hasCourse / search)
// ya recibe siempre tenant_id y course_id, y NINGUNA operación puede leer sin filtrarlos.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Normaliza a largo 1 (así el producto punto = similitud coseno) y reduce decimales. */
export function normalize(vec) {
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return vec.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

const sameCourse = (r, { tenantId, courseId }) => r.tenant_id === tenantId && r.course_id === courseId;

/** @param {{path?: string}} [options] path: archivo JSON donde persistir (omitir = solo memoria) */
export function createVectorStore({ path } = {}) {
  let records = [];
  let loadedMtime = 0;

  /** Recarga si otro proceso (p. ej. `npm run ingest`) cambió el archivo. */
  function refresh() {
    if (!path || !existsSync(path)) return;
    const mtime = statSync(path).mtimeMs;
    if (mtime === loadedMtime) return;
    records = JSON.parse(readFileSync(path, 'utf8')).records ?? [];
    loadedMtime = mtime;
  }

  async function write() {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, records }));
    await rename(tmp, path);
    loadedMtime = statSync(path).mtimeMs;
  }

  // Una escritura a la vez: dos ingestas simultáneas compartirían el mismo .tmp y la
  // segunda fallaría con ENOENT. Cada escritura guarda el estado más reciente de `records`.
  let writing = Promise.resolve();
  function persist() {
    if (!path) return Promise.resolve();
    writing = writing.catch(() => {}).then(write);
    return writing;
  }

  refresh();

  return {
    /** Reemplaza todos los fragmentos de un documento (re-ingestar = actualizar). `text` (apunte completo) no se usa aquí. */
    async replaceDocument({ tenantId, courseId, docId, chunks }) {
      refresh();
      records = records.filter((r) => !(sameCourse(r, { tenantId, courseId }) && r.doc_id === docId));
      chunks.forEach((chunk, i) => {
        records.push({
          tenant_id: tenantId,
          course_id: courseId,
          doc_id: docId,
          chunk_index: i,
          text: chunk.text,
          embedding: normalize(chunk.embedding),
        });
      });
      await persist();
    },

    /** @returns {Promise<number>} fragmentos eliminados */
    async deleteDocument({ tenantId, courseId, docId }) {
      refresh();
      const before = records.length;
      records = records.filter((r) => !(sameCourse(r, { tenantId, courseId }) && r.doc_id === docId));
      if (records.length !== before) await persist();
      return before - records.length;
    },

    listDocuments({ tenantId, courseId }) {
      refresh();
      const counts = new Map();
      for (const r of records) {
        if (sameCourse(r, { tenantId, courseId })) counts.set(r.doc_id, (counts.get(r.doc_id) ?? 0) + 1);
      }
      return [...counts].map(([doc_id, chunks]) => ({ doc_id, chunks }));
    },

    hasCourse({ tenantId, courseId }) {
      refresh();
      return records.some((r) => sameCourse(r, { tenantId, courseId }));
    },

    /** Los `topK` fragmentos más parecidos, solo de ese tenant y curso. */
    search({ tenantId, courseId, embedding, topK }) {
      refresh();
      const query = normalize(embedding);
      return records
        .filter((r) => sameCourse(r, { tenantId, courseId }))
        .map((r) => ({
          doc_id: r.doc_id,
          chunk_index: r.chunk_index,
          text: r.text,
          score: dot(query, r.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
}
