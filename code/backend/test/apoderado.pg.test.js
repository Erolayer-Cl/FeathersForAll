// Panel del apoderado (MVP 5, 15_rol_apoderado.sql + 16_apoderado.sql), contra un PostgreSQL REAL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import { createLoginLimiter } from '../src/platform/login-limiter.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const A = DEMO.colegioA;
const B = DEMO.colegioB;

describe('panel del apoderado (PostgreSQL)', { skip: SKIP }, () => {
  let testDb; let db; let server; let url;
  const tok = (id, rol, colegio = A) => signJwt({ sub: id, tenant_id: colegio, role: rol }, SECRET);
  const carolina = () => tok(DEMO.carolina, 'apoderado');
  const marta = () => tok(DEMO.marta, 'admin_colegio');
  const call = (path, { token, method = 'GET', body, idem } = {}) => fetch(url + path, {
    method,
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...((idem || method === 'POST') && { 'idempotency-key': idem ?? randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  before(async () => {
    testDb = await createTestDatabase('ffa_apoderado');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, loginLimiter: createLoginLimiter({ maxFailures: 50 }) }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { server?.close(); await db?.end(); await testDb?.drop(); });

  test('la apoderada entra con su correo y su perfil dice apoderado', async () => {
    const res = await call('/v1/auth/login', { method: 'POST', body: { email: 'carolina.diaz@demo-a.cl', password: DEMO.password } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.role, 'apoderado');
    assert.equal((await call('/v1/me', { token: body.access_token })).status, 200);
  });

  test('ve el avance de Camila: ramos, promedio, notas y lo pendiente; nada de otros estudiantes', async () => {
    const res = await call('/v1/me/wards', { token: carolina() });
    assert.equal(res.status, 200);
    const { wards } = await res.json();
    assert.deepEqual(wards.map((w) => w.student_id), [DEMO.camila]);
    const mate = wards[0].courses.find((c) => c.course_id === DEMO.mate);
    assert.ok(mate, 'Camila está en Matemáticas');
    assert.ok(mate.grades.length >= 1 && mate.grades.every((g) => g.grade >= 1 && g.grade <= 7));
    assert.equal(typeof mate.average, 'number');
    assert.ok(Array.isArray(mate.pending));
    // Lo que el apoderado NO recibe: respuestas, retroalimentación, alternativas.
    assert.ok(!JSON.stringify(wards).match(/feedback|retroalimentacion|selected_option|es_correcta/));
  });

  test('el resto de la API no le muestra nada académico', async () => {
    const t = carolina();
    const cursos = await (await call('/v1/courses', { token: t })).json();
    assert.equal(cursos.data.length, 0, 'el RLS no le muestra cursos');
    assert.equal((await call(`/v1/courses/${DEMO.mate}`, { token: t })).status, 404);
    assert.equal((await call('/v1/me/grades', { token: t })).status, 403);
    assert.equal((await call(`/v1/courses/${DEMO.mate}/gradebook`, { token: t })).status, 404);
    assert.equal((await call(`/v1/courses/${DEMO.mate}/assessments`, { token: t })).status, 404);
    assert.equal((await call(`/v1/courses/${DEMO.mate}/students/${DEMO.camila}/grades`, { token: t })).status, 404);
    assert.equal((await call('/v1/users', { token: t })).status, 403);
    assert.equal((await call(`/v1/courses/${DEMO.mate}/enrollments`, { token: t, method: 'POST', body: { student_email: 'sofia@demo-a.cl' } })).status, 404);
    const crear = await call('/v1/courses', { token: t, method: 'POST', body: { name: 'Curso pirata', period: '2026-S2' } });
    assert.ok([403, 422].includes(crear.status), `crear curso: ${crear.status}`);
  });

  test('en la base: con sesión de apoderado no se leen tablas académicas ni a otros usuarios', async () => {
    const sesion = { id: DEMO.carolina, colegioId: A, rol: 'apoderado' };
    const contar = async (sql) => (await db.withUser(sesion, (c) => c.query(sql), { readOnly: true })).rows[0].n;
    for (const tabla of ['cursos', 'matriculas', 'intentos_evaluacion', 'respuestas_estudiante', 'conversaciones_tutor', 'apuntes_curso']) {
      assert.equal(await contar(`SELECT count(*)::int AS n FROM ${tabla}`), 0, tabla);
    }
    assert.equal(await contar('SELECT count(*)::int AS n FROM usuarios'), 1, 'solo su propia fila');
    // Las funciones no entregan a un estudiante que no es su pupilo.
    const ajeno = await db.withUser(sesion, (c) => c.query('SELECT * FROM notas_pupilo($1)', [DEMO.sofia]), { readOnly: true });
    assert.equal(ajeno.rows.length, 0);
    // No puede vincularse a sí misma con otro estudiante.
    await assert.rejects(
      db.withUser(sesion, (c) => c.query('INSERT INTO apoderados_estudiantes (apoderado_id, estudiante_id) VALUES ($1, $2)', [DEMO.carolina, DEMO.sofia])),
      (err) => err.code === '42501',
    );
    // Otro rol que llame a las funciones no recibe nada.
    const docente = await db.withUser({ id: DEMO.ana, colegioId: A, rol: 'docente' }, (c) => c.query('SELECT * FROM mis_pupilos()'), { readOnly: true });
    assert.equal(docente.rows.length, 0);
  });

  test('el admin vincula y desvincula pupilos; queda en la bitácora; la apoderada ve el cambio', async () => {
    const ruta = `/v1/users/${DEMO.carolina}/wards`;
    const vinc = await call(ruta, { token: marta(), method: 'POST', body: { student_email: 'Benjamin@demo-a.cl' } });
    assert.equal(vinc.status, 201);
    assert.equal((await vinc.json()).student_id, DEMO.benja);
    assert.equal((await call(ruta, { token: marta(), method: 'POST', body: { student_email: 'benjamin@demo-a.cl' } })).status, 409);
    assert.equal((await call(ruta, { token: marta(), method: 'POST', body: { student_email: 'javiera@demo-b.cl' } })).status, 404, 'otro colegio');
    assert.equal((await call(ruta, { token: marta(), method: 'POST', body: { student_email: 'ana.rojas@demo-a.cl' } })).status, 404, 'no es estudiante');
    assert.equal((await call(`/v1/users/${DEMO.ana}/wards`, { token: marta(), method: 'POST', body: { student_email: 'sofia@demo-a.cl' } })).status, 409, 'Ana no es apoderada');
    assert.equal((await call(ruta, { token: tok(DEMO.ana, 'docente'), method: 'POST', body: { student_email: 'sofia@demo-a.cl' } })).status, 403);

    const detalle = await (await call(`/v1/users/${DEMO.carolina}`, { token: marta() })).json();
    assert.deepEqual(detalle.wards.map((w) => w.student_id).sort(), [DEMO.camila, DEMO.benja].sort());
    let panel = await (await call('/v1/me/wards', { token: carolina() })).json();
    assert.equal(panel.wards.length, 2);

    assert.equal((await call(`${ruta}/${DEMO.benja}`, { token: marta(), method: 'DELETE' })).status, 204);
    assert.equal((await call(`${ruta}/${DEMO.benja}`, { token: marta(), method: 'DELETE' })).status, 404);
    panel = await (await call('/v1/me/wards', { token: carolina() })).json();
    assert.deepEqual(panel.wards.map((w) => w.student_id), [DEMO.camila]);

    const log = await (await call('/v1/audit-log', { token: marta() })).json();
    const acciones = log.data.filter((e) => e.resource_id === DEMO.carolina).map((e) => e.action);
    assert.ok(acciones.includes('apoderado.vincular') && acciones.includes('apoderado.desvincular'));
  });

  test('un pupilo desactivado deja de verse; el admin crea apoderados; otro colegio no ve nada', async () => {
    assert.equal((await call(`/v1/users/${DEMO.camila}`, { token: marta(), method: 'PATCH', body: { active: false } })).status, 200);
    assert.equal((await (await call('/v1/me/wards', { token: carolina() })).json()).wards.length, 0);
    assert.equal((await call(`/v1/users/${DEMO.camila}`, { token: marta(), method: 'PATCH', body: { active: true } })).status, 200);

    const nuevo = await call('/v1/users', { token: marta(), method: 'POST', body: { name: 'Jorge Herrera', email: 'jorge.herrera@demo-a.cl', role: 'apoderado', password: 'clave-segura-1' } });
    assert.equal(nuevo.status, 201);
    assert.equal((await nuevo.json()).role, 'apoderado');

    // Un apoderado de otro colegio con el id de Carolina en el token: no hay cuenta vigente -> 401.
    assert.equal((await call('/v1/me/wards', { token: tok(DEMO.carolina, 'apoderado', B) })).status, 401);
    // Estudiante y docente no usan el panel.
    assert.equal((await call('/v1/me/wards', { token: tok(DEMO.camila, 'estudiante') })).status, 403);
  });
});
