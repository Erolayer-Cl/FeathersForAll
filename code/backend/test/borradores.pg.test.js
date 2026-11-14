// Editar, borrar y generar con IA un borrador de evaluación, contra PostgreSQL REAL.
// Se saltan si no hay TEST_DATABASE_URL (ver test/pg-fixture.js).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import { createLoginLimiter } from '../src/platform/login-limiter.js';
import { createPgVectorStore } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { fakeEmbedder } from './fake-embedder.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const A = DEMO.colegioA;
const MATE = DEMO.mate;
const ANA = { id: DEMO.ana, rol: 'docente' };
const LUIS = { id: DEMO.luis, rol: 'docente' };
const CAMILA = { id: DEMO.camila, rol: 'estudiante' };

const preguntas = [
  { statement: '¿Cuánto es 3/4 + 1/4?', options: ['1/2', '1', '4/8'], correct_option: 1, feedback: 'Es 1.' },
  { statement: '¿Qué indica el denominador?', options: ['Las partes que se toman', 'En cuántas partes se divide el todo'], correct_option: 1 },
];
const generado = {
  title: 'Prueba de fracciones',
  questions: [
    { statement: '¿Qué indica el numerador?', options: ['Las partes que se toman', 'Las partes del todo', 'El resultado', 'La unidad'], correct_option: 0, feedback: 'El numerador cuenta las partes que se toman.' },
    { statement: '¿Cuántas partes tiene un entero dividido en cuartos?', options: ['2', '3', '4', '5'], correct_option: 2, feedback: 'Cuartos son 4 partes iguales.' },
  ],
};

describe('borradores de evaluación (PostgreSQL)', { skip: SKIP }, () => {
  let testDb; let db; let server; let url; let rag;
  const llm = { respuesta: JSON.stringify(generado), prompts: [], falla: false, async *chat(messages) { this.prompts.push(messages); if (this.falla) throw new Error('caído'); yield this.respuesta; }, ping: async () => true };
  const tok = (u) => signJwt({ sub: u.id, tenant_id: A, role: u.rol }, SECRET);
  const call = (method, path, { user, body, key = randomUUID() } = {}) => fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user && { authorization: `Bearer ${tok(user)}` }), ...(method === 'POST' && key && { 'idempotency-key': key }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ok = async (res, status) => { assert.equal(res.status, status, `esperaba ${status}, llegó ${res.status}: ${await res.clone().text()}`); return res.status === 204 ? null : res.json(); };
  const crear = (title = 'Borrador', questions = preguntas) => call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title, questions } }).then((r) => ok(r, 201));

  before(async () => {
    testDb = await createTestDatabase('ffa_borradores');
    db = createDb({ connectionString: testDb.appUrl, max: 6 });
    rag = { ...createRagService({ embedder: fakeEmbedder(1024), store: createPgVectorStore({ db }), minScore: 0.2 }), backend: 'postgres' };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, rag, tenantId: A, defaultCourseId: MATE }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
    await rag.ingest({ tenantId: A, courseId: MATE, docId: 'fracciones.md', text: '# Fracciones\n\nUna fracción representa una parte de un todo. El numerador indica cuántas partes se toman y el denominador en cuántas partes iguales se divide el todo.', actor: ANA });
  });
  after(async () => { server?.close(); await db?.end(); await testDb?.drop(); });

  describe('editar un borrador', () => {
    test('reemplaza título, preguntas y alternativas (con la correcta nueva) y conserva el id', async () => {
      const ev = await crear();
      const editada = await ok(await call('PUT', `/v1/assessments/${ev.id}`, { user: ANA, body: { title: 'Título corregido', questions: [{ statement: '¿Cuánto es 2 + 2?', options: ['3', '4', '5', '6'], correct_option: 1, feedback: 'Es 4.' }] } }), 200);
      assert.equal(editada.id, ev.id);
      assert.equal(editada.title, 'Título corregido');
      assert.equal(editada.status, 'draft');
      assert.deepEqual(editada.questions.map((q) => [q.statement, q.options, q.correct_option]), [['¿Cuánto es 2 + 2?', ['3', '4', '5', '6'], 1]]);
      const filas = await testDb.superuser.query('SELECT (SELECT count(*)::int FROM preguntas WHERE evaluacion_id = $1) AS p, (SELECT count(*)::int FROM alternativas a JOIN preguntas p ON p.id = a.pregunta_id WHERE p.evaluacion_id = $1) AS a', [ev.id]);
      assert.deepEqual(filas.rows[0], { p: 1, a: 4 });
    });

    test('se puede completar la correcta que faltaba y publicar', async () => {
      const ev = await crear('Con una sin correcta', [{ ...preguntas[0], correct_option: null }]);
      assert.equal((await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } })).status, 422);
      await ok(await call('PUT', `/v1/assessments/${ev.id}`, { user: ANA, body: { title: 'Con una sin correcta', questions: [preguntas[0]] } }), 200);
      assert.equal((await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200)).status, 'published');
    });

    test('una publicada NO se edita (409); datos inválidos 400 sin perder las preguntas; permisos 403/401', async () => {
      const pub = await crear('Publicada');
      await ok(await call('PATCH', `/v1/assessments/${pub.id}`, { user: ANA, body: { status: 'published' } }), 200);
      assert.equal((await call('PUT', `/v1/assessments/${pub.id}`, { user: ANA, body: { title: 'Cambio', questions: preguntas } })).status, 409);

      const ev = await crear('Para validar');
      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { user: ANA, body: { title: 'ab', questions: preguntas } })).status, 400);
      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { user: ANA, body: { title: 'Válido', questions: [] } })).status, 400);
      const intacta = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: ANA }), 200);
      assert.equal(intacta.questions.length, 2, 'un PUT inválido no toca las preguntas');

      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { user: LUIS, body: { title: 'Pirata', questions: preguntas } })).status, 403);
      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { user: CAMILA, body: { title: 'Pirata', questions: preguntas } })).status, 403);
      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { body: { title: 'Pirata', questions: preguntas } })).status, 401);
    });

    test('closes_at: se guarda, se devuelve y una fecha pasada se rechaza', async () => {
      const ev = await crear();
      const cierre = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const e = await ok(await call('PUT', `/v1/assessments/${ev.id}`, { user: ANA, body: { title: 'Con cierre', closes_at: cierre, questions: preguntas } }), 200);
      assert.equal(new Date(e.closes_at).toISOString(), cierre);
      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { user: ANA, body: { title: 'Con cierre', closes_at: '2020-01-01T00:00:00Z', questions: preguntas } })).status, 400);
    });
  });

  describe('borrar un borrador', () => {
    test('el docente borra su borrador (204, caen sus preguntas); repetirlo da 404', async () => {
      const ev = await crear();
      assert.equal((await call('DELETE', `/v1/assessments/${ev.id}`, { user: ANA })).status, 204);
      assert.equal((await call('DELETE', `/v1/assessments/${ev.id}`, { user: ANA })).status, 404);
      const n = await testDb.superuser.query('SELECT count(*)::int AS n FROM preguntas WHERE evaluacion_id = $1', [ev.id]);
      assert.equal(n.rows[0].n, 0);
    });
    test('una publicada no se borra (409); estudiante y otro docente 403', async () => {
      const pub = await crear('Publicada para borrar');
      await ok(await call('PATCH', `/v1/assessments/${pub.id}`, { user: ANA, body: { status: 'published' } }), 200);
      assert.equal((await call('DELETE', `/v1/assessments/${pub.id}`, { user: ANA })).status, 409);
      const ev = await crear();
      assert.equal((await call('DELETE', `/v1/assessments/${ev.id}`, { user: LUIS })).status, 403);
      assert.equal((await call('DELETE', `/v1/assessments/${ev.id}`, { user: CAMILA })).status, 403);
    });
  });

  describe('generar con IA', () => {
    const generar = (body, user = ANA) => call('POST', `/v1/courses/${MATE}/assessments/generate`, { user, body });

    test('con apuntes: propone un borrador (sin guardar nada) y manda al modelo los apuntes del curso como material', async () => {
      const antes = (await testDb.superuser.query('SELECT count(*)::int AS n FROM evaluaciones')).rows[0].n;
      llm.prompts.length = 0;
      const r = await ok(await generar({ topic: 'fracciones', questions_count: 2 }), 200);
      assert.equal(r.title, 'Prueba de fracciones');
      assert.equal(r.questions.length, 2);
      assert.equal(r.source, 'apuntes');
      assert.deepEqual(r.sources, ['fracciones.md']);
      assert.match(llm.prompts[0][1].content, /<apuntes>[\s\S]*El numerador indica cuántas partes se toman/);
      const despues = (await testDb.superuser.query('SELECT count(*)::int AS n FROM evaluaciones')).rows[0].n;
      assert.equal(despues, antes, 'generar no guarda nada');
    });

    test('lo generado se puede guardar tal cual y publicar: es un borrador normal', async () => {
      const r = await ok(await generar({ topic: 'fracciones' }), 200);
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: r.title, questions: r.questions } }), 201);
      assert.equal((await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200)).status, 'published');
    });

    test('sin apuntes sobre el tema: 422 que lo dice; con use_notes false se genera solo del tema', async () => {
      const p = await ok(await generar({ topic: 'dinosaurios del cretácico' }), 422);
      assert.match(p.detail, /No encontré apuntes/);
      llm.prompts.length = 0;
      const r = await ok(await generar({ topic: 'dinosaurios del cretácico', use_notes: false }), 200);
      assert.equal(r.source, 'tema');
      assert.ok(!llm.prompts[0][1].content.includes('<apuntes>'));
    });

    test('permisos: estudiante y otro docente 403, sin token 401, y el modelo ni se invoca', async () => {
      llm.prompts.length = 0;
      assert.equal((await generar({ topic: 'fracciones' }, CAMILA)).status, 403);
      assert.equal((await generar({ topic: 'fracciones' }, LUIS)).status, 403);
      assert.equal((await call('POST', `/v1/courses/${MATE}/assessments/generate`, { body: { topic: 'fracciones' } })).status, 401);
      assert.equal(llm.prompts.length, 0);
    });

    test('pedido inválido -> 400; el modelo responde basura -> 502', async () => {
      assert.equal((await generar({ topic: 'ab' })).status, 400);
      assert.equal((await generar({ topic: 'fracciones', questions_count: 50 })).status, 400);
      llm.respuesta = 'Lo siento, no puedo ayudar con eso.';
      assert.equal((await generar({ topic: 'fracciones' })).status, 502);
      llm.respuesta = JSON.stringify(generado);
    });

    test('tope por usuario: a la décima generación seguida, 429 con Retry-After', async () => {
      const limitado = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, rag, tenantId: A, aiLimiter: createLoginLimiter({ maxFailures: 2 }) }).listen(0);
      await new Promise((r) => limitado.once('listening', r));
      const u = `http://127.0.0.1:${limitado.address().port}`;
      const go = () => fetch(`${u}/v1/courses/${MATE}/assessments/generate`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok(ANA)}` }, body: JSON.stringify({ topic: 'fracciones' }) });
      try {
        assert.equal((await go()).status, 200);
        assert.equal((await go()).status, 200);
        const r = await go();
        assert.equal(r.status, 429);
        assert.ok(Number(r.headers.get('retry-after')) > 0);
      } finally { limitado.close(); }
    });
  });
});
