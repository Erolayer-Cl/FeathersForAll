// Privacidad de lectura EN LA BASE (04_privacidad_login.sql), sin pasar por la API:
// aunque un endpoint se equivocara, la base no entrega datos de otros estudiantes.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/platform/db.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const como = (id, rol, colegioId = DEMO.colegioA) => ({ id, rol, colegioId });

describe('privacidad de lectura en la base (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;

  // Ejecuta una consulta con la sesión de un usuario (igual que la API: db.withUser).
  const leer = (user, sql, params) => db.withUser(user, async (c) => (await c.query(sql, params)).rows, { readOnly: true });

  before(async () => {
    testDb = await createTestDatabase('ffa_priv');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
  });

  after(async () => {
    await db?.end();
    await testDb?.drop();
  });

  test('una estudiante solo ve sus propios intentos, notas y matrículas', async () => {
    const camila = como(DEMO.camila, 'estudiante');
    const intentos = await leer(camila, 'SELECT DISTINCT estudiante_id FROM intentos_evaluacion');
    assert.deepEqual(intentos.map((r) => r.estudiante_id), [DEMO.camila]);
    const notas = await leer(camila, 'SELECT evaluacion, nota FROM notas ORDER BY evaluacion');
    assert.deepEqual(notas.map((r) => [r.evaluacion, r.nota]), [['Fracciones', 7], ['Números decimales', 5.1], ['Pueblos originarios', 3.5]]);
    assert.equal((await leer(camila, 'SELECT count(*)::int AS n FROM matriculas'))[0].n, 2);
    assert.equal((await leer(camila, 'SELECT count(*)::int AS n FROM respuestas_estudiante r JOIN intentos_evaluacion i ON i.id = r.intento_id WHERE i.estudiante_id <> $1', [DEMO.camila]))[0].n, 0);
  });

  test('una estudiante ve su fila y al personal, pero no a otros estudiantes', async () => {
    const filas = await leer(como(DEMO.camila, 'estudiante'), 'SELECT nombre, rol FROM usuarios ORDER BY nombre');
    assert.deepEqual(filas.map((r) => r.nombre), ['Ana Rojas', 'Camila Díaz', 'Luis Pérez', 'Marta Soto']);
  });

  test('un docente solo ve los datos de los cursos que dicta', async () => {
    const cursos = await leer(como(DEMO.luis, 'docente'), 'SELECT DISTINCT curso_id FROM intentos_evaluacion');
    assert.deepEqual(cursos.map((r) => r.curso_id), [DEMO.historia]);
  });

  test('el admin ve todo su colegio; nada de otro colegio', async () => {
    assert.equal((await leer(como(DEMO.marta, 'admin_colegio'), 'SELECT count(*)::int AS n FROM intentos_evaluacion'))[0].n, 9);
    assert.equal((await leer(como(DEMO.pedro, 'docente', DEMO.colegioB), 'SELECT count(*)::int AS n FROM intentos_evaluacion'))[0].n, 1);
  });

  test('una sesión sin rol no ve datos de estudiantes (fail-closed)', async () => {
    const sinRol = (sql) => db.withColegio(DEMO.colegioA, async (c) => (await c.query(sql)).rows[0].n, { readOnly: true });
    for (const tabla of ['intentos_evaluacion', 'notas', 'matriculas', 'usuarios']) {
      assert.equal(await sinRol(`SELECT count(*)::int AS n FROM ${tabla}`), 0, tabla);
    }
  });

  test('la API no puede leer password_hash directamente', async () => {
    await assert.rejects(
      leer(como(DEMO.marta, 'admin_colegio'), 'SELECT password_hash FROM usuarios'),
      { code: '42501' }, // permission denied
    );
  });

  test('las credenciales solo salen por credenciales_login(), y solo del colegio de la sesión', async () => {
    const enA = await db.withColegio(DEMO.colegioA, async (c) => (await c.query('SELECT id FROM credenciales_login($1)', ['camila@demo-a.cl'])).rows);
    assert.deepEqual(enA.map((r) => r.id), [DEMO.camila]);
    const enB = await db.withColegio(DEMO.colegioB, async (c) => (await c.query('SELECT id FROM credenciales_login($1)', ['camila@demo-a.cl'])).rows);
    assert.equal(enB.length, 0);
  });

  // 09_integridad_evaluaciones.sql: aunque la API se equivocara, una sesión de estudiante no se pone nota.
  describe('el estudiante no se autocalifica (09)', () => {
    const escribir = (user, fn) => db.withUser(user, fn);
    const benja = como(DEMO.benja, 'estudiante');

    test('una respuesta mala guardada como correcta queda incorrecta', async () => {
      await assert.rejects(escribir(benja, async (c) => {
        const { rows: [intento] } = await c.query(
          'INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id) VALUES ($1, $2, $3) RETURNING id',
          [DEMO.mate, DEMO.decimales, DEMO.benja],
        );
        const { rows: [r] } = await c.query(
          `INSERT INTO respuestas_estudiante (evaluacion_id, intento_id, pregunta_id, alternativa_elegida_id, es_correcta)
           SELECT p.evaluacion_id, $1, p.id, a.id, true
           FROM preguntas p JOIN alternativas a ON a.pregunta_id = p.id AND NOT a.es_correcta
           WHERE p.evaluacion_id = $2 AND p.orden = 1 LIMIT 1
           RETURNING es_correcta`,
          [intento.id, DEMO.decimales],
        );
        assert.equal(r.es_correcta, false);
        throw new Error('rollback');
      }), /rollback/);
    });

    test('enviar el intento con puntaje 100 sin responder deja 0', async () => {
      await assert.rejects(escribir(benja, async (c) => {
        const { rows: [intento] } = await c.query(
          'INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id) VALUES ($1, $2, $3) RETURNING id',
          [DEMO.mate, DEMO.decimales, DEMO.benja],
        );
        const { rows: [i] } = await c.query(
          'UPDATE intentos_evaluacion SET puntaje = 100, fecha_envio = now() WHERE id = $1 RETURNING puntaje',
          [intento.id],
        );
        assert.equal(i.puntaje, 0);
        throw new Error('rollback');
      }), /rollback/);
    });
  });
});
