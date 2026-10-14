// Pruebas de integración del RAG contra un PostgreSQL REAL (pgvector + RLS + permisos por rol).
// Se saltan si no hay TEST_DATABASE_URL (superusuario de una base de pruebas):
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
//
// Crean una base temporal con 01 + 02 + 03 + 90_seed_demo.sql y conectan como feathersforall_app
// (sin BYPASSRLS). El almacén NO revisa roles: si un estudiante logra escribir, es la BASE la que falla.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import { createPgVectorStore } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { CourseNotFoundError, EmbeddingDimensionError, RagForbiddenError } from '../src/modules/tutor/rag/errors.js';
import { NO_INFO_REPLY } from '../src/modules/tutor/rag/rag-prompt.js';
import { fakeEmbedder } from './fake-embedder.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const logger = pino({ level: 'silent' });

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const MATE = 'c0000000-0000-0000-0000-000000000001';      // docente Ana
const ANA = { id: 'a0000000-0000-0000-0000-000000000001', rol: 'docente' };
const LUIS = { id: 'a0000000-0000-0000-0000-000000000002', rol: 'docente' };   // otro curso
const MARTA = { id: 'a0000000-0000-0000-0000-000000000003', rol: 'admin_colegio' };
const CAMILA = { id: 'e0000000-0000-0000-0000-000000000001', rol: 'estudiante' };
const PEDRO = { id: 'b0000000-0000-0000-0000-000000000001', rol: 'docente' };  // colegio B

const NOTES = `# Fracciones

Una fracción representa una parte de un todo. El numerador indica cuántas partes se toman.

El denominador indica en cuántas partes iguales se divide el todo.`;

describe('RAG sobre PostgreSQL', { skip: !ADMIN_URL && 'sin TEST_DATABASE_URL' }, () => {
  const dbName = `ffa_rag_${randomBytes(4).toString('hex')}`;
  let admin;
  let db;
  let rag;
  const inA = { tenantId: A, courseId: MATE };

  before(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN CREATE ROLE feathersforall_app; END IF;
      END $$`);
    await admin.query(`ALTER ROLE feathersforall_app LOGIN NOBYPASSRLS PASSWORD 'test'`);

    const testUrl = new URL(ADMIN_URL);
    testUrl.pathname = `/${dbName}`;
    const setup = new pg.Client({ connectionString: testUrl.href });
    await setup.connect();
    for (const f of ['01_schema.sql', '02_s06_ajustes.sql', '03_notas.sql', '90_seed_demo.sql']) {
      await setup.query(await readFile(new URL(`../db/${f}`, import.meta.url), 'utf8'));
    }
    await setup.query(`GRANT USAGE ON SCHEMA public TO feathersforall_app;
                       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feathersforall_app`);
    await setup.end();

    const appUrl = new URL(testUrl);
    appUrl.username = 'feathersforall_app';
    appUrl.password = 'test';
    db = createDb({ connectionString: appUrl.href, max: 4 });
    rag = createRagService({ embedder: fakeEmbedder(1024), store: createPgVectorStore({ db }), minScore: 0.2 });
  });

  after(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe('quién puede subir apuntes (lo decide la base)', () => {
    test('el docente del curso sube: queda el apunte, sus fragmentos y subido_por = el docente', async () => {
      assert.deepEqual(await rag.ingest({ ...inA, docId: 'fracciones.md', text: NOTES, actor: ANA }), { doc_id: 'fracciones.md', chunks: 1 });
      assert.deepEqual(await rag.listDocuments(inA), [{ doc_id: 'fracciones.md', chunks: 1 }]);
      const check = new pg.Client({ connectionString: Object.assign(new URL(ADMIN_URL), { pathname: `/${dbName}` }).href });
      await check.connect();
      const r = await check.query("SELECT subido_por, colegio_id FROM apuntes_curso WHERE titulo = 'fracciones.md'");
      await check.end();
      assert.equal(r.rows[0].subido_por, ANA.id);
      assert.equal(r.rows[0].colegio_id, A);
    });

    test('re-subir el mismo título reemplaza los fragmentos (no duplica)', async () => {
      await rag.ingest({ ...inA, docId: 'fracciones.md', text: `${NOTES}\n\nOtro párrafo.`, actor: ANA });
      assert.equal((await rag.listDocuments(inA)).length, 1);
    });

    test('el admin del colegio también puede', async () => {
      await rag.ingest({ ...inA, docId: 'admin.md', text: 'Apunte subido por la administración.', actor: MARTA });
      assert.ok((await rag.listDocuments(inA)).some((d) => d.doc_id === 'admin.md'));
    });

    test('un ESTUDIANTE no puede (RagForbiddenError) y no queda nada escrito', async () => {
      await assert.rejects(rag.ingest({ ...inA, docId: 'trampa.md', text: 'texto del estudiante', actor: CAMILA }), RagForbiddenError);
      assert.ok(!(await rag.listDocuments(inA)).some((d) => d.doc_id === 'trampa.md'));
    });

    test('un estudiante tampoco puede pisar un apunte existente', async () => {
      await assert.rejects(rag.ingest({ ...inA, docId: 'fracciones.md', text: 'texto falso', actor: CAMILA }), RagForbiddenError);
      const { hits } = await rag.retrieve({ ...inA, query: '¿Qué indica el numerador?' });
      assert.ok(hits.every((h) => !h.text.includes('texto falso')));
    });

    test('un docente de OTRO curso no puede', async () => {
      await assert.rejects(rag.ingest({ ...inA, docId: 'luis.md', text: 'apunte ajeno', actor: LUIS }), RagForbiddenError);
    });

    test('un docente de OTRO colegio no ve el curso (CourseNotFoundError)', async () => {
      await assert.rejects(rag.ingest({ tenantId: B, courseId: MATE, docId: 'b.md', text: 'x', actor: PEDRO }), CourseNotFoundError);
    });

    test('sin actor no se escribe', async () => {
      await assert.rejects(rag.ingest({ ...inA, docId: 'anon.md', text: 'x' }), RagForbiddenError);
    });

    test('borrar: el estudiante borra 0, el docente borra 1', async () => {
      assert.equal(await rag.deleteDocument({ ...inA, docId: 'admin.md', actor: CAMILA }), 0);
      assert.equal(await rag.deleteDocument({ ...inA, docId: 'admin.md', actor: ANA }), 1);
    });
  });

  describe('búsqueda', () => {
    test('recupera el fragmento con similitud coseno (0–1) y el título del apunte', async () => {
      const { hits, best } = await rag.retrieve({ ...inA, query: '¿Qué indica el numerador?' });
      assert.equal(hits[0].doc_id, 'fracciones.md');
      assert.equal(hits[0].chunk_index, 0);
      assert.ok(best > 0.2 && best <= 1);
    });

    test('una pregunta sin relación no supera el umbral', async () => {
      const { hits } = await rag.retrieve({ ...inA, query: 'capital Francia' });
      assert.deepEqual(hits, []);
    });

    test('aislamiento: desde el colegio B el curso no tiene apuntes ni resultados', async () => {
      assert.equal(await rag.hasCourse({ tenantId: B, courseId: MATE }), false);
      assert.deepEqual((await rag.retrieve({ tenantId: B, courseId: MATE, query: 'numerador' })).hits, []);
      assert.deepEqual(await rag.listDocuments({ tenantId: B, courseId: MATE }), []);
    });

    test('ids que no son UUID nunca llegan a la base', async () => {
      assert.equal(await rag.hasCourse({ tenantId: A, courseId: "x' OR 1=1" }), false);
      assert.deepEqual((await rag.retrieve({ tenantId: A, courseId: 'mate-7', query: 'numerador' })).hits, []);
    });

    test('un modelo de embeddings con otra dimensión da un error claro', async () => {
      const wrong = createRagService({ embedder: fakeEmbedder(768), store: createPgVectorStore({ db }) });
      await assert.rejects(wrong.retrieve({ ...inA, query: 'numerador' }), EmbeddingDimensionError);
      await assert.rejects(wrong.ingest({ ...inA, docId: 'x.md', text: 'x', actor: ANA }), EmbeddingDimensionError);
    });
  });

  describe('quién puede usar el tutor del curso', () => {
    test('estudiante matriculado, docente del curso y admin: sí', async () => {
      for (const user of [CAMILA, ANA, MARTA]) assert.equal(await rag.canUseCourse({ ...inA, user }), true, user.rol);
    });
    test('docente de otro curso o de otro colegio: no', async () => {
      assert.equal(await rag.canUseCourse({ ...inA, user: LUIS }), false);
      assert.equal(await rag.canUseCourse({ tenantId: B, courseId: MATE, user: PEDRO }), false);
    });
  });

  describe('HTTP de punta a punta', () => {
    let server;
    let url;
    let llm;
    const tok = (u, tenant = A) => signJwt({ sub: u.id, tenant_id: tenant, role: u.rol }, SECRET);
    const post = (path, body, user, tenant) => fetch(url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${tok(user, tenant)}` } : {}) },
      body: JSON.stringify(body),
    });
    const ask = (content, user, extra = {}, tenant) =>
      post('/v1/dev/chat', { messages: [{ role: 'user', content }], ...extra }, user, tenant);

    before(async () => {
      llm = { calls: [], async *chat(m) { this.calls.push(m); yield 'respuesta'; }, ping: async () => true };
      const httpRag = { ...rag, backend: 'postgres' };
      server = createApp({ logger, llm, db, jwtSecret: SECRET, rag: httpRag, tenantId: A, defaultCourseId: MATE }).listen(0);
      await new Promise((r) => server.once('listening', r));
      url = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => server?.close());

    const docs = `/v1/dev/courses/${MATE}/documents`;

    test('subir apuntes exige token', async () => {
      assert.equal((await post(docs, { name: 'a.md', text: 'x' })).status, 401);
    });
    test('el estudiante recibe 403', async () => {
      assert.equal((await post(docs, { name: 'a.md', text: 'x' }, CAMILA)).status, 403);
    });
    test('otro docente recibe 403 (lo rechaza la base)', async () => {
      assert.equal((await post(docs, { name: 'a.md', text: 'x' }, LUIS)).status, 403);
    });
    test('el docente del curso recibe 201', async () => {
      assert.equal((await post(docs, { name: 'decimales.md', text: 'Un número decimal tiene parte entera y parte decimal separadas por una coma.' }, ANA)).status, 201);
    });
    test('courseId que no es UUID -> 400', async () => {
      assert.equal((await post('/v1/dev/courses/mate-7/documents', { name: 'a.md', text: 'x' }, ANA)).status, 400);
    });

    test('estudiante: pregunta de materia -> respuesta anclada a los apuntes con fuentes', async () => {
      const res = await ask('¿Qué indica el numerador?', CAMILA);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-tutor-turn'), 'grounded');
      assert.match(llm.calls.at(-1)[0].content, /El numerador indica cuántas partes se toman/);
    });
    test('estudiante: saludo -> conversa', async () => {
      const res = await ask('hola!', CAMILA);
      assert.equal(res.headers.get('x-tutor-turn'), 'chat');
      assert.equal(await res.text(), 'respuesta');
    });
    test('estudiante: fuera de los apuntes -> "No encuentro eso", sin LLM', async () => {
      const before = llm.calls.length;
      const res = await ask('¿Cuál es la capital de Francia?', CAMILA);
      assert.equal(await res.text(), NO_INFO_REPLY);
      assert.equal(llm.calls.length, before);
    });
    test('docente de otro colegio -> 404 (no sabe que el curso existe)', async () => {
      assert.equal((await ask('hola', PEDRO, { course_id: MATE }, B)).status, 404);
    });
    test('course_id que no es UUID -> 400', async () => {
      assert.equal((await ask('hola', CAMILA, { course_id: 'mate-7' })).status, 400);
    });
    test('sin token (desarrollo) usa el colegio y curso de la config', async () => {
      const res = await ask('¿Qué indica el numerador?');
      assert.equal(res.headers.get('x-tutor-turn'), 'grounded');
    });
    test('/health informa rag postgres', async () => {
      assert.equal((await (await fetch(`${url}/health`)).json()).rag, 'postgres');
    });
  });
});
