// Rutas de conversaciones del tutor (ADR 0008) SIN base de datos: el rol y la validación se
// revisan antes de tocar la base. Lo que decide la base (RLS) está en conversaciones.pg.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { signJwt } from '../src/platform/auth.js';
import { conversationTitle } from '../src/modules/tutor/conversaciones.routes.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const COLEGIO = '11111111-1111-1111-1111-111111111111';
const CURSO = 'c0000000-0000-0000-0000-000000000001';
const user = (role) => ({ sub: randomUUID(), tenant_id: COLEGIO, role });

describe('conversaciones del tutor: rol y validación (sin base)', () => {
  let server;
  let url;
  const touched = [];

  before(async () => {
    // Base falsa: cualquier consulta queda registrada. Ninguna de estas pruebas debería llegar a ella.
    const db = {
      withUser: async () => { touched.push('withUser'); throw new Error('no debería tocar la base'); },
      withSession: async () => { touched.push('withSession'); throw new Error('no debería tocar la base'); },
      query: async () => { touched.push('query'); throw new Error('no debería tocar la base'); },
      ping: async () => true,
    };
    const rag = { backend: 'postgres' };
    const llm = { chat: async function* () {}, ping: async () => true };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, rag, enableIngestApi: false }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server?.close();
    assert.deepEqual(touched, [], 'ninguna prueba debía consultar la base');
  });

  const call = (claims, method, path, body) =>
    fetch(url + path, {
      method,
      headers: { 'content-type': 'application/json', ...(claims && { authorization: `Bearer ${signJwt(claims, SECRET)}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const msgPath = (conv = randomUUID(), course = CURSO) => `/v1/courses/${course}/tutor-conversations/${conv}/messages`;

  test('docente y admin: 403 en las cuatro rutas, aunque el cuerpo o los ids sean inválidos', async () => {
    for (const role of ['docente', 'admin_colegio']) {
      const u = user(role);
      assert.equal((await call(u, 'GET', `/v1/courses/${CURSO}/tutor-conversations`)).status, 403, role);
      assert.equal((await call(u, 'GET', `/v1/tutor-conversations/${randomUUID()}`)).status, 403, role);
      assert.equal((await call(u, 'DELETE', '/v1/tutor-conversations/no-es-uuid')).status, 403, role);
      assert.equal((await call(u, 'POST', msgPath(), { content: '' })).status, 403, role);
    }
  });

  test('el 403 es RFC 7807 y explica que son privadas del estudiante', async () => {
    const res = await call(user('docente'), 'GET', `/v1/tutor-conversations/${randomUUID()}`);
    assert.equal(res.headers.get('content-type').startsWith('application/problem+json'), true);
    assert.match((await res.json()).detail, /solo de cada estudiante/);
  });

  test('estudiante: 400 con contenido vacío, demasiado largo, no texto o sin cuerpo', async () => {
    const u = user('estudiante');
    for (const body of [{ content: '   ' }, { content: 'a'.repeat(4001) }, { content: 42 }, {}]) {
      assert.equal((await call(u, 'POST', msgPath(), body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
  });

  test('estudiante: 400 con un modo que no existe', async () => {
    assert.equal((await call(user('estudiante'), 'POST', msgPath(), { content: 'hola', mode: 'libre' })).status, 400);
  });

  test('estudiante: 400 si el curso o la conversación no son UUID, o si limit está fuera de rango', async () => {
    const u = user('estudiante');
    assert.equal((await call(u, 'POST', msgPath('no-es-uuid'), { content: 'hola' })).status, 400);
    assert.equal((await call(u, 'POST', msgPath(randomUUID(), 'curso-1'), { content: 'hola' })).status, 400);
    assert.equal((await call(u, 'GET', '/v1/tutor-conversations/123')).status, 400);
    assert.equal((await call(u, 'DELETE', '/v1/tutor-conversations/123')).status, 400);
    assert.equal((await call(u, 'GET', `/v1/courses/${CURSO}/tutor-conversations?limit=0`)).status, 400);
    assert.equal((await call(u, 'GET', `/v1/courses/${CURSO}/tutor-conversations?limit=101`)).status, 400);
  });

  test('401 sin token en todas las rutas', async () => {
    assert.equal((await call(null, 'GET', `/v1/courses/${CURSO}/tutor-conversations`)).status, 401);
    assert.equal((await call(null, 'GET', `/v1/tutor-conversations/${randomUUID()}`)).status, 401);
    assert.equal((await call(null, 'DELETE', `/v1/tutor-conversations/${randomUUID()}`)).status, 401);
    assert.equal((await call(null, 'POST', msgPath(), { content: 'hola' })).status, 401);
  });
});

describe('conversaciones: sin RAG en PostgreSQL no se montan', () => {
  test('con el RAG en archivo (solo desarrollo) las rutas no existen: 404', async () => {
    const db = { withUser: async () => {}, withSession: async () => {}, query: async () => {}, ping: async () => true };
    const server = createApp({ logger: pino({ level: 'silent' }), llm: { ping: async () => true }, db, jwtSecret: SECRET, rag: { backend: 'archivo' }, enableIngestApi: false }).listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/tutor-conversations/${randomUUID()}`, {
        headers: { authorization: `Bearer ${signJwt(user('estudiante'), SECRET)}` },
      });
      assert.equal(res.status, 404);
    } finally {
      server.close();
    }
  });
});

describe('conversationTitle', () => {
  test('una línea: junta espacios y saltos de línea', () => {
    assert.equal(conversationTitle('  ¿Qué es\nuna   fracción?  '), '¿Qué es una fracción?');
  });

  test('hasta 60 caracteres; si se pasa, recorta con "…"', () => {
    assert.equal(conversationTitle('a'.repeat(60)), 'a'.repeat(60));
    const largo = conversationTitle('a'.repeat(100));
    assert.equal(largo.length, 60);
    assert.ok(largo.endsWith('…'));
  });

  test('no parte un emoji al recortar (cuenta caracteres, no unidades UTF-16)', () => {
    const titulo = conversationTitle(`${'a'.repeat(58)}😀😀😀`);
    assert.equal(Array.from(titulo).length, 60);
    assert.equal(titulo, `${'a'.repeat(58)}😀…`);
    assert.doesNotMatch(titulo, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // sin mitades de emoji sueltas
  });

  test('no deja un espacio antes de "…"', () => {
    assert.equal(conversationTitle(`${'a'.repeat(58)} bbbb`), `${'a'.repeat(58)}…`);
  });
});
