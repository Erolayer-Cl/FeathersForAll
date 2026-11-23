// Muestra qué recuperaría el RAG para una pregunta y por qué acepta o descarta cada fragmento. Sirve para ajustar
// RAG_MIN_SCORE y RAG_STRONG_SCORE con tus propios apuntes.
//   npm run rag:search -- "<pregunta>"             → curso por defecto (DEFAULT_COURSE_ID)
//   npm run rag:search -- <cursoId> "<pregunta>"   → otro curso
//   opciones: --curricular (simula una pregunta sobre el currículum: también consulta las Bases del Mineduc)
import { createDb } from '../src/platform/db.js';
import { createRag, ragConfigFromEnv } from '../src/modules/tutor/rag/create-rag.js';
import { isSmallTalk } from '../src/modules/tutor/rag/rag-prompt.js';
import { isCurricularQuestion } from '../src/modules/tutor/rag/relevance.js';

const args = process.argv.slice(2);
const forceCurricular = args.includes('--curricular');
const positional = args.filter((a) => !a.startsWith('--'));
const config = ragConfigFromEnv();
const courseId = positional.length <= 1 ? config.defaultCourseId : positional[0];
const query = (positional.length <= 1 ? positional : positional.slice(1)).join(' ').trim();

if (!query) {
  console.error('Uso: npm run rag:search -- [cursoId] "<pregunta>" [--curricular]');
  process.exit(1);
}

const db = process.env.DATABASE_URL ? createDb({ connectionString: process.env.DATABASE_URL, max: 1 }) : undefined;
try {
  if (isSmallTalk(query)) console.log('(nota: el tutor trataría este mensaje como CHARLA y no buscaría en los apuntes)\n');
  const rag = await createRag(config, { db });
  const ref = { tenantId: config.tenantId, courseId };
  const curricular = forceCurricular || isCurricularQuestion(query);

  const state = await rag.courseState(ref);
  console.log(`curso: ${state.titles?.length ?? '?'} documento(s) · apuntes del docente: ${state.hasNotes ? 'sí' : 'NO'} · pregunta curricular: ${curricular ? 'sí' : 'no'} · Bases del Mineduc: ${rag.usesReference(curricular) ? 'se consultan' : 'no se consultan'}\n`);
  if (!state.hasAny) {
    console.log('(el curso no tiene apuntes indexados)');
  } else if (!state.hasNotes && !rag.usesReference(curricular)) {
    console.log('→ el tutor respondería "tu docente todavía no ha subido apuntes" (solo hay Bases del Mineduc cargadas)');
  } else {
    const { candidates, hits, best } = await rag.retrieve({ ...ref, query, curricular, titles: state.titles });
    const used = new Set(hits.map((h) => `${h.doc_id}#${h.chunk_index}`));
    for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
      const key = `${c.doc_id}#${c.chunk_index}`;
      const verdict = used.has(key) ? 'USA     ' : 'DESCARTA ';
      const why = used.has(key) ? c.reason : (c.accepted ? 'sin cupo (variedad de documentos)' : c.reason);
      const tag = c.reference ? ' [Mineduc]' : '';
      console.log(`${verdict}${c.score.toFixed(3)}  cobertura ${c.coverage.toFixed(2)}  ${key}${tag}  (${why})\n          ${c.text.slice(0, 90).replace(/\s+/g, ' ')}…`);
    }
    console.log(`\nusaría ${hits.length} fragmento(s) · mejor similitud ${best === null ? '—' : best.toFixed(3)}`);
  }
  console.log(`umbrales: RAG_MIN_SCORE=${config.minScore}  RAG_STRONG_SCORE=${config.strongScore ?? `${(config.minScore + 0.12).toFixed(2)} (automático)`}  (almacén: ${rag.backend})`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await db?.end();
}
