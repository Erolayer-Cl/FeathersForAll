// Pruebas del almacén PostgreSQL sin base real: una db falsa que cuenta sesiones y consultas.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPgVectorStore, EMBEDDING_DIM } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const ref = { tenantId: TENANT, courseId: COURSE };
const embedding = new Array(EMBEDDING_DIM).fill(0.01);

function fakeDb() {
  const calls = { sessions: [], queries: [] };
  return {
    calls,
    withSession: async (session, fn, opts = {}) => {
      calls.sessions.push(opts);
      return fn({
        query: async (sql) => {
          calls.queries.push(sql);
          if (/FROM cursos c/.test(sql)) return { rows: [{ nivel: '7B', asignatura: 'Matemática', nombre: 'Mate 7B', titulos: ['apunte.md', 'MINEDUC Matemática 7B.pdf'] }] };
          if (/DELETE FROM apuntes_curso/.test(sql)) return { rowCount: 1, rows: [] };
          return { rows: [], rowCount: 0 };
        },
      });
    },
  };
}

describe('búsqueda en PostgreSQL', () => {
  test('la rama de palabras usa la columna tsv, no calcula el tsvector al vuelo', async () => {
    const db = fakeDb();
    await createPgVectorStore({ db }).search({ ...ref, embedding, topK: 4, queryText: 'oa 3 fracciones' });
    const sql = db.calls.queries[0];
    assert.match(sql, /e\.tsv @@ q\.tsq/);
    assert.doesNotMatch(sql, /to_tsvector/);
  });

  test('search activa iterative_scan en la sesión', async () => {
    const db = fakeDb();
    await createPgVectorStore({ db }).search({ ...ref, embedding, topK: 4, queryText: 'fracciones' });
    assert.equal(db.calls.sessions.length, 1);
    assert.equal(db.calls.sessions[0].iterativeScan, true);
    assert.equal(db.calls.sessions[0].readOnly, true);
  });

  test('searchGroups hace todos los grupos en una sola sesión y salta los vacíos', async () => {
    const db = fakeDb();
    const out = await createPgVectorStore({ db }).searchGroups({ ...ref, embedding, topK: 4, queryText: 'fracciones', groups: [['a.md'], [], ['b.md']] });
    assert.equal(out.length, 3);
    assert.deepEqual(out[1], []);
    assert.equal(db.calls.sessions.length, 1);
    assert.equal(db.calls.queries.length, 2);
  });

  test('searchGroups sin documentos no abre sesión', async () => {
    const db = fakeDb();
    const out = await createPgVectorStore({ db }).searchGroups({ ...ref, embedding, topK: 4, queryText: 'x', groups: [[], []] });
    assert.deepEqual(out, [[], []]);
    assert.equal(db.calls.sessions.length, 0);
  });
});

describe('títulos y datos del curso', () => {
  test('listTitles y courseInfo comparten una sola consulta', async () => {
    const db = fakeDb();
    const store = createPgVectorStore({ db });
    assert.deepEqual(await store.listTitles(ref), ['apunte.md', 'MINEDUC Matemática 7B.pdf']);
    assert.deepEqual(await store.courseInfo(ref), { nivel: '7B', asignatura: 'Matemática', nombre: 'Mate 7B' });
    await store.listTitles(ref);
    assert.equal(db.calls.sessions.length, 1);
  });

  test('vence el caché pasado el tiempo', async () => {
    const db = fakeDb();
    const store = createPgVectorStore({ db, contextTtlMs: 0 });
    await store.listTitles(ref);
    await store.listTitles(ref);
    assert.equal(db.calls.sessions.length, 2);
  });

  test('borrar un apunte invalida el caché del curso', async () => {
    const db = fakeDb();
    const store = createPgVectorStore({ db });
    await store.listTitles(ref);
    await store.deleteDocument({ ...ref, docId: 'apunte.md', actor: { id: 'u', rol: 'docente' } });
    const antes = db.calls.sessions.length;
    await store.listTitles(ref);
    assert.equal(db.calls.sessions.length, antes + 1);
  });

  test('una lectura que empezó antes de borrar no deja el caché viejo', async () => {
    const db = fakeDb();
    let release;
    let blocked = false;
    const slow = { ...db, withSession: async (session, fn, opts) => {
      if (opts?.readOnly && !blocked) {
        blocked = true;
        await new Promise((r) => { release = r; });
      }
      return db.withSession(session, fn, opts);
    } };
    const store = createPgVectorStore({ db: slow });
    const pending = store.listTitles(ref);
    await store.deleteDocument({ ...ref, docId: 'apunte.md', actor: { id: 'u', rol: 'docente' } });
    release();
    await pending;
    const antes = db.calls.sessions.length;
    await store.listTitles(ref);
    assert.equal(db.calls.sessions.length, antes + 1);
  });

  test('el caché es por colegio y curso', async () => {
    const db = fakeDb();
    const store = createPgVectorStore({ db });
    await store.listTitles(ref);
    await store.listTitles({ tenantId: '33333333-3333-4333-8333-333333333333', courseId: COURSE });
    assert.equal(db.calls.sessions.length, 2);
  });
});

describe('retrieve con searchGroups', () => {
  test('pide apuntes y Bases en una sola llamada al almacén', async () => {
    let groupsCalls = 0;
    let received;
    const store = {
      listTitles: async () => ['apunte.md', 'MINEDUC Matemática 7B.pdf'],
      courseInfo: async () => ({ nivel: '7B', asignatura: 'Matemática' }),
      search: async () => { throw new Error('no debería llamar search por separado'); },
      searchGroups: async (p) => { groupsCalls += 1; received = p.groups; return p.groups.map(() => []); },
    };
    const rag = createRagService({ embedder: { embed: async (t) => t.map(() => embedding) }, store, minScore: 0.2 });
    await rag.retrieve({ ...ref, query: 'qué dice el OA 3 de fracciones', curricular: true });
    assert.equal(groupsCalls, 1);
    assert.deepEqual(received[0], ['apunte.md']);
    assert.equal(received[1].length <= 1, true);
  });
});
