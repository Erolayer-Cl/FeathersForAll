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

    /** ¿El curso tiene al menos un fragmento indexado? (solo visible si es del colegio) */
    async hasCourse({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return false;
      return read({ tenantId }, null, async (client) =>
        (await client.query('SELECT EXISTS (SELECT 1 FROM apuntes_embeddings WHERE curso_id = $1) AS ok', [courseId])).rows[0].ok);
    },

    /**
     * ¿Este usuario puede usar el tutor de este curso?
     * Estudiante: matrícula activa. Docente: es el docente del curso. Admin: el curso es de su colegio.
     */
    async canUseCourse({ tenantId, courseId, user }) {
      if (!validRef({ tenantId, courseId })) return false;
      if (!user) return true; // sin login (solo desarrollo): lo decide la configuración
      return read({ tenantId }, user, async (client) => (await client.query(
        `SELECT CASE $2::text
                  WHEN 'estudiante' THEN EXISTS (SELECT 1 FROM matriculas m
                                                 WHERE m.curso_id = c.id AND m.estudiante_id = $3::uuid AND m.activo)
                  WHEN 'docente' THEN c.docente_id = $3::uuid
                  WHEN 'admin_colegio' THEN true
                  ELSE false
                END AS ok
         FROM cursos c WHERE c.id = $1 AND c.activo`,
        [courseId, user.rol, user.id],
      )).rows[0]?.ok === true);
    },

    /** Docente dueño del curso (lo usa el script de ingesta para actuar en su nombre). */
    async courseOwner({ tenantId, courseId }) {
      if (!validRef({ tenantId, courseId })) return null;
      return read({ tenantId }, null, async (client) =>
        (await client.query('SELECT docente_id FROM cursos WHERE id = $1', [courseId])).rows[0]?.docente_id ?? null);
    },

    /** Los `topK` fragmentos más parecidos, solo de ese curso (y, por RLS, de ese colegio). score = similitud coseno. */
    async search({ tenantId, courseId, embedding, topK }) {
      if (!validRef({ tenantId, courseId })) return [];
      if (embedding.length !== EMBEDDING_DIM) throw new EmbeddingDimensionError(embedding.length, EMBEDDING_DIM);
      try {
        return await read({ tenantId }, null, async (client) => (await client.query(
          `SELECT a.titulo AS doc_id, e.chunk_indice AS chunk_index, e.chunk_texto AS text,
                  1 - (e.embedding <=> $2::vector) AS score
           FROM apuntes_embeddings e
           JOIN apuntes_curso a ON a.id = e.apunte_id
           WHERE e.curso_id = $1
           ORDER BY e.embedding <=> $2::vector
           LIMIT $3`,
          [courseId, toVector(embedding), topK],
        )).rows.map((r) => ({ ...r, score: Number(r.score) })));
      } catch (err) {
        throw translate(err);
      }
    },
  };
}
