// Búsqueda híbrida del RAG (significado + palabras exactas, RRF) contra un PostgreSQL REAL con RLS.
// Se salta si no hay TEST_DATABASE_URL (ver test/pg-fixture.js).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/platform/db.js';
import { createPgVectorStore, toTsQuery } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { fakeEmbedder } from './fake-embedder.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const ANA = { id: DEMO.ana, rol: 'docente' };
const ref = { tenantId: DEMO.colegioA, courseId: DEMO.mate };
const BASES = 'MINEDUC · Matemática · 7° básico a 2° medio';
const embedOne = async (text) => (await fakeEmbedder(1024).embed([text]))[0];

test('toTsQuery: palabras que dicen el tema unidas con "|", sigla + número como frase; nada de sintaxis del usuario', () => {
  assert.equal(toTsQuery("¿Qué dice el OA 3 de las fracciones?"), 'fracciones | oa <-> 3');
  assert.equal(toTsQuery("a' & | ! ( ) :* <-> \\"), null);
  assert.equal(toTsQuery(''), null);
  assert.equal(toTsQuery(undefined), null);
});

describe('búsqueda híbrida en PostgreSQL', { skip: SKIP }, () => {
  let testDb;
  let db;
  let store;
  let rag;

  before(async () => {
    testDb = await createTestDatabase('ffa_hibrida');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
    store = createPgVectorStore({ db });
    rag = createRagService({ embedder: fakeEmbedder(1024), store, minScore: 0.2 });
    await rag.ingest({ ...ref, docId: 'fracciones.md', text: '# Fracciones\n\nEl denominador indica en cuántas partes iguales se divide el todo. Decreto 97.', actor: ANA });
    await rag.ingest({ ...ref, docId: BASES, text: '# OA 3\n\nObjetivo de aprendizaje OA 3: resolver problemas con fracciones.', actor: ANA });
  });

  after(async () => {
    await db?.end();
    await testDb?.drop();
  });

  test('con queryText calza por palabras exactas (lexical) y docIds limita los documentos', async () => {
    const hits = await store.search({ ...ref, embedding: await embedOne('denominador'), topK: 5, queryText: 'denominador decreto', docIds: ['fracciones.md'] });
    assert.ok(hits.length > 0);
    assert.ok(hits.every((h) => h.doc_id === 'fracciones.md'));
    assert.ok(hits.some((h) => h.lexical === true));
    assert.ok(hits.every((h) => h.score >= -1 && h.score <= 1));
  });

  test('"OA 3" calza por frase exacta en las Bases (lexical)', async () => {
    const hits = await store.search({ ...ref, embedding: await embedOne('OA 3'), topK: 5, queryText: 'OA 3', docIds: [BASES] });
    assert.ok(hits.some((h) => h.lexical === true && h.doc_id === BASES));
  });

  test('"ejemplo" ya no cuenta como palabra exacta', async () => {
    const hits = await store.search({ ...ref, embedding: await embedOne('ejemplo'), topK: 5, queryText: 'dame un ejemplo' });
    assert.ok(hits.every((h) => h.lexical === false));
  });

  test('una pregunta con solo palabras vacías (to_tsquery vacío) no falla: queda la búsqueda por significado', async () => {
    const hits = await store.search({ ...ref, embedding: await embedOne('que'), topK: 5, queryText: 'que para como los las' });
    assert.ok(hits.length > 0);
    assert.ok(hits.every((h) => h.lexical === false));
  });

  test('caracteres especiales en la pregunta no rompen to_tsquery', async () => {
    const hits = await store.search({ ...ref, embedding: await embedOne('x'), topK: 5, queryText: "a' & | ! ( ) :* <-> \\ ñandú OA-3 1/2" });
    assert.ok(Array.isArray(hits));
  });

  test('listTitles y courseInfo responden bajo RLS', async () => {
    assert.deepEqual(new Set(await store.listTitles(ref)), new Set(['fracciones.md', BASES]));
    const info = await store.courseInfo(ref);
    assert.ok(info && 'nivel' in info && 'asignatura' in info && 'nombre' in info);
    assert.deepEqual(await store.listTitles({ ...ref, tenantId: DEMO.colegioB }), []);
  });

  test('las Bases del Mineduc solo entran si la pregunta es curricular', async () => {
    const query = 'qué dice el OA 3 de fracciones';
    const curricular = await rag.retrieve({ ...ref, query, curricular: true });
    const contenido = await rag.retrieve({ ...ref, query, curricular: false });
    assert.ok(curricular.hits.some((h) => h.reference));
    assert.ok(contenido.hits.every((h) => !h.reference));
  });
});
