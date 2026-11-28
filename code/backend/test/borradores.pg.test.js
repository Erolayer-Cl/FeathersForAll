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

  describe('hora de cierre (v1.9): por duración o por día y hora', () => {
    const en = (min) => new Date(Date.now() + min * 60_000).toISOString();
    const vista = (id, user = CAMILA) => call('GET', `/v1/courses/${MATE}/assessments`, { user }).then((r) => ok(r, 200)).then((b) => b.data.find((e) => e.id === id));

    test('publicar con un cierre a 90 minutos lo guarda con la hora exacta', async () => {
      const ev = await crear('Prueba de 90 minutos');
      const cierre = en(90);
      const pub = await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published', closes_at: cierre } }), 200);
      assert.equal(pub.status, 'published');
      assert.equal(new Date(pub.closes_at).toISOString(), cierre);
      assert.equal(new Date((await vista(ev.id)).closes_at).toISOString(), cierre);
    });

    test('publicar con closes_at null quita el cierre automático; sin closes_at conserva el del borrador', async () => {
      const a = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Con cierre', closes_at: en(600), questions: preguntas } }), 201);
      assert.equal((await ok(await call('PATCH', `/v1/assessments/${a.id}`, { user: ANA, body: { status: 'published', closes_at: null } }), 200)).closes_at, null);
      const cierre = en(600);
      const b = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Conserva', closes_at: cierre, questions: preguntas } }), 201);
      assert.equal(new Date((await ok(await call('PATCH', `/v1/assessments/${b.id}`, { user: ANA, body: { status: 'published' } }), 200)).closes_at).toISOString(), cierre);
    });

    test('un borrador con un cierre que ya pasó no se publica sin elegir otro (409, antes era 500)', async () => {
      const ev = await crear('Cierre vencido');
      await testDb.superuser.query("UPDATE evaluaciones SET fecha_cierre = now() - interval '1 hour' WHERE id = $1", [ev.id]);
      const r = await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } });
      assert.equal(r.status, 409);
      assert.match((await r.json()).detail, /ya pasó/);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published', closes_at: en(30) } }), 200);
    });

    test('se extiende el cierre de una publicada (también si ya venció) y el estudiante vuelve a poder rendir', async () => {
      const ev = await crear('Extender');
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published', closes_at: en(5) } }), 200);
      // Simula que pasaron dos horas: se publicó hace 2 h y venció hace 1 min.
      await testDb.superuser.query("UPDATE evaluaciones SET fecha_publicacion = now() - interval '2 hours', fecha_cierre = now() - interval '1 minute' WHERE id = $1", [ev.id]);
      const vencida = await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers: [{ question_id: (await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200)).questions[0].id, selected_option: 0 }] } });
      assert.equal(vencida.status, 409);
      const nueva = en(120);
      assert.equal(new Date((await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { closes_at: nueva } }), 200)).closes_at).toISOString(), nueva);
      const q = (await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200)).questions[0].id;
      await ok(await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers: [{ question_id: q, selected_option: 0 }] } }), 201);
    });

    test('validación: pasado, sin zona, demasiado lejos, cerrar con closes_at, cuerpo vacío y estudiante', async () => {
      const ev = await crear('Validación cierre');
      const patch = (body, user = ANA) => call('PATCH', `/v1/assessments/${ev.id}`, { user, body });
      assert.equal((await patch({ status: 'published', closes_at: en(-1) })).status, 400);
      assert.equal((await patch({ status: 'published', closes_at: '2026-12-01T10:00' })).status, 400);
      assert.equal((await patch({ status: 'published', closes_at: en(60 * 24 * 400) })).status, 400);
      assert.equal((await patch({ status: 'closed', closes_at: en(60) })).status, 400);
      assert.equal((await patch({})).status, 400);
      // Un borrador no existe para el estudiante (14: el RLS ya no se lo muestra): 404, no 403.
      assert.equal((await patch({ closes_at: en(60) }, CAMILA)).status, 404);
      await ok(await patch({ status: 'published' }), 200);
      await ok(await patch({ status: 'closed' }), 200);
      assert.equal((await patch({ closes_at: en(60) })).status, 409);
    });
  });

  describe('preguntas de respuesta escrita (v1.10)', () => {
    const mixtas = [
      { statement: '¿Cuánto es 3 + 4?', type: 'text', accepted_answers: ['7', 'siete'], feedback: 'Suma: 3 + 4 = 7.' },
      { statement: '¿Quién fue el primer director supremo de Chile?', type: 'text', accepted_answers: ["Bernardo O'Higgins", 'O’Higgins'] },
      { statement: '¿Cuánto es 2 + 2?', options: ['3', '4', '5'], correct_option: 1, feedback: 'Es 4.' },
    ];
    const rendir = async (ev, respuestas) => {
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200);
      const answers = vista.questions.map((q, i) => (q.type === 'text' ? { question_id: q.id, text_answer: respuestas[i] } : { question_id: q.id, selected_option: respuestas[i] }));
      return call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers } });
    };

    test('el docente crea una evaluación con preguntas de texto y alternativas, y ve las respuestas aceptadas', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mixta', questions: mixtas } }), 201);
      assert.deepEqual(ev.questions.map((q) => q.type), ['text', 'text', 'multiple_choice']);
      assert.deepEqual(ev.questions[0].accepted_answers, ['7', 'siete']);
      assert.deepEqual(ev.questions[0].options, []);
      assert.equal(ev.questions[0].correct_option, null);
      assert.equal(ev.questions[2].accepted_answers, undefined);
    });

    test('el estudiante NO recibe las respuestas aceptadas, y se corrige tolerando mayúsculas, tildes, puntos y 7,0', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mixta rendir', questions: mixtas } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200);
      assert.equal(JSON.stringify(vista).includes('siete'), false);
      assert.equal(JSON.stringify(vista).includes('Higgins'), false);
      assert.equal(vista.questions[0].type, 'text');
      const r = await ok(await rendir(ev, ['  7,0. ', 'bernardo o’higgins', 1]), 201);
      assert.deepEqual(r.answers.map((a) => a.correct), [true, true, true]);
      assert.equal(r.score, 3);
      // El detalle de la nota muestra lo que escribió.
      const detalle = await ok(await call('GET', `/v1/me/grades/${ev.id}`, { user: CAMILA }), 200);
      assert.equal(detalle.answers[0].type, 'text');
      assert.equal(detalle.answers[0].selected_option, '7,0.');
      assert.equal(detalle.answers[0].feedback, 'Suma: 3 + 4 = 7.');
    });

    test('vacío cuenta como sin responder; mezclar el tipo de respuesta es 422', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mixta vacía', questions: mixtas } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200);
      const mal = await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers: [{ question_id: vista.questions[0].id, selected_option: 0 }] } });
      assert.equal(mal.status, 422);
      const mal2 = await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers: [{ question_id: vista.questions[2].id, text_answer: '4' }] } });
      assert.equal(mal2.status, 422);
      const r = await ok(await rendir(ev, ['   ', 'Siete', 0]), 201);
      assert.deepEqual(r.answers.map((a) => a.correct), [false, false, false]);
    });

    test('la BASE corrige el texto aunque la sesión del estudiante intente marcarlo correcto', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mixta trampa', questions: mixtas } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const intento = (await testDb.superuser.query('INSERT INTO intentos_evaluacion (colegio_id, curso_id, evaluacion_id, estudiante_id) VALUES ($1, $2, $3, $4) RETURNING id', [A, MATE, ev.id, DEMO.camila])).rows[0].id;
      const pregunta = (await testDb.superuser.query('SELECT id FROM preguntas WHERE evaluacion_id = $1 AND orden = 1', [ev.id])).rows[0].id;
      const r = await db.withUser({ id: DEMO.camila, rol: 'estudiante', colegioId: A }, (c) => c.query(
        'INSERT INTO respuestas_estudiante (colegio_id, evaluacion_id, intento_id, pregunta_id, respuesta_texto, es_correcta) VALUES ($1, $2, $3, $4, $5, true) RETURNING es_correcta',
        [A, ev.id, intento, pregunta, 'ocho']));
      assert.equal(r.rows[0].es_correcta, false);
    });

    test('sin respuestas aceptadas se publica y el docente revisa a mano: la nota se recalcula', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Revisión manual', questions: [
        { statement: 'Explica con tus palabras qué es una fracción.', type: 'text' },
        { statement: '¿Cuánto es 2 + 2?', options: ['3', '4'], correct_option: 1 },
      ] } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const r = await ok(await rendir(ev, ['Es una parte de un todo', 1]), 201);
      assert.deepEqual(r.answers.map((a) => [a.correct, a.pending_review]), [[false, true], [true, false]]);
      assert.equal(r.pending_review, 1);
      assert.equal(r.percentage, 50);
      // El estudiante ve su nota como provisional.
      const det = await ok(await call('GET', `/v1/me/grades/${ev.id}`, { user: CAMILA }), 200);
      assert.equal(det.pending_review, 1);
      assert.equal(det.answers[0].pending_review, true);
      // El docente ve la bandeja y decide.
      const bandeja = await ok(await call('GET', `/v1/assessments/${ev.id}/text-answers`, { user: ANA }), 200);
      assert.equal(bandeja.pending, 1);
      assert.equal(bandeja.data[0].text_answer, 'Es una parte de un todo');
      assert.equal(bandeja.data[0].student_name.length > 0, true);
      const rev = await ok(await call('PATCH', `/v1/assessments/${ev.id}/text-answers/${bandeja.data[0].id}`, { user: ANA, body: { correct: true } }), 200);
      assert.equal(rev.correct, true);
      assert.equal(rev.student_percentage, 100);
      assert.equal(rev.student_grade, 7);
      const despues = await ok(await call('GET', `/v1/me/grades/${ev.id}`, { user: CAMILA }), 200);
      assert.deepEqual([despues.pending_review, despues.answers[0].correct, despues.grade], [0, true, 7]);
      // Puede cambiar de opinión.
      const otra = await ok(await call('PATCH', `/v1/assessments/${ev.id}/text-answers/${bandeja.data[0].id}`, { user: ANA, body: { correct: false } }), 200);
      assert.equal(otra.student_percentage, 50);
    });

    test('el docente también corrige una respuesta que se corrigió sola; el estudiante no puede revisar', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Revisión auto', questions: [{ statement: '¿Cuánto es 3 + 4?', type: 'text', accepted_answers: ['7'] }] } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const r = await ok(await rendir(ev, ['siete']), 201);
      assert.deepEqual([r.answers[0].correct, r.pending_review], [false, 0]);
      const bandeja = await ok(await call('GET', `/v1/assessments/${ev.id}/text-answers`, { user: ANA }), 200);
      assert.equal(bandeja.pending, 0);
      const id = bandeja.data[0].id;
      assert.equal((await call('GET', `/v1/assessments/${ev.id}/text-answers`, { user: CAMILA })).status, 403);
      assert.equal((await call('PATCH', `/v1/assessments/${ev.id}/text-answers/${id}`, { user: CAMILA, body: { correct: true } })).status, 403);
      assert.equal((await call('PATCH', `/v1/assessments/${ev.id}/text-answers/${id}`, { user: ANA, body: { correct: 'si' } })).status, 400);
      assert.equal((await call('PATCH', `/v1/assessments/${ev.id}/text-answers/${ev.id}`, { user: ANA, body: { correct: true } })).status, 404);
      assert.equal((await ok(await call('PATCH', `/v1/assessments/${ev.id}/text-answers/${id}`, { user: ANA, body: { correct: true } }), 200)).student_grade, 7);
    });

    test('la base no deja que el estudiante se marque como revisado', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Revisión trampa', questions: [{ statement: 'Explica qué es un número primo.', type: 'text' }] } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const intento = (await testDb.superuser.query('INSERT INTO intentos_evaluacion (colegio_id, curso_id, evaluacion_id, estudiante_id) VALUES ($1, $2, $3, $4) RETURNING id', [A, MATE, ev.id, DEMO.camila])).rows[0].id;
      const pregunta = (await testDb.superuser.query('SELECT id FROM preguntas WHERE evaluacion_id = $1', [ev.id])).rows[0].id;
      const r = await db.withUser({ id: DEMO.camila, rol: 'estudiante', colegioId: A }, (c) => c.query(
        `INSERT INTO respuestas_estudiante (colegio_id, evaluacion_id, intento_id, pregunta_id, respuesta_texto, es_correcta, revision_pendiente, revisada_at)
         VALUES ($1, $2, $3, $4, 'el que solo se divide por 1 y por sí mismo', true, false, now()) RETURNING es_correcta, revision_pendiente, revisada_at`,
        [A, ev.id, intento, pregunta]));
      assert.deepEqual([r.rows[0].es_correcta, r.rows[0].revision_pendiente, r.rows[0].revisada_at], [false, true, null]);
    });
  });

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
      assert.equal((await call('PUT', `/v1/assessments/${ev.id}`, { user: CAMILA, body: { title: 'Pirata', questions: preguntas } })).status, 404);
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
      assert.equal((await call('DELETE', `/v1/assessments/${ev.id}`, { user: CAMILA })).status, 404);
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
