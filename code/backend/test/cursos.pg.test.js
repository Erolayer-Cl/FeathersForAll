// Cursos visibles por rol ("mis asignaturas" / "clases asignadas"), contra un PostgreSQL REAL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const logger = pino({ level: 'silent' });
const tok = (sub, role, tenant = DEMO.colegioA) => signJwt({ sub, tenant_id: tenant, role }, SECRET);

const T = {
  camila: tok(DEMO.camila, 'estudiante'),
  ana: tok(DEMO.ana, 'docente'),
  luis: tok(DEMO.luis, 'docente'),
  marta: tok(DEMO.marta, 'admin_colegio'),
  javiera: tok(DEMO.javiera, 'estudiante', DEMO.colegioB),
};

describe('cursos (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;
  let server;
  let url;

  const getJson = async (path, token, status = 200) => {
    const res = await fetch(url + path, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, status, `${path} -> ${res.status}`);
    return res.json();
  };
  const nombres = (page) => page.data.map((c) => c.name);

  before(async () => {
    testDb = await createTestDatabase('ffa_cursos');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger, llm, db, jwtSecret: SECRET }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await db?.end();
    await testDb?.drop();
  });

  describe('GET /v1/courses', () => {
    test('el estudiante ve sus asignaturas, con docente y estado del tutor', async () => {
      const page = await getJson('/v1/courses', T.camila);
      assert.deepEqual(nombres(page), ['Historia 7° Básico A', 'Matemáticas 7° Básico A']);
      const mate = page.data.find((c) => c.id === DEMO.mate);
      assert.deepEqual(
        { subject: mate.subject, teacher: mate.teacher_name, period: mate.period, grade_level: mate.grade_level },
        { subject: 'Matemática', teacher: 'Ana Rojas', period: '2026-S2', grade_level: '7B' },
      );
      assert.equal(mate.tutor_available, false);
      assert.equal(mate.tutor_documents, 0);
      assert.equal('students_count' in mate, false); // el tamaño del curso es para el personal
      assert.equal(page.next_cursor, null);
    });

    test('el docente ve solo las clases que dicta, con su cantidad de estudiantes', async () => {
      const page = await getJson('/v1/courses', T.luis);
      assert.deepEqual(page.data.map((c) => [c.name, c.students_count]), [['Historia 7° Básico A', 4]]);
    });

    test('el admin ve todos los cursos de su colegio y ninguno de otro', async () => {
      assert.deepEqual(nombres(await getJson('/v1/courses', T.marta)), ['Historia 7° Básico A', 'Matemáticas 7° Básico A']);
      assert.deepEqual(nombres(await getJson('/v1/courses', T.javiera)), ['Matemáticas 7° Básico B']);
    });

    test('pagina con cursor sin repetir ni saltar cursos', async () => {
      const p1 = await getJson('/v1/courses?limit=1', T.marta);
      assert.equal(p1.data.length, 1);
      assert.ok(p1.next_cursor);
      const p2 = await getJson(`/v1/courses?limit=1&cursor=${p1.next_cursor}`, T.marta);
      assert.deepEqual([...nombres(p1), ...nombres(p2)], ['Historia 7° Básico A', 'Matemáticas 7° Básico A']);
      assert.equal(p2.next_cursor, null);
    });

    test('filtra por período y valida los parámetros', async () => {
      assert.equal((await getJson('/v1/courses?period=2026-S2', T.marta)).data.length, 2);
      assert.equal((await getJson('/v1/courses?period=2025-S1', T.marta)).data.length, 0);
      await getJson('/v1/courses?period=2026', T.marta, 400);
      await getJson('/v1/courses?limit=0', T.marta, 400);
      await getJson('/v1/courses?cursor=alterado', T.marta, 400);
    });

    test('sin token -> 401', async () => {
      assert.equal((await fetch(`${url}/v1/courses`)).status, 401);
    });
  });

  describe('GET /v1/courses/{id}', () => {
    test('200 para quien participa: estudiante matriculado, su docente y el admin', async () => {
      for (const token of [T.camila, T.ana, T.marta]) {
        assert.equal((await getJson(`/v1/courses/${DEMO.mate}`, token)).name, 'Matemáticas 7° Básico A');
      }
    });

    test('404 para quien no participa o es de otro colegio (no revela que existe)', async () => {
      await getJson(`/v1/courses/${DEMO.mate}`, T.luis, 404);      // docente de otro curso
      await getJson(`/v1/courses/${DEMO.mate}`, T.javiera, 404);   // estudiante de otro colegio
      await getJson(`/v1/courses/${DEMO.mateB}`, T.camila, 404);
      await getJson('/v1/courses/00000000-0000-0000-0000-000000000000', T.marta, 404);
    });

    test('un estudiante con la matrícula desactivada deja de ver el curso', async () => {
      await testDb.superuser.query('UPDATE matriculas SET activo = false WHERE curso_id = $1 AND estudiante_id = $2', [DEMO.mate, DEMO.camila]);
      try {
        await getJson(`/v1/courses/${DEMO.mate}`, T.camila, 404);
        assert.deepEqual(nombres(await getJson('/v1/courses', T.camila)), ['Historia 7° Básico A']);
      } finally {
        await testDb.superuser.query('UPDATE matriculas SET activo = true WHERE curso_id = $1 AND estudiante_id = $2', [DEMO.mate, DEMO.camila]);
      }
    });

    test('id que no es UUID -> 400', async () => {
      await getJson('/v1/courses/matematicas', T.camila, 400);
    });
  });
});
