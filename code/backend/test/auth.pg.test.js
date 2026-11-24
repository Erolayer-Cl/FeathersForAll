// Login por RBD + correo + contraseña y perfil propio, contra un PostgreSQL REAL (ver test/pg-fixture.js).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { verifyJwt } from '../src/platform/auth.js';
import { createLoginLimiter } from '../src/platform/login-limiter.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const logger = pino({ level: 'silent' });

describe('login y perfil (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;
  let server;
  let url;

  const login = (body) => fetch(`${url}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const camila = { rbd: '99901', email: 'camila@demo-a.cl', password: DEMO.password };

  before(async () => {
    testDb = await createTestDatabase('ffa_auth');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
    const llm = { async *chat() {}, ping: async () => true };
    // Freno pequeño para probar el 429 sin hacer muchos intentos.
    const loginLimiter = createLoginLimiter({ maxFailures: 3 });
    server = createApp({ logger, llm, db, jwtSecret: SECRET, jwtTtlSeconds: 600, loginLimiter }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await db?.end();
    await testDb?.drop();
  });

  test('login correcto: JWT con lo mínimo (sub, tenant_id, role) y el perfil', async () => {
    const res = await login(camila);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.expires_in, 600);
    assert.deepEqual(body.user, {
      id: DEMO.camila,
      name: 'Camila Díaz',
      email: 'camila@demo-a.cl',
      role: 'estudiante',
      school: { id: DEMO.colegioA, name: 'Colegio Demo A', rbd: '99901' },
    });
    const claims = verifyJwt(body.access_token, SECRET);
    assert.deepEqual(
      { sub: claims.sub, tenant_id: claims.tenant_id, role: claims.role },
      { sub: DEMO.camila, tenant_id: DEMO.colegioA, role: 'estudiante' },
    );
    assert.equal(claims.exp - claims.iat, 600);
    assert.equal(claims.name, undefined); // sin datos personales en el token
  });

  test('sin RBD: entra con correo y clave; el colegio sale de la cuenta (08_login_por_correo.sql)', async () => {
    const res = await login({ email: 'javiera@demo-b.cl', password: DEMO.password });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.school.id, DEMO.colegioB ?? body.user.school.id);
    assert.equal(body.user.school.rbd, '99902');
    assert.equal(verifyJwt(body.access_token, SECRET).tenant_id, body.user.school.id);
    // Clave mala o correo inexistente: 401
    assert.equal((await login({ email: 'nadie@demo-b.cl', password: DEMO.password })).status, 401);
  });

  test('sin RBD, el rol de la API no lee password_hash por fuera de la función', async () => {
    const r = await db.query('SELECT count(*)::int AS n FROM cuentas_por_correo($1)', ['camila@demo-a.cl']);
    assert.equal(r.rows[0].n, 1);
    await assert.rejects(db.query('SELECT password_hash FROM usuarios LIMIT 1'));
  });

  test('el correo no distingue mayúsculas', async () => {
    assert.equal((await login({ ...camila, email: '  Camila@Demo-A.CL ' })).status, 200);
  });

  test('el token del login sirve en GET /v1/me', async () => {
    const { access_token: token } = await (await login({ rbd: '99902', email: 'javiera@demo-b.cl', password: DEMO.password })).json();
    const res = await fetch(`${url}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const me = await res.json();
    assert.equal(me.name, 'Javiera Núñez');
    assert.equal(me.school.rbd, '99902');
  });

  test('cualquier fallo responde el mismo 401 (no revela qué existe)', async () => {
    const casos = [
      { ...camila, password: 'otra-clave' },                                       // clave mala
      { ...camila, rbd: '99902' },                                                 // correo de A con el RBD de B
      { ...camila, rbd: '00000' },                                                 // RBD que no existe
      { rbd: '99901', email: 'nadie@demo-a.cl', password: DEMO.password },         // correo que no existe
    ];
    const respuestas = await Promise.all(casos.map(async (c) => {
      const res = await login(c);
      return [res.status, (await res.json()).type];
    }));
    for (const r of respuestas) assert.deepEqual(r, [401, 'https://api.feathersforall.example/errors/invalid-credentials']);
  });

  test('una cuenta desactivada no entra, y su token ya emitido deja de servir en /v1/me', async () => {
    const { access_token: token } = await (await login({ rbd: '99901', email: 'benjamin@demo-a.cl', password: DEMO.password })).json();
    await testDb.superuser.query('UPDATE usuarios SET activo = false WHERE id = $1', [DEMO.benja]);
    try {
      assert.equal((await login({ rbd: '99901', email: 'benjamin@demo-a.cl', password: DEMO.password })).status, 401);
      assert.equal((await fetch(`${url}/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    } finally {
      await testDb.superuser.query('UPDATE usuarios SET activo = true WHERE id = $1', [DEMO.benja]);
    }
  });

  test('un token vigente deja de servir en TODA la API si la cuenta se desactiva o cambia de rol', async () => {
    const tokenDe = async (email) => (await (await login({ email, password: DEMO.password })).json()).access_token;
    const pedir = (token, path) => fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}` } });

    // Docente desactivada: su token de 8 h ya no abre el libro de notas.
    const luis = await tokenDe('luis.perez@demo-a.cl');
    const libro = `/v1/courses/${DEMO.historia}/gradebook`;
    assert.equal((await pedir(luis, libro)).status, 200);
    try {
      await testDb.superuser.query('UPDATE usuarios SET activo = false WHERE id = $1', [DEMO.luis]);
      const res = await pedir(luis, libro);
      assert.equal(res.status, 401);
      assert.match((await res.json()).type, /unauthorized$/);
    } finally {
      await testDb.superuser.query('UPDATE usuarios SET activo = true WHERE id = $1', [DEMO.luis]);
    }
    assert.equal((await pedir(luis, libro)).status, 200);

    // Admin pasada a docente: el token dice "admin_colegio" y ya no lo es.
    const marta = await tokenDe('marta.soto@demo-a.cl');
    try {
      await testDb.superuser.query("UPDATE usuarios SET rol = 'docente' WHERE id = $1", [DEMO.marta]);
      assert.equal((await pedir(marta, '/v1/courses')).status, 401);
    } finally {
      await testDb.superuser.query("UPDATE usuarios SET rol = 'admin_colegio' WHERE id = $1", [DEMO.marta]);
    }
  });

  test('un colegio dado de baja corta las sesiones de sus usuarios', async () => {
    const { access_token: token } = await (await login({ email: 'javiera@demo-b.cl', password: DEMO.password })).json();
    const cursos = () => fetch(`${url}/v1/courses`, { headers: { authorization: `Bearer ${token}` } });
    try {
      await testDb.superuser.query('UPDATE colegios SET activo = false WHERE id = $1', [DEMO.colegioB]);
      assert.equal((await cursos()).status, 401);
    } finally {
      await testDb.superuser.query('UPDATE colegios SET activo = true WHERE id = $1', [DEMO.colegioB]);
    }
  });

  test('cuerpo incompleto -> 400', async () => {
    for (const body of [{}, { rbd: '99901', email: 'camila@demo-a.cl' }, { ...camila, password: 123 }]) {
      assert.equal((await login(body)).status, 400);
    }
  });

  test('tras varios fallos responde 429 con Retry-After, incluso con la clave correcta', async () => {
    const tomas = { rbd: '99901', email: 'tomas@demo-a.cl', password: 'mala' };
    for (let i = 0; i < 3; i++) assert.equal((await login(tomas)).status, 401);
    const res = await login({ ...tomas, password: DEMO.password });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    // Otras cuentas no se ven afectadas (Camila ya acumuló fallos en la prueba del 401: el freno cuenta por correo).
    assert.equal((await login({ rbd: '99901', email: 'sofia@demo-a.cl', password: DEMO.password })).status, 200);
  });

  test('GET /v1/me sin token -> 401', async () => {
    assert.equal((await fetch(`${url}/v1/me`)).status, 401);
  });
});
