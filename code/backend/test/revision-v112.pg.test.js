// Correcciones de la revisión del 27-11-2026 y pruebas con tiempo (v1.12, 14_correcciones_revision.sql),
// contra un PostgreSQL REAL. Se saltan si no hay TEST_DATABASE_URL (ver test/pg-fixture.js).
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
const BENJA = { id: DEMO.benja, rol: 'estudiante' };
const SOFIA = { id: DEMO.sofia, rol: 'estudiante' };
const TOMAS = { id: DEMO.tomas, rol: 'estudiante' };

const dosPreguntas = [
  { statement: '¿Cuánto es 2 + 2?', options: ['3', '4', '5'], correct_option: 1, feedback: 'Es 4.' },
  { statement: '¿Cuánto es 3 + 3?', options: ['6', '7'], correct_option: 0, feedback: 'Es 6.' },
];

describe('revisión v1.12 (PostgreSQL)', { skip: SKIP }, () => {
  let testDb; let db; let server; let url; let rag;
  const tok = (u) => signJwt({ sub: u.id, tenant_id: A, role: u.rol }, SECRET);
  const call = (method, path, { user, body, key = randomUUID(), raw, type } = {}) => fetch(url + path, {
    method,
    headers: {
      ...(raw === undefined && { 'content-type': 'application/json' }),
      ...(type && { 'content-type': type }),
      ...(user && { authorization: `Bearer ${tok(user)}` }),
      ...(method === 'POST' && key && { 'idempotency-key': key }),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const ok = async (res, status) => { assert.equal(res.status, status, `esperaba ${status}, llegó ${res.status}: ${await res.clone().text()}`); return res.status === 204 ? null : res.json(); };
  const crear = (body) => call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body }).then((r) => ok(r, 201));
  const publicar = (id, extra = {}) => call('PATCH', `/v1/assessments/${id}`, { user: ANA, body: { status: 'published', ...extra } }).then((r) => ok(r, 200));
  const vencer = (evId, estudiante, minutos = 10) => testDb.superuser.query(
    "UPDATE intentos_evaluacion SET fecha_inicio = now() - make_interval(mins => $3) WHERE evaluacion_id = $1 AND estudiante_id = $2", [evId, estudiante.id, minutos]);

  before(async () => {
    testDb = await createTestDatabase('ffa_v112');
    db = createDb({ connectionString: testDb.appUrl, max: 8 });
    rag = { ...createRagService({ embedder: fakeEmbedder(1024), store: createPgVectorStore({ db }), minScore: 0.2 }), backend: 'postgres' };
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, rag, tenantId: A, defaultCourseId: MATE, loginLimiter: createLoginLimiter({ maxFailures: 3 }) }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server?.close(); await db?.end(); await testDb?.drop(); });

  describe('pruebas con tiempo por intento', () => {
    let ev;
    before(async () => {
      ev = await crear({ title: 'Control de 20 minutos', duration_minutes: 20, questions: dosPreguntas });
      assert.equal(ev.duration_minutes, 20);
      await publicar(ev.id);
    });

    test('antes de empezar, el estudiante ve cuántas preguntas hay pero no cuáles', async () => {
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200);
      assert.equal(vista.duration_minutes, 20);
      assert.equal(vista.questions.length, 0);
      assert.equal(vista.questions_count, 2);
      assert.equal(vista.attempt, null);
      assert.ok(Date.parse(vista.server_time));
    });

    test('entregar sin empezar: 409 attempt-not-started', async () => {
      const r = await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers: [] } });
      assert.equal(r.status, 409);
      assert.match((await r.json()).type, /attempt-not-started/);
    });

    test('empezar: 201 con el plazo del servidor; repetir devuelve el MISMO intento (200) y no reinicia el reloj', async () => {
      const a = await ok(await call('POST', `/v1/assessments/${ev.id}/attempts`, { user: CAMILA }), 201);
      const minutos = (Date.parse(a.deadline) - Date.parse(a.started_at)) / 60_000;
      assert.equal(minutos, 20);
      const b = await ok(await call('POST', `/v1/assessments/${ev.id}/attempts`, { user: CAMILA }), 200);
      assert.equal(b.id, a.id);
      assert.equal(b.started_at, a.started_at);
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200);
      assert.equal(vista.questions.length, 2);
      assert.equal(vista.attempt.id, a.id);
    });

    test('dentro del plazo se entrega con nota', async () => {
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200);
      const r = await ok(await call('POST', `/v1/assessments/${ev.id}/submissions`, {
        user: CAMILA, body: { answers: vista.questions.map((q) => ({ question_id: q.id, selected_option: q.options.indexOf(q.options.find((o) => o === '4' || o === '6')) })) },
      }), 201);
      assert.equal(r.percentage, 100);
      assert.equal(r.grade, 7);
    });

    test('fuera del plazo: 409 attempt-expired y el intento se cierra solo con lo que tenía (nota 1,0)', async () => {
      await ok(await call('POST', `/v1/assessments/${ev.id}/attempts`, { user: BENJA }), 201);
      await vencer(ev.id, BENJA, 25);
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: BENJA }), 200);
      const r = await call('POST', `/v1/assessments/${ev.id}/submissions`, {
        user: BENJA, body: { answers: [{ question_id: vista.questions[0].id, selected_option: 1 }] },
      });
      assert.equal(r.status, 409);
      // El GET ya lo cerró (CERRAR_INTENTOS_VENCIDOS): aparece entregado, con nota, y la hora de envío es la del plazo.
      const lista = await ok(await call('GET', `/v1/courses/${MATE}/assessments`, { user: BENJA }), 200);
      const mia = lista.data.find((e) => e.id === ev.id);
      assert.equal(mia.submitted, true);
      assert.equal(mia.grade, 1);
      const { rows } = await testDb.superuser.query(
        'SELECT fecha_envio <= fecha_inicio + interval \'20 minutes\' AS en_plazo FROM intentos_evaluacion WHERE evaluacion_id = $1 AND estudiante_id = $2', [ev.id, BENJA.id]);
      assert.equal(rows[0].en_plazo, true);
    });

    test('el docente ve en resultados y en el libro a quien no alcanzó a entregar', async () => {
      await ok(await call('POST', `/v1/assessments/${ev.id}/attempts`, { user: SOFIA }), 201);
      await vencer(ev.id, SOFIA, 30);
      const res = await ok(await call('GET', `/v1/assessments/${ev.id}/results`, { user: ANA }), 200);
      assert.ok(res.students.some((s) => s.student_id === SOFIA.id && s.grade === 1));
    });

    test('la base rechaza una respuesta fuera de plazo aunque la API se equivocara (trigger, 55000)', async () => {
      await ok(await call('POST', `/v1/assessments/${ev.id}/attempts`, { user: TOMAS }), 201);
      await vencer(ev.id, TOMAS, 40);
      const { rows: [intento] } = await testDb.superuser.query('SELECT id FROM intentos_evaluacion WHERE evaluacion_id = $1 AND estudiante_id = $2', [ev.id, TOMAS.id]);
      const { rows: [pregunta] } = await testDb.superuser.query('SELECT id FROM preguntas WHERE evaluacion_id = $1 ORDER BY orden LIMIT 1', [ev.id]);
      await assert.rejects(
        db.withUser({ id: TOMAS.id, colegioId: A, rol: 'estudiante' }, (c) => c.query(
          'INSERT INTO respuestas_estudiante (evaluacion_id, intento_id, pregunta_id, es_correcta) VALUES ($1, $2, $3, false)', [ev.id, intento.id, pregunta.id])),
        (err) => err.code === '55000',
      );
    });

    test('el estudiante no puede correr su inicio hacia adelante (la base pone la hora)', async () => {
      const { rows: [antes] } = await testDb.superuser.query('SELECT fecha_inicio FROM intentos_evaluacion WHERE evaluacion_id = $1 AND estudiante_id = $2', [ev.id, TOMAS.id]);
      await db.withUser({ id: TOMAS.id, colegioId: A, rol: 'estudiante' }, (c) => c.query(
        "UPDATE intentos_evaluacion SET fecha_inicio = now() + interval '1 day' WHERE evaluacion_id = $1", [ev.id]));
      const { rows: [despues] } = await testDb.superuser.query('SELECT fecha_inicio FROM intentos_evaluacion WHERE evaluacion_id = $1 AND estudiante_id = $2', [ev.id, TOMAS.id]);
      assert.equal(despues.fecha_inicio.getTime(), antes.fecha_inicio.getTime());
    });

    test('duración inválida: 400; docente no empieza intentos (403); otro colegio 404', async () => {
      assert.equal((await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mal', duration_minutes: 0, questions: dosPreguntas } })).status, 400);
      assert.equal((await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mal', duration_minutes: 601, questions: dosPreguntas } })).status, 400);
      assert.equal((await call('POST', `/v1/courses/${MATE}/assessments`, { user: ANA, body: { title: 'Mal', duration_minutes: 1.5, questions: dosPreguntas } })).status, 400);
      assert.equal((await call('POST', `/v1/assessments/${ev.id}/attempts`, { user: ANA })).status, 403);
      const javiera = signJwt({ sub: DEMO.javiera, tenant_id: DEMO.colegioB, role: 'estudiante' }, SECRET);
      const r = await fetch(`${url}/v1/assessments/${ev.id}/attempts`, { method: 'POST', headers: { authorization: `Bearer ${javiera}` } });
      assert.equal(r.status, 404);
    });

    test('el plazo nunca pasa del cierre de la evaluación', async () => {
      const corta = await crear({ title: 'Cierra antes', duration_minutes: 120, questions: dosPreguntas });
      const cierre = new Date(Date.now() + 15 * 60_000).toISOString();
      await publicar(corta.id, { closes_at: cierre });
      const a = await ok(await call('POST', `/v1/assessments/${corta.id}/attempts`, { user: CAMILA }), 201);
      assert.equal(Date.parse(a.deadline), Date.parse(cierre));
    });

    test('sin duración, entregar sin empezar sigue funcionando y se puede entregar vacío', async () => {
      const libre = await crear({ title: 'Sin tiempo', questions: dosPreguntas });
      await publicar(libre.id);
      const r = await ok(await call('POST', `/v1/assessments/${libre.id}/submissions`, { user: CAMILA, body: { answers: [] } }), 201);
      assert.equal(r.percentage, 0);
      assert.equal(r.grade, 1);
    });
  });

  describe('borradores invisibles para el estudiante (RLS)', () => {
    test('con sesión de estudiante, la base no devuelve borradores ni sus preguntas o alternativas', async () => {
      const borrador = await crear({ title: 'Borrador secreto', questions: dosPreguntas });
      const est = { id: CAMILA.id, colegioId: A, rol: 'estudiante' };
      const contar = (sql) => db.withUser(est, (c) => c.query(sql, [borrador.id]), { readOnly: true }).then((r) => r.rows[0].n);
      assert.equal(await contar('SELECT count(*)::int AS n FROM evaluaciones WHERE id = $1'), 0);
      assert.equal(await contar('SELECT count(*)::int AS n FROM preguntas WHERE evaluacion_id = $1'), 0);
      assert.equal(await contar('SELECT count(*)::int AS n FROM alternativas a JOIN preguntas p ON p.id = a.pregunta_id WHERE p.evaluacion_id = $1'), 0);
      // El docente sí los ve.
      const doc = { id: ANA.id, colegioId: A, rol: 'docente' };
      const n = (await db.withUser(doc, (c) => c.query('SELECT count(*)::int AS n FROM preguntas WHERE evaluacion_id = $1', [borrador.id]))).rows[0].n;
      assert.equal(n, 2);
    });
  });

  describe('respuestas escritas a la chilena', () => {
    test('«1.000» vale mil, «1,5» y «1.5» valen 1,5 y las mayúsculas con tilde se normalizan', async () => {
      const ev = await crear({
        title: 'Números chilenos',
        questions: [
          { statement: '¿Cuánto es 10 × 100?', type: 'text', accepted_answers: ['1000'] },
          { statement: '¿Cuánto es 3 / 2?', type: 'text', accepted_answers: ['1,5'] },
          { statement: '¿Cuánto es 1 × 1?', type: 'text', accepted_answers: ['1'] },
          { statement: 'Escribe ÁRBOL en minúsculas sin tilde', type: 'text', accepted_answers: ['arbol'] },
        ],
      });
      await publicar(ev.id);
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: BENJA }), 200);
      const textos = ['1.000', '1.5', '1.000', 'ÁRBOL'];
      const r = await ok(await call('POST', `/v1/assessments/${ev.id}/submissions`, {
        user: BENJA, body: { answers: vista.questions.map((q, i) => ({ question_id: q.id, text_answer: textos[i] })) },
      }), 201);
      // 1.000 = 1000 ✔ · 1.5 = 1,5 ✔ · 1.000 ≠ 1 ✘ · ÁRBOL = arbol ✔
      assert.deepEqual(r.answers.map((a) => a.correct), [true, true, false, true]);
    });
  });

  describe('revisión docente concurrente y notas provisionales', () => {
    test('dos revisiones simultáneas del mismo intento no pierden puntaje; la nota provisional se marca', async () => {
      const ev = await crear({
        title: 'Dos escritas',
        questions: [
          { statement: 'Explica qué es una fracción', type: 'text' },
          { statement: 'Explica qué es un decimal', type: 'text' },
        ],
      });
      await publicar(ev.id);
      const vista = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: SOFIA }), 200);
      const envio = await ok(await call('POST', `/v1/assessments/${ev.id}/submissions`, {
        user: SOFIA, body: { answers: vista.questions.map((q) => ({ question_id: q.id, text_answer: 'Una parte de un todo' })) },
      }), 201);
      assert.equal(envio.pending_review, 2);

      // Provisional en Mis notas, en el libro y en riesgo.
      const mis = await ok(await call('GET', `/v1/me/grades?course_id=${MATE}`, { user: SOFIA }), 200);
      assert.equal(mis.courses[0].grades.find((g) => g.assessment_id === ev.id).pending_review, 2);
      const libro = await ok(await call('GET', `/v1/courses/${MATE}/gradebook`, { user: ANA }), 200);
      assert.ok(libro.students.find((s) => s.student_id === SOFIA.id).provisional.includes(ev.id));
      const resumen = await ok(await call('GET', `/v1/courses/${MATE}/grades/summary?threshold=7`, { user: ANA }), 200);
      assert.ok(resumen.at_risk.find((s) => s.student_id === SOFIA.id).provisional_grades >= 1);

      const bandeja = await ok(await call('GET', `/v1/assessments/${ev.id}/text-answers`, { user: ANA }), 200);
      const mias = bandeja.data.filter((r) => r.student_id === SOFIA.id);
      assert.equal(mias.length, 2);
      const [r1, r2] = await Promise.all(mias.map((r) => call('PATCH', `/v1/assessments/${ev.id}/text-answers/${r.id}`, { user: ANA, body: { correct: true } })));
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      const { rows } = await testDb.superuser.query('SELECT puntaje FROM intentos_evaluacion WHERE evaluacion_id = $1 AND estudiante_id = $2', [ev.id, SOFIA.id]);
      assert.equal(Number(rows[0].puntaje), 100);
      const despues = await ok(await call('GET', `/v1/me/grades?course_id=${MATE}`, { user: SOFIA }), 200);
      const nota = despues.courses[0].grades.find((g) => g.assessment_id === ev.id);
      assert.equal(nota.pending_review, 0);
      assert.equal(nota.grade, 7);
    });
  });

  describe('material visible para estudiantes', () => {
    const put = (name, text, query = '') => call('PUT', `/v1/courses/${MATE}/documents/${encodeURIComponent(name)}${query}`, { user: ANA, raw: text, type: 'text/markdown' });
    const materiales = (user) => call('GET', `/v1/courses/${MATE}/materials`, { user }).then((r) => ok(r, 200)).then((b) => b.data.map((m) => m.name));

    test('una pauta subida como oculta la usa el tutor pero el estudiante no la ve ni la descarga', async () => {
      await ok(await put('apunte-visible.md', '# Fracciones equivalentes\n\nDos fracciones son equivalentes si representan la misma parte.'), 201);
      const pauta = await ok(await put('pauta-prueba.md', '# Pauta\n\nRespuestas: 1) b 2) c', '?visible_to_students=false'), 201);
      assert.equal(pauta.visible_to_students, false);
      assert.ok((await materiales(CAMILA)).includes('apunte-visible.md'));
      assert.ok(!(await materiales(CAMILA)).includes('pauta-prueba.md'));
      assert.ok((await materiales(ANA)).includes('pauta-prueba.md'));
      assert.equal((await call('GET', `/v1/courses/${MATE}/materials/${encodeURIComponent('pauta-prueba.md')}/file`, { user: CAMILA })).status, 404);
      // El docente la muestra y ahora sí aparece.
      const r = await ok(await call('PATCH', `/v1/courses/${MATE}/documents/${encodeURIComponent('pauta-prueba.md')}`, { user: ANA, body: { visible_to_students: true } }), 200);
      assert.equal(r.visible_to_students, true);
      assert.ok((await materiales(CAMILA)).includes('pauta-prueba.md'));
      // Reemplazarla sin el parámetro conserva lo elegido.
      await ok(await put('pauta-prueba.md', '# Pauta\n\nRespuestas corregidas: 1) a'), 200);
      assert.ok((await materiales(CAMILA)).includes('pauta-prueba.md'));
    });

    test('permisos de la visibilidad: estudiante 403, otro docente 404 (no ve el curso), valor inválido 400', async () => {
      const ruta = `/v1/courses/${MATE}/documents/${encodeURIComponent('apunte-visible.md')}`;
      assert.equal((await call('PATCH', ruta, { user: CAMILA, body: { visible_to_students: false } })).status, 403);
      assert.equal((await call('PATCH', ruta, { user: LUIS, body: { visible_to_students: false } })).status, 404);
      assert.equal((await call('PATCH', ruta, { user: ANA, body: { visible_to_students: 'no' } })).status, 400);
      assert.equal((await call('PATCH', `/v1/courses/${MATE}/documents/no-existe.md`, { user: ANA, body: { visible_to_students: true } })).status, 404);
    });
  });

  describe('freno del login con pedidos en paralelo', () => {
    test('20 claves malas simultáneas: el freno deja pasar solo las permitidas (3) y el resto recibe 429', async () => {
      const intentos = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${url}/v1/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'tomas@demo-a.cl', password: `mala-${i}` }),
      })));
      const estados = intentos.map((r) => r.status);
      assert.equal(estados.filter((s) => s === 401).length, 3, JSON.stringify(estados));
      assert.equal(estados.filter((s) => s === 429).length, 17);
    });
  });
});
