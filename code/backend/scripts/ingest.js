// Indexa apuntes (.md / .txt) en el RAG de un curso.
//   npm run ingest -- <archivo> [archivo...]             → curso por defecto (DEFAULT_COURSE_ID)
//   npm run ingest -- <cursoId> <archivo> [archivo...]   → otro curso
// Re-ingestar un archivo con el mismo nombre reemplaza sus fragmentos.
//
// Con DATABASE_URL guarda en PostgreSQL (apuntes_curso / apuntes_embeddings) ACTUANDO COMO EL DOCENTE
// DEL CURSO: la base aplica los mismos permisos que a la API (solo docente del curso o admin escriben).
// Sin DATABASE_URL usa el archivo JSON (solo desarrollo).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createDb } from '../src/platform/db.js';
import { createRag, ragConfigFromEnv } from '../src/modules/tutor/rag/create-rag.js';

const args = process.argv.slice(2);
const config = ragConfigFromEnv();
const firstIsFile = args.length > 0 && existsSync(args[0]);
const courseId = firstIsFile ? config.defaultCourseId : args[0];
const files = firstIsFile ? args : args.slice(1);

if (!courseId || files.length === 0) {
  console.error('Uso: npm run ingest -- [cursoId] <archivo.md|txt> [archivo...]');
  process.exit(1);
}

const db = process.env.DATABASE_URL ? createDb({ connectionString: process.env.DATABASE_URL, max: 2 }) : undefined;
try {
  const rag = await createRag(config, { db });
  let actor;
  if (db) {
    const owner = await rag.courseOwner({ tenantId: config.tenantId, courseId });
    if (!owner) throw Object.assign(new Error('curso no encontrado'), { name: 'CourseNotFoundError' });
    actor = { id: owner, rol: 'docente' };
  }
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const { doc_id, chunks } = await rag.ingest({ tenantId: config.tenantId, courseId, docId: basename(file), text, actor });
    console.log(`✔ ${doc_id}: ${chunks} fragmentos → curso "${courseId}" (${config.embeddingModel}, almacén: ${rag.backend})`);
  }
} catch (err) {
  const notFound = err?.name === 'CourseNotFoundError';
  console.error(`✖ ${notFound ? `El curso "${courseId}" no existe en el colegio "${config.tenantId}". ¿Creaste la base con datos demo (crear_bdd.sql -v demo=1 o npm run db:setup -- --demo)?` : err.message}`);
  if (err.cause) console.error(`  causa: ${err.cause.message ?? err.cause}`);
  process.exitCode = 1;
} finally {
  await db?.end();
}
