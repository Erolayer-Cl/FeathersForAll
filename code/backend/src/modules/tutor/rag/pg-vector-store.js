// Almacén vectorial sobre PostgreSQL + pgvector, con el esquema del equipo
// (db/01_schema.sql + 02_s06_ajustes.sql):
//   apuntes_curso      (id, colegio_id, curso_id, titulo, contenido, subido_por, ...)
//   apuntes_embeddings (id, colegio_id, curso_id, apunte_id, chunk_indice, chunk_texto, embedding vector(1024))
//
// Seguridad: NO filtra por colegio a mano. Cada operación corre en una transacción con
// app.colegio_id / app.usuario_id / app.rol (db.withSession) y la base aplica:
//   - RLS por colegio: otro colegio no existe (0 filas).
//   - Permisos por rol: solo el docente del curso o el admin escriben apuntes; el
//     estudiante solo lee. Si la API se equivoca, la base igual lo rechaza.
// La búsqueda la hace PostgreSQL con el índice HNSW (distancia coseno, operador <=>).
//
// Mapeo con el resto del RAG: tenantId = colegios.id, courseId = cursos.id, docId = apuntes_curso.titulo.
import { CourseNotFoundError, EmbeddingDimensionError, RagForbiddenError } from './errors.js';

export const EMBEDDING_DIM = 1024; // bge-m3; debe coincidir con vector(N) de 02_s06_ajustes.sql

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validRef = ({ tenantId, courseId }) => UUID.test(tenantId ?? '') && UUID.test(courseId ?? '');
const toVector = (v) => `[${v.join(',')}]`;

/**
 * Pregunta del usuario -> consulta de texto completo "palabra | palabra | ..." (cualquiera de ellas).
 * Solo letras y dígitos: nada de lo que escriba el usuario llega como sintaxis de to_tsquery.
 * Devuelve null si no queda ninguna palabra útil (entonces solo se busca por significado).
 */
export function toTsQuery(text) {
  const words = (text ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const unique = [...new Set(words)].slice(0, 12);
  return unique.length ? unique.join(' | ') : null;
}

/** Traduce los errores de PostgreSQL que importan al RAG. */
function translate(err) {
  if (err?.code === '42501') return new RagForbiddenError(); // violación de política RLS
  const dim = /expected (\d+) dimensions, not (\d+)/.exec(err?.message ?? '');
  if (dim) return new EmbeddingDimensionError(Number(dim[2]), Number(dim[1]));
  return err;
}

/**
 * @param {object} deps
 * @param {{withSession: Function}} deps.db  ver src/platform/db.js
 */
export function createPgVectorStore({ db }) {
  const session = ({ tenantId }, actor) => ({ colegioId: tenantId, usuarioId: actor?.id ?? '', rol: actor?.rol ?? '' });
  const read = (ref, actor, fn) => db.withSession(session(ref, actor), fn, { readOnly: true });

  async function write(ref, actor, fn) {
    try {
      return await db.withSession(session(ref, actor), fn);
    } catch (err) {
      throw translate(err);
    }
  }

  return {
    backend: 'postgres',

    /**
     * Crea o reemplaza un apunte (por título) con sus fragmentos, todo en una transacción.
     * @param {{id: string, rol: string}} actor  quien sube el apunte (del JWT verificado)
     */
    async replaceDocument({ tenantId, courseId, docId, text, chunks, actor }) {
      if (!validRef({ tenantId, courseId })) throw new CourseNotFoundError();
      if (!actor) throw new RagForbiddenError();
      for (const c of chunks) {
        if (c.embedding.length !== EMBEDDING_DIM) throw new EmbeddingDimensionError(c.embedding.length, EMBEDDING_DIM);
      }

      return write({ tenantId }, actor, async (client) => {
        const course = await client.query('SELECT 1 FROM cursos WHERE id = $1', [courseId]);
        if (course.rowCount === 0) throw new CourseNotFoundError();

        const existing = await client.query(
          'SELECT id FROM apuntes_curso WHERE curso_id = $1 AND titulo = $2 FOR UPDATE',
          [courseId, docId],
        );

        let apunteId;
        if (existing.rowCount > 0) {
          apunteId = existing.rows[0].id;
          // Un UPDATE sin permiso no da error: afecta 0 filas (RLS). Se trata como prohibido.
          const updated = await client.query('UPDATE apuntes_curso SET contenido = $2 WHERE id = $1', [apunteId, text ?? '']);
          if (updated.rowCount === 0) throw new RagForbiddenError();
          await client.query('DELETE FROM apuntes_embeddings WHERE apunte_id = $1', [apunteId]);
        } else {
          // colegio_id y subido_por los pone la base (DEFAULT app_colegio_id() / app_usuario_id()).
          const created = await client.query(
            'INSERT INTO apuntes_curso (curso_id, titulo, contenido) VALUES ($1, $2, $3) RETURNING id',
            [courseId, docId, text ?? ''],
          );
          apunteId = created.rows[0].id;
        }

        await client.query(
          `INSERT INTO apuntes_embeddings (curso_id, apunte_id, chunk_indice, chunk_texto, embedding)
           SELECT $1::uuid, $2::uuid, (u.n - 1)::int, u.t, u.e::vector
           FROM unnest($3::text[], $4::text[]) WITH ORDINALITY AS u(t, e, n)`,
          [courseId, apunteId, chunks.map((c) => c.text), chunks.map((c) => toVector(c.embedding))],
        );
        return { apunteId };
      });
    },

    /** @returns {Promise<number>} apuntes eliminados (sus fragmentos caen por ON DELETE CASCADE). 0 si no existe o no hay permiso. */
    async deleteDocument({ tenantId, courseId, docId, actor }) {
      if (!validRef({ tenantId, courseId }) || !actor) return 0;
      return write({ tenantId }, actor, async (client) => {
        const res = await client.query('DELETE FROM apuntes_curso WHERE curso_id = $1 AND titulo = $2', [courseId, docId]);
        return res.rowCount;
      });
    },

    async listDocuments({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return [];
      return read({ tenantId }, null, async (client) => (await client.query(
        `SELECT a.titulo AS doc_id, COUNT(e.id)::int AS chunks
         FROM apuntes_curso a
         LEFT JOIN apuntes_embeddings e ON e.apunte_id = a.id
         WHERE a.curso_id = $1
         GROUP BY a.id, a.titulo, a.created_at
         ORDER BY a.created_at DESC`,
        [courseId],
      )).rows);
    },

    /** Nombres de los documentos del curso, sin contar sus fragmentos (consulta barata: una fila por documento). */
    async listTitles({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return [];
      return read({ tenantId }, null, async (client) => (await client.query(
        'SELECT titulo FROM apuntes_curso WHERE curso_id = $1 ORDER BY created_at DESC',
        [courseId],
      )).rows.map((r) => r.titulo));
    },

    /** Nivel, asignatura y nombre del curso (para elegir las Bases Curriculares de su nivel y asignatura). */
    async courseInfo({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return null;
      return read({ tenantId }, null, async (client) => (await client.query(
        'SELECT nivel, asignatura, nombre FROM cursos WHERE id = $1',
        [courseId],
      )).rows[0] ?? null);
    },

    /** ¿El curso tiene al menos un fragmento indexado? (solo visible si es del colegio) */
    async hasCourse({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return false;
      return read({ tenantId }, null, async (client) =>
        (await client.query('SELECT EXISTS (SELECT 1 FROM apuntes_embeddings WHERE curso_id = $1) AS ok', [courseId])).rows[0].ok);
    },

    /**
     * ¿Este usuario puede usar el tutor de este curso?
     * Estudiante: matrícula activa. Docente: es el docente del curso. Admin: el curso es de su colegio.
     * Es la misma regla que GET /v1/courses: puede_ver_curso() de 04_privacidad_login.sql, evaluada
     * con la sesión del usuario (colegio, id y rol del JWT).
     */
    async canUseCourse({ tenantId, courseId, user }) {
      if (!validRef({ tenantId, courseId })) return false;
      if (!user) return true; // sin login (solo desarrollo): lo decide la configuración
      return read({ tenantId }, user, async (client) =>
        (await client.query('SELECT puede_ver_curso($1) AS ok', [courseId])).rows[0].ok === true);
    },

    /** Docente dueño del curso (lo usa el script de ingesta para actuar en su nombre). */
    async courseOwner({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return null;
      return read({ tenantId }, null, async (client) =>
        (await client.query('SELECT docente_id FROM cursos WHERE id = $1', [courseId])).rows[0]?.docente_id ?? null);
    },

    /**
     * Búsqueda híbrida, solo en ese curso (y, por RLS, en ese colegio):
     *   - por significado: los más cercanos por distancia coseno (índice HNSW);
     *   - por palabras exactas (si viene `queryText`): coincidencias de texto completo en español (to_tsvector),
     *     útil para siglas, números y nombres propios ("OA 3", "Decreto 97", "kawésqar") que los embeddings diluyen.
     * Las dos listas se mezclan con Reciprocal Rank Fusion. `score` sigue siendo la similitud coseno (0–1),
     * así el umbral `minScore` significa lo mismo de siempre; `lexical` indica que también calzó por palabras.
     * `docIds` (opcional) limita la búsqueda a esos documentos: así los apuntes del docente y las Bases del Mineduc
     * se buscan por separado y unos pocos apuntes no quedan tapados por miles de fragmentos oficiales.
     */
    async search({ tenantId, courseId, embedding, topK, queryText, docIds }) {
      if (!validRef({ tenantId, courseId })) return [];
      if (embedding.length !== EMBEDDING_DIM) throw new EmbeddingDimensionError(embedding.length, EMBEDDING_DIM);
      try {
        return await read({ tenantId }, null, async (client) => (await client.query(
          `WITH q AS (
             SELECT CASE WHEN $4::text IS NULL THEN NULL ELSE to_tsquery('spanish', $4::text) END AS tsq
           ),
           vec AS (
             -- El ORDER BY ... LIMIT va en la consulta interna para que PostgreSQL use el índice HNSW.
             SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.dist) AS rn
             FROM (
               SELECT e.id, a.titulo, e.chunk_indice, e.chunk_texto,
                      e.embedding <=> $2::vector AS dist, 1 - (e.embedding <=> $2::vector) AS score
               FROM apuntes_embeddings e
               JOIN apuntes_curso a ON a.id = e.apunte_id
               WHERE e.curso_id = $1
                 AND ($5::text[] IS NULL OR a.titulo = ANY($5::text[]))
               ORDER BY e.embedding <=> $2::vector
               LIMIT $3
             ) s
           ),
           lex AS (
             SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.rk DESC) AS rn
             FROM (
               SELECT e.id, a.titulo, e.chunk_indice, e.chunk_texto,
                      1 - (e.embedding <=> $2::vector) AS score,
                      ts_rank_cd(to_tsvector('spanish', e.chunk_texto), q.tsq) AS rk
               FROM q, apuntes_embeddings e
               JOIN apuntes_curso a ON a.id = e.apunte_id
               WHERE q.tsq IS NOT NULL
                 AND e.curso_id = $1
                 AND ($5::text[] IS NULL OR a.titulo = ANY($5::text[]))
                 AND to_tsvector('spanish', e.chunk_texto) @@ q.tsq
               ORDER BY rk DESC
               LIMIT $3
             ) s
           )
           SELECT titulo AS doc_id, chunk_indice AS chunk_index, chunk_texto AS text, score,
                  SUM(1.0 / (60 + rn)) AS rrf, BOOL_OR(from_lex) AS lexical
           FROM (
             SELECT id, titulo, chunk_indice, chunk_texto, score, rn, false AS from_lex FROM vec
             UNION ALL
             SELECT id, titulo, chunk_indice, chunk_texto, score, rn, true AS from_lex FROM lex
           ) u
           GROUP BY id, titulo, chunk_indice, chunk_texto, score
           ORDER BY rrf DESC
           LIMIT $3`,
          [courseId, toVector(embedding), topK, toTsQuery(queryText), docIds ?? null],
        )).rows.map((r) => ({ doc_id: r.doc_id, chunk_index: r.chunk_index, text: r.text, score: Number(r.score), lexical: r.lexical })));
      } catch (err) {
        throw translate(err);
      }
    },
  };
}
