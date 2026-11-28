// Ciclo mínimo del producto contra un PostgreSQL REAL (RLS + permisos por rol):
//   H1 crear curso y matricular · H2 crear y publicar una evaluación · H4 rendirla y ver la nota.
// Se saltan si no hay TEST_DATABASE_URL (ver test/pg-fixture.js).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const A = DEMO.colegioA;
const B = DEMO.colegioB;
const ANA = { id: DEMO.ana, rol: 'docente' };      // docente de Matemáticas (curso MATE)
const LUIS = { id: DEMO.luis, rol: 'docente' };    // docente de Historia
const MARTA = { id: DEMO.marta, rol: 'admin_colegio' };
const CAMILA = { id: DEMO.camila, rol: 'estudiante' };
const TOMAS = { id: DEMO.tomas, rol: 'estudiante' };
const PEDRO = { id: DEMO.pedro, rol: 'docente' };  // colegio B
const JAVIERA = { id: DEMO.javiera, rol: 'estudiante' }; // colegio B

const preguntas = [
  { statement: '¿Cuánto es 3/4 + 1/4?', options: ['1/2', '1', '4/8', '3/16'], correct_option: 1, feedback: 'Suma los numeradores con igual denominador: 4/4 = 1.' },
  { statement: '¿Qué indica el denominador?', options: ['Las partes que se toman', 'En cuántas partes se divide el todo'], correct_option: 1, feedback: 'El denominador cuenta las partes iguales del todo.' },
];

describe('ciclo mínimo H1 → H2 → H4 (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;
  let server;
  let url;

  const tok = (u, tenant = A) => signJwt({ sub: u.id, tenant_id: tenant, role: u.rol }, SECRET);
  const call = (method, path, { user, tenant, body, key = randomUUID() } = {}) => fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user && { authorization: `Bearer ${tok(user, tenant)}` }),
      ...(key && method === 'POST' && { 'idempotency-key': key }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ok = async (res, status) => {
    assert.equal(res.status, status, `esperaba ${status}, llegó ${res.status}: ${await res.clone().text()}`);
    return res.json();
  };

  before(async () => {
    testDb = await createTestDatabase('ffa_ciclo');
    db = createDb({ connectionString: testDb.appUrl, max: 6 });
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server?.close();
    await db?.end();
    await testDb?.drop();
  });

  let cursoId;
  let evaluacionId;
  let draft; // evaluación a medio armar, para probar la publicación

  describe('H1 · crear curso y matricular', () => {
    test('el docente crea un curso a su nombre: queda en su colegio, con el nombre del docente', async () => {
      const curso = await ok(await call('POST', '/v1/courses', { user: ANA, body: { name: 'Lenguaje 7° Básico B', period: '2026-S2', subject: 'Lenguaje', grade_level: '7B' } }), 201);
      cursoId = curso.id;
      assert.equal(curso.teacher_id, ANA.id);
      assert.equal(curso.teacher_name, 'Ana Rojas');
      assert.equal(curso.students_count, 0);
      assert.equal(curso.tutor_available, false);
      const fila = await testDb.superuser.query('SELECT colegio_id FROM cursos WHERE id = $1', [cursoId]);
      assert.equal(fila.rows[0].colegio_id, A);
    });

    test('el estudiante NO crea cursos (403); un docente no crea a nombre de otro (403); sin token 401', async () => {
      const body = { name: 'Curso pirata', period: '2026-S2' };
      assert.equal((await call('POST', '/v1/courses', { user: CAMILA, body })).status, 403);
      assert.equal((await call('POST', '/v1/courses', { user: ANA, body: { ...body, teacher_id: LUIS.id } })).status, 403);
      assert.equal((await call('POST', '/v1/courses', { body })).status, 401);
    });

    test('el admin crea indicando el docente; sin teacher_id 400; con un id que no es docente, 422', async () => {
      const body = { name: 'Historia 8° Básico A', period: '2026-S2' };
      const curso = await ok(await call('POST', '/v1/courses', { user: MARTA, body: { ...body, teacher_id: LUIS.id } }), 201);
      assert.equal(curso.teacher_id, LUIS.id);
      assert.equal((await call('POST', '/v1/courses', { user: MARTA, body })).status, 400);
      assert.equal((await call('POST', '/v1/courses', { user: MARTA, body: { ...body, teacher_id: CAMILA.id } })).status, 422);
    });

    test('datos inválidos -> 400; falta la Idempotency-Key -> 400', async () => {
      for (const body of [{}, { name: 'ab', period: '2026-S2' }, { name: 'Curso', period: '2026' }, { name: 'Curso', period: '2026-S3' }, { name: 'Curso', period: '2026-S2', subject: 'x'.repeat(81) }]) {
        assert.equal((await call('POST', '/v1/courses', { user: ANA, body })).status, 400, JSON.stringify(body));
      }
      assert.equal((await call('POST', '/v1/courses', { user: ANA, key: null, body: { name: 'Curso', period: '2026-S2' } })).status, 400);
    });

    test('Idempotency-Key: repetir la misma petición devuelve el mismo curso, una sola vez', async () => {
      const key = randomUUID();
      const body = { name: 'Ciencias 7° Básico A', period: '2026-S2' };
      const [a, b] = await Promise.all([call('POST', '/v1/courses', { user: ANA, body, key }), call('POST', '/v1/courses', { user: ANA, body, key })]);
      const [x, y] = [await ok(a, 201), await ok(b, 201)];
      assert.equal(x.id, y.id);
      const c = await call('POST', '/v1/courses', { user: ANA, body, key });
      assert.equal(c.headers.get('idempotent-replayed'), 'true');
      assert.equal((await c.json()).id, x.id);
      const n = await testDb.superuser.query("SELECT count(*)::int AS n FROM cursos WHERE nombre = 'Ciencias 7° Básico A'");
      assert.equal(n.rows[0].n, 1);
    });

    test('la misma clave en OTRA operación -> 422', async () => {
      const key = randomUUID();
      await ok(await call('POST', '/v1/courses', { user: ANA, key, body: { name: 'Artes 7° Básico A', period: '2026-S2' } }), 201);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, key, body: { student_email: 'camila@demo-a.cl' } })).status, 422);
    });

    test('el docente matricula por correo; el estudiante aparece en la lista de matriculados', async () => {
      const m = await ok(await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'Camila@Demo-A.cl' } }), 201);
      assert.equal(m.course_id, cursoId);
      assert.equal(m.student_id, CAMILA.id);
      await ok(await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'tomas@demo-a.cl' } }), 201);
      const lista = await ok(await call('GET', `/v1/courses/${cursoId}/enrollments`, { user: ANA }), 200);
      assert.deepEqual(lista.data.map((e) => e.name), ['Camila Díaz', 'Tomás Fuentes']);
      assert.equal((await ok(await call('GET', `/v1/courses/${cursoId}`, { user: ANA }), 200)).students_count, 2);
    });

    test('matricular dos veces al mismo estudiante -> 409', async () => {
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'camila@demo-a.cl' } })).status, 409);
    });

    test('un estudiante de OTRO colegio no existe para este docente (404); correo desconocido o mal escrito (404 / 400)', async () => {
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'javiera@demo-b.cl' } })).status, 404);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'nadie@demo-a.cl' } })).status, 404);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'no-es-correo' } })).status, 400);
      // Un docente no es estudiante: no se matricula.
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: ANA, body: { student_email: 'luis.perez@demo-a.cl' } })).status, 404);
    });

    test('permisos de matrícula: otro docente 403, estudiante 403, docente de otro colegio 404', async () => {
      const body = { student_email: 'sofia@demo-a.cl' };
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: LUIS, body })).status, 403);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: CAMILA, body })).status, 403);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: PEDRO, tenant: B, body })).status, 404);
      assert.equal((await call('GET', `/v1/courses/${cursoId}/enrollments`, { user: CAMILA })).status, 403);
      assert.equal((await call('GET', `/v1/courses/${cursoId}/enrollments`, { user: PEDRO, tenant: B })).status, 404);
      const sofia = await testDb.superuser.query("SELECT count(*)::int AS n FROM matriculas m JOIN usuarios u ON u.id = m.estudiante_id WHERE m.curso_id = $1 AND u.email = 'sofia@demo-a.cl'", [cursoId]);
      assert.equal(sofia.rows[0].n, 0);
    });
  });

  describe('H2 · crear y publicar una evaluación', () => {
    test('el docente crea una evaluación en borrador con preguntas, alternativas y retroalimentación', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body: { title: 'Prueba de fracciones', questions: preguntas } }), 201);
      evaluacionId = ev.id;
      assert.equal(ev.status, 'draft');
      assert.equal(ev.questions.length, 2);
      assert.deepEqual(ev.questions[0].options, ['1/2', '1', '4/8', '3/16']);
      assert.equal(ev.questions[0].correct_option, 1);
      assert.equal(ev.questions[1].feedback, 'El denominador cuenta las partes iguales del todo.');
      assert.equal(ev.published_at, null);
    });

    test('el orden de las alternativas se conserva tal como lo escribió el docente', async () => {
      const q = { statement: 'Ordena: ¿cuál es la letra D?', options: ['Z', 'Y', 'X', 'W', 'V', 'U'], correct_option: 3 };
      const ev = await ok(await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body: { title: 'Orden estable', questions: [q] } }), 201);
      const leida = await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: ANA }), 200);
      assert.deepEqual(leida.questions[0].options, ['Z', 'Y', 'X', 'W', 'V', 'U']);
      assert.equal(leida.questions[0].correct_option, 3);
    });

    test('solo el docente del curso o el admin crean: estudiante 403, otro docente 403, otro colegio 404', async () => {
      const body = { title: 'Prueba pirata', questions: preguntas };
      assert.equal((await call('POST', `/v1/courses/${cursoId}/assessments`, { user: CAMILA, body })).status, 403);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/assessments`, { user: LUIS, body })).status, 403);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/assessments`, { user: PEDRO, tenant: B, body })).status, 404);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/assessments`, { user: MARTA, body })).status, 201);
    });

    test('un estudiante del colegio SIN matrícula en el curso: 403 en las rutas del personal (docs/permisos.md)', async () => {
      const SOFIA = { id: DEMO.sofia, rol: 'estudiante' };
      assert.equal((await call('GET', `/v1/courses/${cursoId}/enrollments`, { user: SOFIA })).status, 403);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/enrollments`, { user: SOFIA, body: { student_email: 'sofia@demo-a.cl' } })).status, 403);
      assert.equal((await call('POST', `/v1/courses/${cursoId}/assessments`, { user: SOFIA, body: { title: 'Prueba pirata', questions: preguntas } })).status, 403);
    });

    test('datos inválidos -> 400 y no queda nada a medias', async () => {
      const antes = (await testDb.superuser.query('SELECT count(*)::int AS n FROM evaluaciones')).rows[0].n;
      const q = preguntas[0];
      for (const body of [
        { title: 'ab', questions: preguntas }, { title: 'Prueba', questions: [] }, { title: 'Prueba' },
        { title: 'Prueba', questions: [{ ...q, options: ['solo una'] }] },
        { title: 'Prueba', questions: [{ ...q, options: ['1', '2', '3', '4', '5', '6', '7'] }] },
        { title: 'Prueba', questions: [{ ...q, options: ['igual', 'IGUAL'] }] },
        { title: 'Prueba', questions: [{ ...q, correct_option: 9 }] },
        { title: 'Prueba', questions: [{ ...q, correct_option: '1' }] },
        { title: 'Prueba', questions: [{ ...q, statement: 'x' }] },
        { title: 'Prueba', questions: [q, { ...q, options: ['a', ''] }] },
        { title: 'Prueba', max_attempts: 3, questions: [q] },
        { title: 'Prueba', closes_at: '2020-01-01T00:00:00Z', questions: [q] },
      ]) {
        assert.equal((await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body })).status, 400, JSON.stringify(body).slice(0, 80));
      }
      const despues = (await testDb.superuser.query('SELECT count(*)::int AS n FROM evaluaciones')).rows[0].n;
      assert.equal(despues, antes);
    });

    test('NO se publica si una pregunta no tiene alternativa correcta: 422 que dice cuál', async () => {
      const sinCorrecta = [preguntas[0], { statement: '¿Qué es una fracción propia?', options: ['Numerador menor que denominador', 'Numerador mayor'], correct_option: null }];
      draft = await ok(await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body: { title: 'Borrador incompleto', questions: sinCorrecta } }), 201);
      const res = await call('PATCH', `/v1/assessments/${draft.id}`, { user: ANA, body: { status: 'published' } });
      const problema = await ok(res, 422);
      assert.match(problema.detail, /pregunta 2/);
      assert.deepEqual(problema.errors, [{ field: 'questions[1].correct_option', message: 'Requerido para publicar.' }]);
      const estado = await testDb.superuser.query('SELECT estado FROM evaluaciones WHERE id = $1', [draft.id]);
      assert.equal(estado.rows[0].estado, 'borrador');
    });

    test('el estudiante NO puede publicar y un borrador no existe para él (404)', async () => {
      // 14: el RLS ya no le muestra borradores al estudiante, así que ni siquiera sabe que existe (antes, 403).
      assert.equal((await call('PATCH', `/v1/assessments/${evaluacionId}`, { user: CAMILA, body: { status: 'published' } })).status, 404);
      assert.equal((await call('GET', `/v1/assessments/${evaluacionId}`, { user: CAMILA })).status, 404);
      const lista = await ok(await call('GET', `/v1/courses/${cursoId}/assessments`, { user: CAMILA }), 200);
      assert.ok(lista.data.every((e) => e.status !== 'draft'), 'los borradores no aparecen en la lista del estudiante');
    });

    test('estado inválido -> 400; otro docente 403; otro colegio 404', async () => {
      assert.equal((await call('PATCH', `/v1/assessments/${evaluacionId}`, { user: ANA, body: { status: 'draft' } })).status, 400);
      assert.equal((await call('PATCH', `/v1/assessments/${evaluacionId}`, { user: LUIS, body: { status: 'published' } })).status, 403);
      assert.equal((await call('PATCH', `/v1/assessments/${evaluacionId}`, { user: PEDRO, tenant: B, body: { status: 'published' } })).status, 404);
    });

    test('el docente publica una evaluación completa; publicar de nuevo -> 409', async () => {
      const ev = await ok(await call('PATCH', `/v1/assessments/${evaluacionId}`, { user: ANA, body: { status: 'published' } }), 200);
      assert.equal(ev.status, 'published');
      assert.ok(ev.published_at);
      assert.equal((await call('PATCH', `/v1/assessments/${evaluacionId}`, { user: ANA, body: { status: 'published' } })).status, 409);
    });

    test('lista del docente (con borradores y entregas) y detalle completo con la alternativa correcta', async () => {
      const lista = await ok(await call('GET', `/v1/courses/${cursoId}/assessments`, { user: ANA }), 200);
      const e = lista.data.find((x) => x.id === evaluacionId);
      assert.deepEqual({ status: e.status, questions_count: e.questions_count, submissions_count: e.submissions_count }, { status: 'published', questions_count: 2, submissions_count: 0 });
      assert.ok(lista.data.some((x) => x.status === 'draft'));
      assert.equal((await call('GET', `/v1/courses/${cursoId}/assessments`, { user: LUIS })).status, 403);
    });
  });

  describe('H4 · rendir y recibir la retroalimentación', () => {
    test('el estudiante ve la evaluación publicada SIN la alternativa correcta ni la retroalimentación', async () => {
      const ev = await ok(await call('GET', `/v1/assessments/${evaluacionId}`, { user: CAMILA }), 200);
      const crudo = JSON.stringify(ev);
      assert.ok(!crudo.includes('correct_option'));
      assert.ok(!crudo.includes('feedback'));
      assert.ok(!crudo.includes('es_correcta'));
      assert.deepEqual(ev.questions[0].options, ['1/2', '1', '4/8', '3/16']);
      const lista = await ok(await call('GET', `/v1/courses/${cursoId}/assessments`, { user: CAMILA }), 200);
      const mia = lista.data.find((e) => e.id === evaluacionId);
      assert.deepEqual({ submitted: mia.submitted, grade: mia.grade }, { submitted: false, grade: null });
    });

    test('un estudiante NO matriculado no la ve ni la rinde (404); Sofía no está en este curso', async () => {
      const SOFIA = { id: DEMO.sofia, rol: 'estudiante' };
      assert.equal((await call('GET', `/v1/assessments/${evaluacionId}`, { user: SOFIA })).status, 404);
      assert.equal((await call('GET', `/v1/courses/${cursoId}/assessments`, { user: SOFIA })).status, 404);
      const r = await call('POST', `/v1/assessments/${evaluacionId}/submissions`, { user: SOFIA, body: { answers: [{ question_id: randomUUID(), selected_option: 0 }] } });
      assert.equal(r.status, 404);
      assert.equal((await call('GET', `/v1/assessments/${evaluacionId}`, { user: JAVIERA, tenant: B })).status, 404);
    });

    test('docente y admin no rinden (403); respuestas inválidas 400 / 422 sin dejar un intento abierto', async () => {
      const ev = await ok(await call('GET', `/v1/assessments/${evaluacionId}`, { user: CAMILA }), 200);
      const [q1, q2] = ev.questions;
      assert.equal((await call('POST', `/v1/assessments/${evaluacionId}/submissions`, { user: ANA, body: { answers: [{ question_id: q1.id, selected_option: 1 }] } })).status, 403);
      for (const answers of ['no-es-lista', [{ question_id: 'x', selected_option: 0 }], [{ question_id: q1.id, selected_option: -1 }], [{ question_id: q1.id, selected_option: 'A' }],
        [{ question_id: q1.id, selected_option: 0 }, { question_id: q1.id, selected_option: 1 }]]) {
        assert.equal((await call('POST', `/v1/assessments/${evaluacionId}/submissions`, { user: CAMILA, body: { answers } })).status, 400, JSON.stringify(answers));
      }
      assert.equal((await call('POST', `/v1/assessments/${evaluacionId}/submissions`, { user: CAMILA, body: { answers: [{ question_id: q2.id, selected_option: 5 }] } })).status, 422);
      assert.equal((await call('POST', `/v1/assessments/${evaluacionId}/submissions`, { user: CAMILA, body: { answers: [{ question_id: randomUUID(), selected_option: 0 }] } })).status, 422);
      const abiertos = await testDb.superuser.query('SELECT count(*)::int AS n FROM intentos_evaluacion WHERE evaluacion_id = $1', [evaluacionId]);
      assert.equal(abiertos.rows[0].n, 0);
    });

    test('Camila responde 1 de 2 bien: puntaje, nota y retroalimentación por pregunta al instante', async () => {
      const ev = await ok(await call('GET', `/v1/assessments/${evaluacionId}`, { user: CAMILA }), 200);
      const [q1, q2] = ev.questions;
      const r = await ok(await call('POST', `/v1/assessments/${evaluacionId}/submissions`, {
        user: CAMILA, body: { answers: [{ question_id: q1.id, selected_option: 1 }, { question_id: q2.id, selected_option: 0 }] },
      }), 201);
      assert.equal(r.score, 1);
      assert.equal(r.max_score, 2);
      assert.equal(r.percentage, 50);
      assert.equal(r.grade, 3.5); // 50 % con exigencia 60 %: 1,0 + 3,0 · 50/60 = 3,5
      assert.deepEqual(r.answers, [
        { question_id: q1.id, correct: true, pending_review: false, feedback: 'Suma los numeradores con igual denominador: 4/4 = 1.' },
        { question_id: q2.id, correct: false, pending_review: false, feedback: 'El denominador cuenta las partes iguales del todo.' },
      ]);
    });

    test('una pregunta sin responder cuenta como incorrecta (Tomás responde solo una)', async () => {
      const ev = await ok(await call('GET', `/v1/assessments/${evaluacionId}`, { user: TOMAS }), 200);
      const r = await ok(await call('POST', `/v1/assessments/${evaluacionId}/submissions`, {
        user: TOMAS, body: { answers: [{ question_id: ev.questions[0].id, selected_option: 1 }] },
      }), 201);
      assert.equal(r.score, 1);
      assert.equal(r.answers.length, 2);
      assert.equal(r.answers[1].correct, false);
    });

    test('un segundo envío -> 409 con el resultado anterior; con la misma clave, la misma respuesta (no duplica)', async () => {
      const ev = await ok(await call('GET', `/v1/assessments/${evaluacionId}`, { user: CAMILA }), 200);
      const body = { answers: [{ question_id: ev.questions[0].id, selected_option: 1 }, { question_id: ev.questions[1].id, selected_option: 1 }] };
      const res = await call('POST', `/v1/assessments/${evaluacionId}/submissions`, { user: CAMILA, body });
      const problema = await ok(res, 409);
      assert.match(problema.detail, /Ya rendiste/);
      assert.match(problema.detail, /50% de logro, nota 3,5/);
      const n = await testDb.superuser.query('SELECT count(*)::int AS n FROM intentos_evaluacion WHERE evaluacion_id = $1 AND estudiante_id = $2', [evaluacionId, CAMILA.id]);
      assert.equal(n.rows[0].n, 1);
    });

    test('dos envíos a la vez del mismo estudiante: solo uno se guarda', async () => {
      const MATE_EV = await ok(await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body: { title: 'Carrera', questions: [preguntas[1]] } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${MATE_EV.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const q = (await ok(await call('GET', `/v1/assessments/${MATE_EV.id}`, { user: TOMAS }), 200)).questions[0];
      const body = { answers: [{ question_id: q.id, selected_option: 1 }] };
      const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/v1/assessments/${MATE_EV.id}/submissions`, { user: TOMAS, body })));
      const estados = rs.map((r) => r.status).sort();
      assert.equal(estados.filter((s) => s === 201).length, 1, estados.join(','));
      assert.ok(estados.every((s) => s === 201 || s === 409), estados.join(','));
      const n = await testDb.superuser.query('SELECT count(*)::int AS n FROM intentos_evaluacion WHERE evaluacion_id = $1', [MATE_EV.id]);
      assert.equal(n.rows[0].n, 1);
    });

    test('la nota aparece en Mis notas y en la lista de evaluaciones del estudiante; el docente ve la entrega', async () => {
      const mis = await ok(await call('GET', '/v1/me/grades', { user: CAMILA }), 200);
      const ramo = mis.courses.find((c) => c.course_id === cursoId);
      assert.equal(ramo.grades.find((g) => g.assessment_id === evaluacionId).grade, 3.5);
      assert.equal(ramo.average, 3.5);
      const lista = await ok(await call('GET', `/v1/courses/${cursoId}/assessments`, { user: CAMILA }), 200);
      const mia = lista.data.find((e) => e.id === evaluacionId);
      assert.deepEqual({ submitted: mia.submitted, grade: mia.grade }, { submitted: true, grade: 3.5 });
      const resultados = await ok(await call('GET', `/v1/assessments/${evaluacionId}/results`, { user: ANA }), 200);
      assert.equal(resultados.submissions_count, 2);
    });

    test('una evaluación cerrada no se rinde (409) y sigue visible para quien ya la rindió', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body: { title: 'Cerrada', questions: [preguntas[1]] } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      assert.equal((await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'closed' } })).status, 200);
      assert.equal((await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'closed' } })).status, 409);
      const q = (await ok(await call('GET', `/v1/assessments/${ev.id}`, { user: CAMILA }), 200)).questions[0];
      assert.equal((await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: CAMILA, body: { answers: [{ question_id: q.id, selected_option: 1 }] } })).status, 409);
    });

    test('un estudiante dado de baja del curso ya no la rinde (404)', async () => {
      const ev = await ok(await call('POST', `/v1/courses/${cursoId}/assessments`, { user: ANA, body: { title: 'Para el que se fue', questions: [preguntas[1]] } }), 201);
      await ok(await call('PATCH', `/v1/assessments/${ev.id}`, { user: ANA, body: { status: 'published' } }), 200);
      const q = ev.questions[0];
      await testDb.superuser.query('UPDATE matriculas SET activo = false WHERE curso_id = $1 AND estudiante_id = $2', [cursoId, TOMAS.id]);
      assert.equal((await call('POST', `/v1/assessments/${ev.id}/submissions`, { user: TOMAS, body: { answers: [{ question_id: q.id, selected_option: 1 }] } })).status, 404);
    });
  });
});
