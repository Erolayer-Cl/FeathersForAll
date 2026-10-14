// Pruebas de integración de las rutas de notas contra un PostgreSQL REAL.
// Se saltan si no hay TEST_DATABASE_URL (un superusuario de una base de pruebas):
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
//
// Crean una base temporal, aplican 01 + 02 + 03 + 90_seed_demo.sql y conectan la
// API como feathersforall_app (sin BYPASSRLS), igual que en producción.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const logger = pino({ level: 'silent' });

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const ANA = 'a0000000-0000-0000-0000-000000000001';      // docente Matemáticas (A)
const LUIS = 'a0000000-0000-0000-0000-000000000002';     // docente Historia (A)
const MARTA = 'a0000000-0000-0000-0000-000000000003';    // admin colegio A
const CAMILA = 'e0000000-0000-0000-0000-000000000001';
const BENJA = 'e0000000-0000-0000-0000-000000000002';
const SOFIA = 'e0000000-0000-0000-0000-000000000003';
const TOMAS = 'e0000000-0000-0000-0000-000000000004';
const PEDRO = 'b0000000-0000-0000-0000-000000000001';    // docente colegio B
const MATE = 'c0000000-0000-0000-0000-000000000001';
const FRACCIONES = 'd0000000-0000-0000-0000-000000000001';
const DECIMALES = 'd0000000-0000-0000-0000-000000000002';

const token = (sub, tenant_id, role) => signJwt({ sub, tenant_id, role }, SECRET);
const T = {
  ana: token(ANA, A, 'docente'),
  luis: token(LUIS, A, 'docente'),
  marta: token(MARTA, A, 'admin_colegio'),
  camila: token(CAMILA, A, 'estudiante'),
  tomas: token(TOMAS, A, 'estudiante'),
  pedro: token(PEDRO, B, 'docente'),
};

describe('notas (PostgreSQL)', { skip: !ADMIN_URL && 'sin TEST_DATABASE_URL' }, () => {
  const dbName = `ffa_test_${randomBytes(4).toString('hex')}`;
  let admin;
  let db;
  let server;
  let url;

  const get = (path, tok) =>
    fetch(url + path, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  const getJson = async (path, tok, status = 200) => {
    const res = await get(path, tok);
    assert.equal(res.status, status, `${path} -> ${res.status}`);
    return res.json();
  };

  before(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    // El rol es del servidor (no de la base): puede existir de otra prueba sin LOGIN.
    await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN
          CREATE ROLE feathersforall_app;
        END IF;
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
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger, llm, db, jwtSecret: SECRET }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  describe('autenticación', () => {
    test('sin token -> 401 RFC 7807', async () => {
      const res = await get('/v1/me/grades');
      assert.equal(res.status, 401);
      assert.match(res.headers.get('content-type'), /application\/problem\+json/);
    });

    test('firma inválida o alg "none" -> 401', async () => {
      assert.equal((await get('/v1/me/grades', signJwt({ sub: CAMILA, tenant_id: A, role: 'estudiante' }, 'otro-secreto'))).status, 401);
      const [, payload] = T.camila.split('.');
      const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload}.`;
      assert.equal((await get('/v1/me/grades', none)).status, 401);
    });

    test('token vencido -> 401', async () => {
      const vencido = signJwt({ sub: CAMILA, tenant_id: A, role: 'estudiante' }, SECRET, { expiresInSec: -10 });
      assert.equal((await get('/v1/me/grades', vencido)).status, 401);
    });

    test('/health informa la base de datos', async () => {
      assert.deepEqual(await getJson('/health'), { status: 'ok', llm: 'up', db: 'up', rag: 'disabled' });
    });
  });

  describe('GET /v1/me/grades', () => {
    test('notas del estudiante por curso con promedio ponderado', async () => {
      const body = await getJson('/v1/me/grades', T.camila);
      const mate = body.courses.find((c) => c.course_id === MATE);
      // Fracciones 7.0 (pondera 1) + Decimales 5.1 (pondera 2) -> 17.2 / 3 = 5.7
      assert.deepEqual(mate.grades.map((g) => g.grade), [7.0, 5.1]);
      assert.equal(mate.average, 5.7);
      assert.equal(body.courses.length, 2);
    });

    test('filtra por course_id y valida el UUID', async () => {
      const body = await getJson(`/v1/me/grades?course_id=${MATE}`, T.camila);
      assert.equal(body.courses.length, 1);
      await getJson('/v1/me/grades?course_id=abc', T.camila, 400);
    });

    test('un intento en curso no tiene nota', async () => {
      const body = await getJson(`/v1/me/grades?course_id=${MATE}`, T.tomas);
      assert.deepEqual(body.courses[0].grades.map((g) => g.assessment_id), [FRACCIONES]);
      await getJson(`/v1/me/grades/${DECIMALES}`, T.tomas, 404);
    });

    test('detalle de una entrega con retroalimentación', async () => {
      const body = await getJson(`/v1/me/grades/${FRACCIONES}`, T.camila);
      assert.equal(body.grade, 7.0);
      assert.equal(body.weight, 1);
      assert.equal(body.answers.length, 4);
      assert.ok(body.answers.every((a) => a.correct && a.feedback));
    });

    test('un docente no usa /me/grades', async () => {
      await getJson('/v1/me/grades', T.ana, 403);
    });
  });

  describe('libro de notas y resumen del curso', () => {
    test('gradebook del docente: evaluaciones publicadas y todos los estudiantes', async () => {
      const body = await getJson(`/v1/courses/${MATE}/gradebook`, T.ana);
      assert.deepEqual(body.assessments.map((a) => a.title), ['Fracciones', 'Números decimales']);
      assert.equal(body.students.length, 4);
      const sofia = body.students.find((s) => s.student_id === SOFIA);
      assert.deepEqual(sofia.grades, { [FRACCIONES]: 2.3, [DECIMALES]: 1.0 });
      assert.equal(sofia.average, 1.4);   // (2.3 + 1.0 * 2) / 3
      const benja = body.students.find((s) => s.student_id === BENJA);
      assert.deepEqual(benja.grades, { [FRACCIONES]: 5.1 });
    });

    test('el admin del colegio también lo ve; otro docente y un estudiante no', async () => {
      await getJson(`/v1/courses/${MATE}/gradebook`, T.marta);
      await getJson(`/v1/courses/${MATE}/gradebook`, T.luis, 403);
      await getJson(`/v1/courses/${MATE}/gradebook`, T.camila, 403);
    });

    test('un docente de OTRO colegio recibe 404 (RLS)', async () => {
      await getJson(`/v1/courses/${MATE}/gradebook`, T.pedro, 404);
    });

    test('resumen: aprobados, reprobados, pendientes y estudiantes en riesgo', async () => {
      const body = await getJson(`/v1/courses/${MATE}/grades/summary`, T.ana);
      assert.equal(body.enrolled_students, 4);
      const fr = body.assessments.find((a) => a.assessment_id === FRACCIONES);
      assert.deepEqual(
        { submissions: fr.submissions, passed: fr.passed, failed: fr.failed, min: fr.min, max: fr.max, average: fr.average },
        { submissions: 4, passed: 2, failed: 2, min: 2.3, max: 7.0, average: 4.5 },
      );
      assert.equal(body.assessments.find((a) => a.assessment_id === DECIMALES).pending, 2);
      assert.deepEqual(body.at_risk.map((s) => [s.student_id, s.average]), [[SOFIA, 1.4], [TOMAS, 3.5]]);
    });

    test('umbral de riesgo configurable y validado', async () => {
      const body = await getJson(`/v1/courses/${MATE}/grades/summary?threshold=5.5`, T.ana);
      // Benjamín (5.1) entra; Camila (5.7) no.
      assert.deepEqual(body.at_risk.map((s) => s.student_id), [SOFIA, TOMAS, BENJA]);
      await getJson(`/v1/courses/${MATE}/grades/summary?threshold=9`, T.ana, 400);
    });

    test('notas de un estudiante: el docente y el propio estudiante, nadie más', async () => {
      const body = await getJson(`/v1/courses/${MATE}/students/${CAMILA}/grades`, T.ana);
      assert.equal(body.average, 5.7);
      await getJson(`/v1/courses/${MATE}/students/${CAMILA}/grades`, T.camila);
      await getJson(`/v1/courses/${MATE}/students/${CAMILA}/grades`, T.tomas, 403);
    });
  });

  describe('resultados de una evaluación', () => {
    test('solo cuentan intentos enviados', async () => {
      const body = await getJson(`/v1/assessments/${DECIMALES}/results`, T.ana);
      assert.equal(body.submissions_count, 2);
      // Tomás tiene un intento a medias: sus respuestas no entran en la tasa de acierto.
      assert.ok(body.questions.every((q) => q.answers === 2));
      assert.equal(body.questions[0].correct_rate, 0.5);
    });

    test('filtra por student_id', async () => {
      const body = await getJson(`/v1/assessments/${FRACCIONES}/results?student_id=${BENJA}`, T.ana);
      assert.equal(body.submissions_count, 4);
      assert.deepEqual(body.students.map((s) => [s.student_id, s.grade]), [[BENJA, 5.1]]);
    });
  });

  describe('PATCH /v1/assessments/:id/grading', () => {
    const patch = (tok, body) => fetch(`${url}/v1/assessments/${FRACCIONES}/grading`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    test('valida el cuerpo y el permiso', async () => {
      assert.equal((await patch(T.ana, {})).status, 400);
      assert.equal((await patch(T.ana, { pass_threshold: 120 })).status, 400);
      assert.equal((await patch(T.ana, { weight: 0 })).status, 400);
      assert.equal((await patch(T.luis, { weight: 2 })).status, 403);
    });

    test('cambiar la exigencia recalcula las notas', async () => {
      const res = await patch(T.ana, { pass_threshold: 50 });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).pass_threshold, 50);
      // Sofía: 25 % de logro -> con 60 % era 2.3, con 50 % es 2.5. Tomás: 50 % -> 4.0.
      const body = await getJson(`/v1/assessments/${FRACCIONES}/results`, T.ana);
      const notas = Object.fromEntries(body.students.map((s) => [s.student_id, s.grade]));
      assert.equal(notas[SOFIA], 2.5);
      assert.equal(notas[TOMAS], 4.0);
    });
  });
});

describe('base de datos caída', () => {
  test('las rutas de notas responden 503 y /health informa db down', async () => {
    const db = createDb({ connectionString: 'postgres://nadie@127.0.0.1:1/nada', max: 1 });
    const llm = { async *chat() {}, ping: async () => true };
    const server = createApp({ logger, llm, db, jwtSecret: SECRET }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${base}/v1/me/grades`, { headers: { authorization: `Bearer ${T.camila}` } });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).type, 'https://api.feathersforall.example/errors/db-unavailable');
      assert.equal((await (await fetch(`${base}/health`)).json()).db, 'down');
      // Kubernetes saca el pod del Service si la BD no responde (readiness), pero no lo reinicia (liveness).
      assert.equal((await fetch(`${base}/readyz`)).status, 503);
      assert.equal((await fetch(`${base}/livez`)).status, 200);
    } finally {
      server.close();
      await db.end();
    }
  });
});
