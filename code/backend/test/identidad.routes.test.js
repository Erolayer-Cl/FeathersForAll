// Pruebas UNITARIAS del login, el perfil y el JWT (sin PostgreSQL: base falsa de test/fake-db.js).
// El aislamiento por colegio y la función credenciales_login() se prueban en test/auth.pg.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../db/queries.js';
import { requireAuth, signJwt, verifyJwt } from '../src/platform/auth.js';
import { createLoginLimiter } from '../src/platform/login-limiter.js';
import { hashPassword } from '../src/platform/password.js';
import { SECRET, fakeDb, startApi, tokenOf } from './fake-db.js';

const A = '11111111-1111-1111-1111-111111111111';
const CAMILA = { id: 'e0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'estudiante' };
const PERFIL = { id: CAMILA.id, nombre: 'Camila Díaz', email: 'camila@demo-a.cl', rol: 'estudiante', colegio_id: A, colegio: 'Colegio Demo A', rbd: '99901' };
const CREDENCIALES = { rbd: '99901', email: 'camila@demo-a.cl', password: 'demo1234' };

describe('login, perfil y JWT (unitarias, sin base)', () => {
  let hash;
  before(async () => { hash = await hashPassword('demo1234'); });

  /** API con una cuenta: el RBD 99901 existe y en él vive camila@demo-a.cl con el rol indicado. */
  async function setUp({ rol = 'estudiante', limiter = createLoginLimiter() } = {}) {
    const db = fakeDb(new Map([
      [Q.COLEGIO_POR_RBD, ([rbd]) => (rbd === '99901' ? [{ colegio_id: A }] : [])],
      [Q.LOGIN, ([email]) => (email === 'camila@demo-a.cl' ? [{ id: CAMILA.id, rol, password_hash: hash }] : [])],
      [Q.PERFIL, () => [{ ...PERFIL, rol }]],
    ]));
    const api = await startApi(db, { loginLimiter: limiter, jwtTtlSeconds: 8 * 3600 });
    const login = (body) => api.request('/v1/auth/login', { method: 'POST', body });
    return { db, api, login };
  }

  describe('POST /v1/auth/login', () => {
    let ctx;
    before(async () => { ctx = await setUp(); });
    after(() => ctx.api.close());

    test('credenciales correctas: token Bearer de 8 h y el perfil del usuario', async () => {
      const res = await ctx.login(CREDENCIALES);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.token_type, 'Bearer');
      assert.equal(body.expires_in, 8 * 3600);
      assert.deepEqual(body.user, { id: CAMILA.id, name: 'Camila Díaz', email: 'camila@demo-a.cl', role: 'estudiante', school: { id: A, name: 'Colegio Demo A', rbd: '99901' } });
    });

    test('el JWT lleva lo mínimo (datos de menores): sub, tenant_id y role, sin nombre ni correo', async () => {
      const { access_token: token } = await (await ctx.login(CREDENCIALES)).json();
      const claims = verifyJwt(token, SECRET);
      assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'role', 'sub', 'tenant_id']);
      assert.deepEqual({ sub: claims.sub, tenant_id: claims.tenant_id, role: claims.role }, { sub: CAMILA.id, tenant_id: A, role: 'estudiante' });
      assert.equal(claims.exp - claims.iat, 8 * 3600);
    });

    test('el colegio sale del RBD y el correo se busca DENTRO de ese colegio, normalizado y en solo lectura', async () => {
      ctx.db.calls.length = 0;
      assert.equal((await ctx.login({ rbd: ' 99901 ', email: '  Camila@Demo-A.cl ', password: 'demo1234' })).status, 200);
      assert.deepEqual(ctx.db.callsOf(Q.COLEGIO_POR_RBD)[0].params, ['99901']);
      const buscar = ctx.db.callsOf(Q.LOGIN)[0];
      assert.deepEqual(buscar.params, ['camila@demo-a.cl']);
      assert.deepEqual(buscar.session, { colegioId: A });
      assert.equal(buscar.readOnly, true);
    });

    test('RBD inexistente, correo inexistente y clave mala dan el MISMO 401 (no se revela qué falló)', async () => {
      const cuerpos = [];
      for (const cred of [{ ...CREDENCIALES, rbd: '11111' }, { ...CREDENCIALES, email: 'nadie@demo-a.cl' }, { ...CREDENCIALES, password: 'otra-clave' }]) {
        const res = await ctx.login(cred);
        assert.equal(res.status, 401);
        assert.match(res.headers.get('content-type'), /application\/problem\+json/);
        const { trace_id: _trace, ...resto } = await res.json();
        cuerpos.push(resto);
      }
      assert.deepEqual(cuerpos[0], cuerpos[1]);
      assert.deepEqual(cuerpos[1], cuerpos[2]);
      assert.match(cuerpos[0].type, /invalid-credentials$/);
    });

    test('con un RBD inexistente no se busca la cuenta en ningún colegio', async () => {
      ctx.db.calls.length = 0;
      await ctx.login({ ...CREDENCIALES, rbd: '22222' });
      assert.equal(ctx.db.callsOf(Q.LOGIN).length, 0);
    });

    test('campos faltantes, vacíos, que no son texto o demasiado largos -> 400 sin consultar la base', async () => {
      ctx.db.calls.length = 0;
      for (const body of [{}, { rbd: '99901', email: 'a@b.cl' }, { ...CREDENCIALES, password: '   ' }, { ...CREDENCIALES, rbd: 99901 },
        { ...CREDENCIALES, email: `${'a'.repeat(150)}@b.cl` }, { ...CREDENCIALES, password: 'x'.repeat(257) }, { ...CREDENCIALES, rbd: '9'.repeat(21) }]) {
        const res = await ctx.login(body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      }
      assert.equal(ctx.db.calls.length, 0);
    });

    test('un cuerpo que no es JSON válido -> 400', async () => {
      const res = await fetch(`${ctx.api.url}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{rbd:' });
      assert.equal(res.status, 400);
    });
  });

  test('una cuenta con un rol que no entra por este login (master) -> 401 aunque la clave sea correcta', async () => {
    const ctx = await setUp({ rol: 'master' });
    try {
      assert.equal((await ctx.login(CREDENCIALES)).status, 401);
    } finally {
      ctx.api.close();
    }
  });

  describe('freno de fuerza bruta', () => {
    test('5 fallos seguidos de una cuenta -> 429 con Retry-After, sin consultar la base; otra cuenta no se frena', async () => {
      let now = 1_000_000;
      const ctx = await setUp({ limiter: createLoginLimiter({ now: () => now }) });
      try {
        const mala = { ...CREDENCIALES, password: 'mala' };
        for (let i = 0; i < 5; i++) assert.equal((await ctx.login(mala)).status, 401);
        ctx.db.calls.length = 0;
        // Ni con la clave correcta, ni cambiando mayúsculas del correo (misma cuenta).
        for (const cred of [CREDENCIALES, { ...CREDENCIALES, email: 'CAMILA@demo-a.cl' }]) {
          const res = await ctx.login(cred);
          assert.equal(res.status, 429);
          assert.ok(Number(res.headers.get('retry-after')) > 0);
        }
        assert.equal(ctx.db.calls.length, 0);
        assert.equal((await ctx.login({ ...CREDENCIALES, email: 'otra@demo-a.cl' })).status, 401);

        now += 15 * 60_000 + 1; // pasa la ventana
        assert.equal((await ctx.login(CREDENCIALES)).status, 200);
      } finally {
        ctx.api.close();
      }
    });

    test('un login correcto reinicia la cuenta de fallos', async () => {
      const ctx = await setUp();
      try {
        const mala = { ...CREDENCIALES, password: 'mala' };
        for (let i = 0; i < 4; i++) assert.equal((await ctx.login(mala)).status, 401);
        assert.equal((await ctx.login(CREDENCIALES)).status, 200);
        for (let i = 0; i < 4; i++) assert.equal((await ctx.login(mala)).status, 401);
        assert.equal((await ctx.login(CREDENCIALES)).status, 200);
      } finally {
        ctx.api.close();
      }
    });
  });

  describe('GET /v1/me', () => {
    test('perfil del usuario del token, leído con su sesión', async () => {
      const ctx = await setUp();
      try {
        const res = await ctx.api.request('/v1/me', { token: tokenOf(CAMILA) });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).school.rbd, '99901');
        const call = ctx.db.callsOf(Q.PERFIL)[0];
        assert.deepEqual(call.params, [CAMILA.id]);
        assert.deepEqual(call.session, { colegioId: A, usuarioId: CAMILA.id, rol: 'estudiante' });
      } finally {
        ctx.api.close();
      }
    });

    test('cuenta desactivada (la base ya no la devuelve) -> 401 aunque el token siga vigente', async () => {
      const ctx = await setUp();
      try {
        ctx.db.handlers.set(Q.PERFIL, () => []);
        assert.equal((await ctx.api.request('/v1/me', { token: tokenOf(CAMILA) })).status, 401);
      } finally {
        ctx.api.close();
      }
    });
  });

  describe('JWT (platform/auth.js)', () => {
    const claims = { sub: CAMILA.id, tenant_id: A, role: 'estudiante' };
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    /** Pasa el token por requireAuth y devuelve req.user, o el status del error. */
    const auth = (header) => {
      const req = { get: () => header };
      try {
        requireAuth(SECRET)(req, {}, () => {});
        return req.user;
      } catch (err) {
        return err.status;
      }
    };

    test('un token válido deja req.user = { id, colegioId, rol }', () => {
      assert.deepEqual(auth(`Bearer ${signJwt(claims, SECRET)}`), CAMILA);
    });

    test('firma de otro secreto, payload adulterado, vencido o mal formado -> rechazado', () => {
      const good = signJwt(claims, SECRET);
      const [h, , s] = good.split('.');
      assert.equal(verifyJwt(signJwt(claims, 'otro-secreto-de-mas-de-32-caracteres!!'), SECRET), null);
      assert.equal(verifyJwt(`${h}.${b64({ ...claims, role: 'admin_colegio', exp: 9_999_999_999 })}.${s}`, SECRET), null);
      assert.equal(verifyJwt(signJwt(claims, SECRET, { expiresInSec: -1 }), SECRET), null);
      assert.equal(verifyJwt('no-es-un-jwt', SECRET), null);
      assert.equal(verifyJwt(`${h}.%%%.${s}`, SECRET), null);
    });

    test('alg "none" (sin firma) y un token sin exp -> rechazados', () => {
      const payload = b64({ ...claims, exp: 9_999_999_999 });
      assert.equal(verifyJwt(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, SECRET), null);
      const [h, , ] = signJwt(claims, SECRET).split('.');
      const sinExp = `${h}.${b64(claims)}`;
      const firma = signJwt(claims, SECRET).split('.')[2];
      assert.equal(verifyJwt(`${sinExp}.${firma}`, SECRET), null);
    });

    test('requireAuth: sin cabecera, otro esquema, rol desconocido o ids que no son UUID -> 401', () => {
      assert.equal(auth(undefined), 401);
      assert.equal(auth(`Basic ${signJwt(claims, SECRET)}`), 401);
      assert.equal(auth(`Bearer ${signJwt({ ...claims, role: 'master' }, SECRET)}`), 401);
      assert.equal(auth(`Bearer ${signJwt({ ...claims, tenant_id: 'colegio-a' }, SECRET)}`), 401);
      assert.equal(auth(`Bearer ${signJwt({ ...claims, sub: "1' OR '1'='1" }, SECRET)}`), 401);
    });

    test('sin secreto configurado se rechaza todo (falla cerrado)', () => {
      const req = { get: () => `Bearer ${signJwt(claims, SECRET)}` };
      assert.throws(() => requireAuth(undefined)(req, {}, () => {}), (err) => err.status === 401);
    });
  });
});
