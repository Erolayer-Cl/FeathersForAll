import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { createVectorStore } from '../src/modules/tutor/rag/vector-store.js';
import { NO_INFO_REPLY, NO_NOTES_REPLY } from '../src/modules/tutor/rag/rag-prompt.js';
import { SYSTEM_PROMPTS } from '../src/modules/tutor/system-prompt.js';
import { fakeEmbedder } from './fake-embedder.js';

const logger = pino({ level: 'silent' });
const NOTES = 'Una fracción representa una parte de un todo.\n\nEl numerador indica cuántas partes se toman.';

function fakeLlm() {
  const calls = [];
  return {
    calls,
    async *chat(messages) {
      calls.push(messages);
      yield 'respuesta';
    },
    async ping() {
      return true;
    },
  };
}

async function startApp(opts = {}) {
  const llm = fakeLlm();
  const rag = createRagService({ embedder: fakeEmbedder(), store: createVectorStore(), minScore: 0.2 });
  const server = createApp({ logger, llm, rag, tenantId: 'colegio-a', defaultCourseId: 'mate-7', ...opts }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, llm, rag, url: `http://127.0.0.1:${server.address().port}` };
}

const json = (url, method, body) =>
  fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });

const chat = (url, content, extra = {}) =>
  json(`${url}/v1/dev/chat`, 'POST', { messages: [{ role: 'user', content }], ...extra });

describe('ingesta de apuntes', () => {
  let ctx;
  before(async () => { ctx = await startApp(); });
  after(() => ctx.server.close());

  test('POST crea el documento (201), GET lo lista y DELETE lo elimina', async () => {
    const created = await json(`${ctx.url}/v1/dev/courses/mate-7/documents`, 'POST', { name: 'fracciones.md', text: NOTES });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { doc_id: 'fracciones.md', chunks: 1 });

    const list = await (await fetch(`${ctx.url}/v1/dev/courses/mate-7/documents`)).json();
    assert.deepEqual(list.documents, [{ doc_id: 'fracciones.md', chunks: 1 }]);

    assert.equal((await fetch(`${ctx.url}/v1/dev/courses/mate-7/documents/fracciones.md`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${ctx.url}/v1/dev/courses/mate-7/documents/fracciones.md`, { method: 'DELETE' })).status, 404);
  });

  test('rechaza documentos sin nombre o sin texto (422 RFC 7807)', async () => {
    const res = await json(`${ctx.url}/v1/dev/courses/mate-7/documents`, 'POST', { name: '', text: 'algo' });
    assert.equal(res.status, 422);
    assert.match(res.headers.get('content-type'), /application\/problem\+json/);
    assert.equal((await json(`${ctx.url}/v1/dev/courses/mate-7/documents`, 'POST', { name: 'a.md', text: '  ' })).status, 422);
  });

  test('rechaza un courseId con caracteres no permitidos', async () => {
    const res = await json(`${ctx.url}/v1/dev/courses/mate%207!/documents`, 'POST', { name: 'a.md', text: 'texto' });
    assert.equal(res.status, 400);
  });

  test('admite apuntes de más de 100 kb (límite propio de la ingesta)', async () => {
    const text = 'Párrafo de relleno sobre fracciones.\n\n'.repeat(4000); // ~150 kb
    const res = await json(`${ctx.url}/v1/dev/courses/mate-7/documents`, 'POST', { name: 'grande.md', text });
    assert.equal(res.status, 201);
  });

  test('no se expone si enableIngestApi es false', async () => {
    const off = await startApp({ enableIngestApi: false });
    try {
      assert.equal((await fetch(`${off.url}/v1/dev/courses/mate-7/documents`)).status, 404);
    } finally {
      off.server.close();
    }
  });
});

describe('POST /v1/dev/chat con RAG', () => {
  let ctx;
  before(async () => {
    ctx = await startApp();
    await ctx.rag.ingest({ tenantId: 'colegio-a', courseId: 'mate-7', docId: 'fracciones.md', text: NOTES });
  });
  after(() => ctx.server.close());

  test('pregunta cubierta por los apuntes: el LLM recibe los fragmentos y se informan las fuentes', async () => {
    const res = await chat(ctx.url, '¿Qué indica el numerador?');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'respuesta');
    assert.equal(res.headers.get('x-rag-grounded'), 'true');
    const sources = JSON.parse(decodeURIComponent(res.headers.get('x-rag-sources')));
    assert.deepEqual(sources.map((s) => s.doc_id), ['fracciones.md']);

    const system = ctx.llm.calls.at(-1)[0];
    assert.equal(system.role, 'system');
    assert.ok(system.content.startsWith(SYSTEM_PROMPTS.tutor));
    assert.ok(system.content.includes('El numerador indica cuántas partes se toman'));
  });

  test('pregunta fuera del temario: responde "sin información" y NO llama al LLM', async () => {
    const before = ctx.llm.calls.length;
    const res = await chat(ctx.url, 'capital de Francia');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), NO_INFO_REPLY);
    assert.equal(res.headers.get('x-rag-grounded'), 'false');
    assert.equal(ctx.llm.calls.length, before);
  });

  test('un saludo: el tutor conversa (llama al LLM en modo charla) sin buscar apuntes', async () => {
    const res = await chat(ctx.url, 'hola pluma');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'respuesta');
    assert.equal(res.headers.get('x-tutor-turn'), 'chat');
    assert.equal(res.headers.get('x-rag-grounded'), 'false');
    assert.equal(res.headers.get('x-rag-sources'), null);
    const system = ctx.llm.calls.at(-1)[0].content;
    assert.ok(system.startsWith(SYSTEM_PROMPTS.tutor));
    assert.match(system, /solo está conversando/);
    assert.ok(!system.includes('<apuntes>'));
  });

  test('un curso sin apuntes: aviso fijo, NO llama al LLM (no inventa)', async () => {
    const before = ctx.llm.calls.length;
    const res = await chat(ctx.url, '¿Qué indica el numerador?', { course_id: 'curso-vacio' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), NO_NOTES_REPLY);
    assert.equal(res.headers.get('x-tutor-turn'), 'no-notes');
    assert.equal(ctx.llm.calls.length, before);
  });

  test('en un curso sin apuntes igual se puede saludar', async () => {
    const res = await chat(ctx.url, 'gracias!', { course_id: 'curso-vacio' });
    assert.equal(res.headers.get('x-tutor-turn'), 'chat');
    assert.equal(await res.text(), 'respuesta');
  });

  test('el cliente no puede elegir el tenant: un tenant_id en el cuerpo se ignora', async () => {
    await ctx.rag.ingest({ tenantId: 'colegio-b', courseId: 'mate-7', docId: 'secreto.md', text: 'El numerador secreto del colegio b.' });
    const res = await chat(ctx.url, '¿Qué indica el numerador?', { tenant_id: 'colegio-b' });
    const sources = JSON.parse(decodeURIComponent(res.headers.get('x-rag-sources')));
    assert.ok(sources.every((s) => s.doc_id !== 'secreto.md'));
  });

  test('el LLM no ve la pregunta fuera de tema que ya se respondió con "sin información"', async () => {
    const res = await json(`${ctx.url}/v1/dev/chat`, 'POST', {
      messages: [
        { role: 'user', content: '¿Qué indica el numerador?' },
        { role: 'assistant', content: 'Indica cuántas partes se toman. [1]' },
        { role: 'user', content: '¿Cuál es la capital de Francia?' },
        { role: 'assistant', content: NO_INFO_REPLY },
        { role: 'user', content: 'dame un ejemplo' },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-rag-grounded'), 'true');
    const sent = ctx.llm.calls.at(-1);
    assert.equal(sent[0].role, 'system');
    assert.ok(!JSON.stringify(sent.slice(1)).includes('Francia'));
    assert.equal(sent.at(-1).content, 'dame un ejemplo');
  });

  test('rechaza un course_id inválido', async () => {
    assert.equal((await chat(ctx.url, 'hola', { course_id: '../etc' })).status, 400);
  });

  test('si el servicio de embeddings falla responde 503 RFC 7807', async () => {
    const { LlmUnavailableError } = await import('../src/modules/tutor/llm-client.js');
    const broken = {
      hasCourse: () => true,
      canUseCourse: () => true,
      async retrieve() { throw new LlmUnavailableError('embeddings caídos'); },
    };
    const app = await startApp({ rag: broken });
    try {
      const res = await chat(app.url, '¿Qué indica el numerador?');
      assert.equal(res.status, 503);
      assert.match(res.headers.get('content-type'), /application\/problem\+json/);
    } finally {
      app.server.close();
    }
  });
});
