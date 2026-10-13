// Muestra qué recuperaría el RAG para una pregunta, con su puntaje. Sirve para ajustar RAG_MIN_SCORE.
//   npm run rag:search -- "<pregunta>"             → curso por defecto (DEFAULT_COURSE_ID)
//   npm run rag:search -- <cursoId> "<pregunta>"   → otro curso
import { createDb } from '../src/platform/db.js';
import { createRag, ragConfigFromEnv } from '../src/modules/tutor/rag/create-rag.js';
import { isSmallTalk } from '../src/modules/tutor/rag/rag-prompt.js';

const args = process.argv.slice(2);
const config = ragConfigFromEnv();
const courseId = args.length <= 1 ? config.defaultCourseId : args[0];
const query = (args.length <= 1 ? args : args.slice(1)).join(' ').trim();

if (!query) {
  console.error('Uso: npm run rag:search -- [cursoId] "<pregunta>"');
  process.exit(1);
}

const db = process.env.DATABASE_URL ? createDb({ connectionString: process.env.DATABASE_URL, max: 1 }) : undefined;
try {
  if (isSmallTalk(query)) console.log('(nota: el tutor trataría este mensaje como CHARLA y no buscaría en los apuntes)\n');
  // minScore 0 para ver también lo que quedaría descartado.
  const rag = await createRag({ ...config, minScore: 0 }, { db });
  const { hits } = await rag.retrieve({ tenantId: config.tenantId, courseId, query });
  if (hits.length === 0) console.log('(el curso no tiene apuntes indexados)');
  for (const h of hits) {
    const verdict = h.score >= config.minScore ? 'USA     ' : 'DESCARTA ';
    const where = h.chunk_index === undefined ? h.doc_id : `${h.doc_id}#${h.chunk_index}`;
    console.log(`${verdict}${h.score.toFixed(3)}  ${where}  ${h.text.slice(0, 90).replace(/\s+/g, ' ')}…`);
  }
  console.log(`\numbral actual RAG_MIN_SCORE=${config.minScore}  (almacén: ${rag.backend})`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await db?.end();
}
