// Pruebas UNITARIAS del logger y del log de requests: nada sensible llega a los logs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger, safeErr } from '../src/platform/logger.js';
import { fakeDb, startApi, tokenOf } from './fake-db.js';
import * as Q from '../db/queries.js';

/** Logger real que escribe en memoria; devuelve { logger, lineas() }. */
function memoria(level = 'debug') {
  const lineas = [];
  const destination = new Writable({ write(chunk, _e, cb) { lineas.push(JSON.parse(chunk.toString())); cb(); } });
  return { logger: createLogger({ level, destination }), lineas };
}

describe('logger: redact', () => {
  test('password, token, authorization y cookies salen como [REDACTADO], a cualquier profundidad razonable', () => {
    const { logger, lineas } = memoria();
    logger.info({ password: 'demo1234', token: 'abc', headers: { authorization: 'Bearer x', cookie: 'sid=1' }, usuario: { access_token: 'jwt', password_hash: 'scrypt$x' }, a: { b: { secret: 's' } } }, 'prueba');
    const crudo = JSON.stringify(lineas[0]);
    for (const valor of ['demo1234', '"abc"', 'Bearer x', 'sid=1', '"jwt"', 'scrypt$x', '"s"']) assert.ok(!crudo.includes(valor), valor);
    assert.match(crudo, /\[REDACTADO\]/);
  });

  test('lo que no es sensible se conserva', () => {
    const { logger, lineas } = memoria();
    logger.info({ status: 200, duration_ms: 3 }, 'request');
    assert.deepEqual([lineas[0].status, lineas[0].duration_ms, lineas[0].msg], [200, 3, 'request']);
  });
});

describe('logger: errores de la base', () => {
  test('safeErr quita los valores de filas (detail, where, parameters) y deja mensaje, código y pila', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "uq_usuarios_colegio_email"'), {
      code: '23505', detail: 'Key (colegio_id, email)=(1111, camila@demo-a.cl) already exists.', where: 'COPY usuarios', parameters: ['camila@demo-a.cl'], constraint: 'uq_usuarios_colegio_email',
    });
    const out = safeErr(err);
    assert.equal(out.code, '23505');
    assert.match(out.message, /duplicate key/);
    assert.ok(out.stack);
    assert.ok(!JSON.stringify(out).includes('camila@demo-a.cl'));
    for (const c of ['detail', 'where', 'parameters']) assert.equal(out[c], undefined, c);
  });

  test('el logger usa safeErr para el campo err', () => {
    const { logger, lineas } = memoria();
    logger.error({ err: Object.assign(new Error('fallo'), { detail: 'Key (email)=(x@y.cl)' }) }, 'Error interno');
    assert.ok(!JSON.stringify(lineas[0]).includes('x@y.cl'));
  });
});

describe('log de cada request', () => {
  test('registra el patrón de la ruta, no los ids ni los nombres de archivo; nunca el token, el cuerpo ni el query', async () => {
    const { logger, lineas } = memoria('info');
    const db = fakeDb(new Map([[Q.CURSO_DETALLE, () => []]]));
    const api = await startApi(db, { logger });
    try {
      const id = 'c0000000-0000-0000-0000-000000000001';
      const token = tokenOf({ id: 'e0000000-0000-0000-0000-000000000001', colegioId: '11111111-1111-1111-1111-111111111111', rol: 'estudiante' });
      await api.request(`/v1/courses/${id}?secreto=hola`, { token });
      await api.request('/ruta/que/no/existe', { token });
      await new Promise((r) => setTimeout(r, 50));
      const reqs = lineas.filter((l) => l.msg === 'request');
      assert.deepEqual(reqs.map((r) => r.route), ['/v1/courses/:courseId', '(sin ruta)']);
      const crudo = JSON.stringify(lineas);
      for (const valor of [id, 'secreto=hola', token, 'Bearer']) assert.ok(!crudo.includes(valor), valor);
    } finally { api.close(); }
  });
});
