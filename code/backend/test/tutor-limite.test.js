// Tope de preguntas al tutor por usuario (D-1 del threat model), por HTTP y con un LLM simulado.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { signJwt } from '../src/platform/auth.js';
import { createRateLimiter } from '../src/platform/rate-limiter.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const COLEGIO = '11111111-1111-1111-1111-111111111111';
const tokenDe = (sub) => signJwt({ sub, tenant_id: COLEGIO, role: 'estudiante' }, SECRET);
const PREGUNTA = { messages: [{ role: 'user', content: 'hola' }] };

/** LLM que deja la respuesta a medias mientras la puerta esté cerrada (simula un LLM lento). */
function llmConPuerta() {
  let open;
  let gate = new Promise((r) => { open = r; });
  return {
    abrir: () => open(),
    cerrar: () => { gate = new Promise((r) => { open = r; }); },
    async *chat() { yield 'Ho'; await gate; yield 'la'; },
    ping: async () => true,
  };
}

async function arrancar(deps) {
  const server = createApp({ logger: pino({ level: 'silent' }), jwtSecret: SECRET, chatRequiresAuth: true, ...deps }).listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
const preguntar = (url, token, body = PREGUNTA) =>
  fetch(`${url}/v1/dev/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe('tope de preguntas al tutor: por minuto', () => {
  let ctx;
  const ana = tokenDe(randomUUID());
  const benja = tokenDe(randomUUID());

  before(async () => {
    const llm = { async *chat() { yield 'ok'; }, ping: async () => true };
    ctx = await arrancar({ llm, tutorLimiter: createRateLimiter({ limits: [{ max: 3, windowMs: 60_000 }], maxConcurrent: 0 }) });
  });
  after(() => ctx.server.close());

  test('la pregunta 4 del mismo estudiante recibe 429 RFC 7807 con Retry-After', async () => {
    for (let i = 1; i <= 3; i++) {
      const ok = await preguntar(ctx.url, ana);
      assert.equal(ok.status, 200, `pregunta ${i}`);
      await ok.text();
    }
    const res = await preguntar(ctx.url, ana);
    assert.equal(res.status, 429);
    assert.match(res.headers.get('content-type'), /application\/problem\+json/);
    const retry = Number(res.headers.get('retry-after'));
    assert.ok(retry >= 1 && retry <= 60, `Retry-After ${retry}`);
    const problem = await res.json();
    assert.equal(problem.status, 429);
    assert.match(problem.type, /\/too-many-requests$/);
    assert.match(problem.detail, /muchas preguntas/i);
    assert.ok(problem.trace_id, 'trae trace_id como el resto de los errores');
  });

  test('otro estudiante no se ve afectado por el tope de ana', async () => {
    const res = await preguntar(ctx.url, benja);
    assert.equal(res.status, 200);
    await res.text();
  });

  test('una pregunta mal formada (400) no gasta cupo', async () => {
    const carla = tokenDe(randomUUID());
    for (let i = 0; i < 10; i++) assert.equal((await preguntar(ctx.url, carla, { messages: [] })).status, 400);
    const ok = await preguntar(ctx.url, carla);
    assert.equal(ok.status, 200);
    await ok.text();
  });

  test('el cuerpo de la respuesta 429 no repite la pregunta del estudiante', async () => {
    const dani = tokenDe(randomUUID());
    for (let i = 0; i < 3; i++) await (await preguntar(ctx.url, dani)).text();
    const res = await preguntar(ctx.url, dani, { messages: [{ role: 'user', content: 'MI-DATO-PRIVADO-123' }] });
    assert.equal(res.status, 429);
    assert.doesNotMatch(await res.text(), /MI-DATO-PRIVADO-123/);
  });
});

describe('tope de preguntas al tutor: simultáneas', () => {
  let ctx;
  const llm = llmConPuerta();
  const ana = tokenDe(randomUUID());

  before(async () => {
    ctx = await arrancar({ llm, tutorLimiter: createRateLimiter({ limits: [{ max: 100, windowMs: 60_000 }], maxConcurrent: 1 }) });
  });
  after(() => { llm.abrir(); ctx.server.close(); });

  test('mientras una pregunta sigue respondiendo, la siguiente da 429; al terminar vuelve a aceptar', async () => {
    const primera = await preguntar(ctx.url, ana);
    assert.equal(primera.status, 200);
    const reader = primera.body.getReader();
    const { value } = await reader.read();
    assert.equal(new TextDecoder().decode(value), 'Ho');

    const segunda = await preguntar(ctx.url, ana);
    assert.equal(segunda.status, 429);
    assert.match((await segunda.json()).detail, /anterior/i);

    llm.abrir();
    while (!(await reader.read()).done); // la respuesta termina
    await new Promise((r) => setTimeout(r, 50)); // el cupo se libera en el evento "close"
    llm.abrir();
    const tercera = await preguntar(ctx.url, ana);
    assert.equal(tercera.status, 200);
    await tercera.text();
  });

  test('si el cliente corta la conexión, el cupo también se libera', async () => {
    llm.cerrar();
    const fijo = tokenDe(randomUUID());
    const a = await preguntar(ctx.url, fijo);
    const lector = a.body.getReader();
    await lector.read();
    assert.equal((await preguntar(ctx.url, fijo)).status, 429);
    await lector.cancel(); // el estudiante cierra la pestaña
    await new Promise((r) => setTimeout(r, 100));
    llm.abrir();
    const b = await preguntar(ctx.url, fijo);
    assert.equal(b.status, 200, 'tras cortar, el estudiante puede volver a preguntar');
    await b.text();
  });
});

describe('tope de preguntas al tutor: configuración', () => {
  test('tutorLimiter: null deja el tutor sin tope', async () => {
    const llm = { async *chat() { yield 'ok'; }, ping: async () => true };
    const ctx = await arrancar({ llm, tutorLimiter: null });
    try {
      const token = tokenDe(randomUUID());
      for (let i = 0; i < 25; i++) {
        const res = await preguntar(ctx.url, token);
        assert.equal(res.status, 200);
        await res.text();
      }
    } finally {
      ctx.server.close();
    }
  });

  test('por defecto (sin tutorLimiter) ya hay un tope de 10 por minuto', async () => {
    const llm = { async *chat() { yield 'ok'; }, ping: async () => true };
    const ctx = await arrancar({ llm });
    try {
      const token = tokenDe(randomUUID());
      const estados = [];
      for (let i = 0; i < 12; i++) {
        const res = await preguntar(ctx.url, token);
        estados.push(res.status);
        await res.text();
      }
      assert.deepEqual(estados, [...Array(10).fill(200), 429, 429]);
    } finally {
      ctx.server.close();
    }
  });
});
