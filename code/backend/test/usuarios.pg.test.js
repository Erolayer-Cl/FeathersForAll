// Gestión de usuarios del admin, cambio de la propia clave, revocación de sesiones y auditoría
// (v1.12, 13_gestion_usuarios.sql), contra un PostgreSQL REAL (ver test/pg-fixture.js).
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

// iat un poco en el pasado: así un cambio de clave en el mismo segundo de la prueba lo deja vencido.
const tokenDe = (id, colegio, role, { iatOffset = -5 } = {}) => {
  const iat = Math.floor(Date.now() / 1000) + iatOffset;
  return signJwt({ sub: id, tenant_id: colegio, role, iat }, SECRET);
};

describe('gestión de usuarios (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;
  let server;
  let url;
  const marta = () => tokenDe(DEMO.marta, A, 'admin_colegio');
  const ana = () => tokenDe(DEMO.ana, A, 'docente');
  const camila = () => tokenDe(DEMO.camila, A, 'estudiante');
  const pedro = () => tokenDe(DEMO.pedro, B, 'docente');

  const call = (path, { token, method = 'GET', body, idem } = {}) => fetch(url + path, {
    method,
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(idem && { 'idempotency-key': idem }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = (email, password, rbd) => call('/v1/auth/login', { method: 'POST', body: { email, password, ...(rbd && { rbd }) } });

  before(async () => {
    testDb = await createTestDatabase('ffa_usuarios');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, jwtTtlSeconds: 600, loginLimiter: createLoginLimiter({ maxFailures: 3 }) }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await db?.end();
    await testDb?.drop();
  });

  test('solo el admin lista cuentas; docente y estudiante reciben 403', async () => {
    for (const token of [ana(), camila()]) {
      const res = await call('/v1/users', { token });
      assert.equal(res.status, 403);
      assert.match(res.headers.get('content-type'), /application\/problem\+json/);
    }
    const res = await call('/v1/users', { token: marta() });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    const ids = data.map((u) => u.id);
    assert.ok(ids.includes(DEMO.ana) && ids.includes(DEMO.camila) && ids.includes(DEMO.marta));
    // Aislamiento: nadie del colegio B, y nunca el hash.
    assert.ok(!ids.includes(DEMO.pedro) && !ids.includes(DEMO.javiera));
    assert.ok(data.every((u) => !('password_hash' in u) && !('password' in u)));
  });

  test('filtros por rol, estado y búsqueda (los comodines de LIKE no se interpretan)', async () => {
    const docentes = await (await call('/v1/users?role=docente', { token: marta() })).json();
    assert.ok(docentes.data.length >= 2 && docentes.data.every((u) => u.role === 'docente'));
    const ana2 = await (await call('/v1/users?q=ROJAS', { token: marta() })).json();
    assert.deepEqual(ana2.data.map((u) => u.id), [DEMO.ana]);
    const comodin = await (await call('/v1/users?q=%25', { token: marta() })).json();
    assert.equal(comodin.data.length, 0);
    assert.equal((await call('/v1/users?role=master', { token: marta() })).status, 400);
    assert.equal((await call('/v1/users?active=si', { token: marta() })).status, 400);
  });

  test('paginación por cursor sin repetir ni saltar cuentas', async () => {
    const vistos = [];
    let cursor = null;
    do {
      const res = await call(`/v1/users?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { token: marta() });
      const body = await res.json();
      vistos.push(...body.data.map((u) => u.id));
      cursor = body.next_cursor;
    } while (cursor);
    const todos = (await (await call('/v1/users?limit=100', { token: marta() })).json()).data.map((u) => u.id);
    assert.deepEqual(vistos, todos);
    assert.equal(new Set(vistos).size, vistos.length);
  });

  test('crear docente: 201, idempotente, entra con su clave y queda en la auditoría', async () => {
    const idem = randomUUID();
    const body = { name: 'Rosa Vidal', email: 'Rosa.Vidal@demo-a.cl', role: 'docente', password: 'clave-segura-1' };
    const res = await call('/v1/users', { token: marta(), method: 'POST', body, idem });
    assert.equal(res.status, 201);
    const creada = await res.json();
    assert.equal(creada.email, 'rosa.vidal@demo-a.cl');
    assert.equal(creada.role, 'docente');
    assert.equal(creada.active, true);
    assert.ok(!JSON.stringify(creada).includes('clave-segura-1'));

    const repetida = await call('/v1/users', { token: marta(), method: 'POST', body, idem });
    assert.equal(repetida.status, 201);
    assert.equal(repetida.headers.get('idempotent-replayed'), 'true');
    assert.equal((await repetida.json()).id, creada.id);

    const entra = await login('rosa.vidal@demo-a.cl', 'clave-segura-1');
    assert.equal(entra.status, 200);
    assert.equal((await entra.json()).user.role, 'docente');

    // La clave no queda guardada en la tabla de idempotencia ni en la auditoría.
    const { rows } = await testDb.superuser.query(
      "SELECT (SELECT count(*) FROM claves_idempotencia WHERE respuesta::text LIKE '%clave-segura%')::int AS idem, (SELECT count(*) FROM auditoria WHERE detalle::text LIKE '%clave-segura%')::int AS aud");
    assert.deepEqual(rows[0], { idem: 0, aud: 0 });

    const log = await (await call('/v1/audit-log', { token: marta() })).json();
    const entrada = log.data.find((e) => e.resource_id === creada.id && e.action === 'usuario.crear');
    assert.ok(entrada);
    assert.equal(entrada.actor.id, DEMO.marta);
    assert.deepEqual(entrada.details, { rol: 'docente' });
  });

  test('crear: correo repetido 409, clave corta o igual al correo 400, docente 403', async () => {
    const dup = await call('/v1/users', { token: marta(), method: 'POST', idem: randomUUID(), body: { name: 'Otra Ana', email: 'ana.rojas@demo-a.cl', role: 'docente', password: 'clave-segura-1' } });
    assert.equal(dup.status, 409);
    const corta = await call('/v1/users', { token: marta(), method: 'POST', idem: randomUUID(), body: { name: 'Corta Clave', email: 'corta@demo-a.cl', role: 'estudiante', password: '1234' } });
    assert.equal(corta.status, 400);
    const igual = await call('/v1/users', { token: marta(), method: 'POST', idem: randomUUID(), body: { name: 'Igual Clave', email: 'igualclave@demo-a.cl', role: 'estudiante', password: 'igualclave@demo-a.cl' } });
    assert.equal(igual.status, 400);
    const master = await call('/v1/users', { token: marta(), method: 'POST', idem: randomUUID(), body: { name: 'Super Usuario', email: 'super@demo-a.cl', role: 'master', password: 'clave-segura-1' } });
    assert.equal(master.status, 400);
    const docente = await call('/v1/users', { token: ana(), method: 'POST', idem: randomUUID(), body: { name: 'Intruso Doc', email: 'intruso@demo-a.cl', role: 'estudiante', password: 'clave-segura-1' } });
    assert.equal(docente.status, 403);
  });

  test('el mismo correo puede existir en otro colegio (no choca con el de B)', async () => {
    const res = await call('/v1/users', { token: marta(), method: 'POST', idem: randomUUID(), body: { name: 'Pedro Lagos A', email: 'pedro.lagos@demo-b.cl', role: 'estudiante', password: 'clave-segura-1' } });
    assert.equal(res.status, 201);
  });

  test('detalle con cursos; otro colegio o id inexistente 404', async () => {
    const res = await call(`/v1/users/${DEMO.ana}`, { token: marta() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.courses.some((c) => c.id === DEMO.mate && c.relation === 'teacher'));
    const est = await (await call(`/v1/users/${DEMO.camila}`, { token: marta() })).json();
    assert.ok(est.courses.every((c) => c.relation === 'student') && est.courses.length > 0);
    assert.equal((await call(`/v1/users/${DEMO.pedro}`, { token: marta() })).status, 404);
    assert.equal((await call(`/v1/users/${randomUUID()}`, { token: marta() })).status, 404);
    assert.equal((await call('/v1/users/no-es-uuid', { token: marta() })).status, 400);
  });

  test('desactivar corta la sesión abierta y el login; reactivar la devuelve', async () => {
    const tokenTomas = tokenDe(DEMO.tomas, A, 'estudiante');
    assert.equal((await call('/v1/me/grades', { token: tokenTomas })).status, 200);

    const off = await call(`/v1/users/${DEMO.tomas}`, { token: marta(), method: 'PATCH', body: { active: false } });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).active, false);
    assert.equal((await call('/v1/me/grades', { token: tokenTomas })).status, 401);
    assert.equal((await login('tomas@demo-a.cl', DEMO.password)).status, 401);

    const on = await call(`/v1/users/${DEMO.tomas}`, { token: marta(), method: 'PATCH', body: { active: true } });
    assert.equal(on.status, 200);
    assert.equal((await login('tomas@demo-a.cl', DEMO.password)).status, 200);

    const log = await (await call('/v1/audit-log?limit=100', { token: marta() })).json();
    const acciones = log.data.filter((e) => e.resource_id === DEMO.tomas).map((e) => e.action);
    assert.deepEqual(acciones.slice(0, 2), ['usuario.reactivar', 'usuario.desactivar']);
  });

  test('editar: el rol no se cambia, el admin no se desactiva a sí mismo, otro colegio 404', async () => {
    assert.equal((await call(`/v1/users/${DEMO.ana}`, { token: marta(), method: 'PATCH', body: { role: 'admin_colegio' } })).status, 400);
    assert.equal((await call(`/v1/users/${DEMO.marta}`, { token: marta(), method: 'PATCH', body: { active: false } })).status, 409);
    assert.equal((await call(`/v1/users/${DEMO.pedro}`, { token: marta(), method: 'PATCH', body: { active: false } })).status, 404);
    assert.equal((await call(`/v1/users/${DEMO.ana}`, { token: ana(), method: 'PATCH', body: { name: 'Ana Admin' } })).status, 403);
    const res = await call(`/v1/users/${DEMO.luis}`, { token: marta(), method: 'PATCH', body: { name: 'Luis Pérez Soto' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).name, 'Luis Pérez Soto');
    // Correo ya usado por otra cuenta del colegio: 409.
    assert.equal((await call(`/v1/users/${DEMO.luis}`, { token: marta(), method: 'PATCH', body: { email: 'ana.rojas@demo-a.cl' } })).status, 409);
  });

  test('la base impide cambiar el rol aunque la API lo intentara (trigger de 13)', async () => {
    await assert.rejects(
      db.withUser({ id: DEMO.marta, colegioId: A, rol: 'admin_colegio' }, (c) => c.query("UPDATE usuarios SET rol = 'admin_colegio' WHERE id = $1", [DEMO.ana])),
      (err) => err.code === '42501',
    );
  });

  test('la API no puede editar ni borrar la auditoría', async () => {
    await assert.rejects(
      db.withUser({ id: DEMO.marta, colegioId: A, rol: 'admin_colegio' }, (c) => c.query('DELETE FROM auditoria')),
      (err) => err.code === '42501',
    );
    // El docente no la lee (RLS: 0 filas) y por la API recibe 403.
    const filas = await db.withUser({ id: DEMO.ana, colegioId: A, rol: 'docente' }, (c) => c.query('SELECT count(*)::int AS n FROM auditoria'));
    assert.equal(filas.rows[0].n, 0);
    assert.equal((await call('/v1/audit-log', { token: ana() })).status, 403);
    assert.equal((await call('/v1/audit-log', { token: pedro() })).status, 403);
  });

  test('restablecer clave: corta las sesiones de la cuenta y entra con la nueva', async () => {
    const tokenBenja = tokenDe(DEMO.benja, A, 'estudiante');
    assert.equal((await call('/v1/me', { token: tokenBenja })).status, 200);
    const res = await call(`/v1/users/${DEMO.benja}/password`, { token: marta(), method: 'PUT', body: { password: 'nueva-clave-benja' } });
    assert.equal(res.status, 204);
    assert.equal((await call('/v1/me', { token: tokenBenja })).status, 401);
    assert.equal((await login('benjamin@demo-a.cl', DEMO.password)).status, 401);
    const nuevo = await login('benjamin@demo-a.cl', 'nueva-clave-benja');
    assert.equal(nuevo.status, 200);
    const { access_token } = await nuevo.json();
    assert.equal((await call('/v1/me', { token: access_token })).status, 200);

    assert.equal((await call(`/v1/users/${DEMO.marta}/password`, { token: marta(), method: 'PUT', body: { password: 'otra-clave-123' } })).status, 409);
    assert.equal((await call(`/v1/users/${DEMO.pedro}/password`, { token: marta(), method: 'PUT', body: { password: 'otra-clave-123' } })).status, 404);
    assert.equal((await call(`/v1/users/${DEMO.camila}/password`, { token: ana(), method: 'PUT', body: { password: 'otra-clave-123' } })).status, 403);
  });

  test('cambiar mi clave: pide la actual, entrega token nuevo y deja vencido el anterior', async () => {
    const viejo = tokenDe(DEMO.sofia, A, 'estudiante');
    const mala = await call('/v1/me/password', { token: viejo, method: 'POST', body: { current_password: 'no-es', new_password: 'sofia-nueva-1' } });
    assert.equal(mala.status, 422);
    const igual = await call('/v1/me/password', { token: viejo, method: 'POST', body: { current_password: DEMO.password, new_password: DEMO.password } });
    assert.equal(igual.status, 400);

    const ok = await call('/v1/me/password', { token: viejo, method: 'POST', body: { current_password: DEMO.password, new_password: 'sofia-nueva-1' } });
    assert.equal(ok.status, 200);
    const { access_token } = await ok.json();
    assert.equal((await call('/v1/me', { token: viejo })).status, 401);
    assert.equal((await call('/v1/me', { token: access_token })).status, 200);
    assert.equal((await login('sofia@demo-a.cl', 'sofia-nueva-1')).status, 200);
    assert.equal((await login('sofia@demo-a.cl', DEMO.password)).status, 401);
  });

  test('cambiar mi clave: el freno corta la adivinanza de la clave actual (429)', async () => {
    const token = tokenDe(DEMO.luis, A, 'docente');
    for (let i = 0; i < 3; i++) {
      assert.equal((await call('/v1/me/password', { token, method: 'POST', body: { current_password: `mala-${i}`, new_password: 'luis-nueva-123' } })).status, 422);
    }
    const frenado = await call('/v1/me/password', { token, method: 'POST', body: { current_password: DEMO.password, new_password: 'luis-nueva-123' } });
    assert.equal(frenado.status, 429);
    assert.ok(Number(frenado.headers.get('retry-after')) > 0);
  });

  test('la función de cambio de clave solo toca la cuenta de la sesión', async () => {
    // Sin usuario en la sesión, falla cerrado.
    await assert.rejects(
      db.withColegio(A, (c) => c.query("SELECT cambiar_mi_clave('scrypt$x')")),
      (err) => err.code === '42501',
    );
    await assert.rejects(
      db.withUser({ id: DEMO.camila, colegioId: A, rol: 'estudiante' }, (c) => c.query("SELECT cambiar_mi_clave('texto-plano')")),
      (err) => err.code === '22023',
    );
  });
});
