// streamTurn (src/modules/tutor/turn.js), sin base ni Ollama: cuándo se entrega la respuesta para
// guardarla (onAnswer). La regla de ADR 0008: pregunta y respuesta se guardan solo si la respuesta
// terminó; un turno a medias (LLM caído o cortado) no se guarda, y un error al guardar no corta al estudiante.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pino from 'pino';
import { requestContext } from '../src/platform/request-context.js';
import { problemHandler } from '../src/platform/problem.js';
import { LlmUnavailableError } from '../src/modules/tutor/llm-client.js';
import { NO_INFO_REPLY, NO_NOTES_REPLY } from '../src/modules/tutor/rag/rag-prompt.js';
import { streamTurn } from '../src/modules/tutor/turn.js';

const logger = pino({ level: 'silent' });
const HIT = { doc_id: 'fracciones.md', chunk_index: 0, text: 'El denominador indica en cuántas partes se divide el todo.', score: 0.9 };

/** RAG falso: `notes` = el curso tiene apuntes; `hits` = lo que encuentra. */
const fakeRag = ({ notes = true, hits = [HIT] } = {}) => ({
  hasCourse: async () => notes,
  retrieve: async () => ({ hits, best: hits[0]?.score ?? 0.1 }),
});

/** LLM falso: `chunks` a entregar; `failAt` = índice del fragmento donde se cae (0 = antes del primero). */
function fakeLlm({ chunks = ['El denominador ', 'indica partes [1].'], failAt = -1 } = {}) {
  const llm = {
    calls: 0,
    async *chat() {
      llm.calls++;
      for (const [i, c] of chunks.entries()) {
        if (i === failAt) throw new LlmUnavailableError('No se pudo conectar con el proveedor LLM');
        yield c;
      }
      if (failAt === chunks.length) throw new LlmUnavailableError('cortado');
    },
  };
  return llm;
}

describe('streamTurn: qué se entrega para guardar', () => {
  let server;
  let url;
  let scenario; // { rag, llm, onAnswer } de cada prueba

  before(async () => {
    const app = express();
    app.use(requestContext(logger));
    app.use(express.json());
    app.post('/turno', async (req, res) => {
      const { rag, llm, onAnswer } = scenario;
      await streamTurn({ req, res, llm, rag, tenantId: 't', courseId: 'c', mode: 'tutor', messages: [{ role: 'user', content: req.body.q }], onAnswer });
    });
    app.use(problemHandler);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());

  const ask = (q) => fetch(`${url}/turno`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) });
  const recorder = () => {
    const saved = [];
    return { saved, onAnswer: async (a) => saved.push(a) };
  };

  test('respuesta con apuntes: se entrega el texto completo, una vez, con sus fuentes', async () => {
    const { saved, onAnswer } = recorder();
    scenario = { rag: fakeRag(), llm: fakeLlm(), onAnswer };
    const res = await ask('¿Qué indica el denominador de una fracción?');
    assert.equal(await res.text(), 'El denominador indica partes [1].');
    assert.deepEqual(saved, [{ text: 'El denominador indica partes [1].', kind: 'grounded', sources: [{ doc_id: 'fracciones.md', score: 0.9 }] }]);
  });

  test('curso sin apuntes: se guarda el aviso fijo, sin llamar al LLM', async () => {
    const { saved, onAnswer } = recorder();
    const llm = fakeLlm();
    scenario = { rag: fakeRag({ notes: false }), llm, onAnswer };
    assert.equal(await (await ask('¿Qué indica el denominador?')).text(), NO_NOTES_REPLY);
    assert.equal(llm.calls, 0);
    assert.deepEqual(saved, [{ text: NO_NOTES_REPLY, kind: 'no-notes', sources: [] }]);
  });

  test('los apuntes no lo cubren: se guarda "No encuentro eso…", sin llamar al LLM', async () => {
    const { saved, onAnswer } = recorder();
    scenario = { rag: fakeRag({ hits: [] }), llm: fakeLlm(), onAnswer };
    await (await ask('¿Cuál es la capital de Francia?')).text();
    assert.deepEqual(saved.map((a) => [a.kind, a.text]), [['no-info', NO_INFO_REPLY]]);
  });

  test('charla: se guarda sin fuentes', async () => {
    const { saved, onAnswer } = recorder();
    scenario = { rag: fakeRag(), llm: fakeLlm({ chunks: ['¡Hola! ¿En qué te ayudo?'] }), onAnswer };
    await (await ask('hola')).text();
    assert.deepEqual(saved, [{ text: '¡Hola! ¿En qué te ayudo?', kind: 'chat', sources: [] }]);
  });

  test('LLM caído antes de responder: 503 RFC 7807 y no se guarda nada', async () => {
    const { saved, onAnswer } = recorder();
    scenario = { rag: fakeRag(), llm: fakeLlm({ failAt: 0 }), onAnswer };
    const res = await ask('¿Qué indica el denominador de una fracción?');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).type.endsWith('llm-unavailable'), true);
    assert.deepEqual(saved, []);
  });

  test('LLM que se corta a mitad de la respuesta: no se guarda el turno a medias', async () => {
    const { saved, onAnswer } = recorder();
    scenario = { rag: fakeRag(), llm: fakeLlm({ failAt: 1 }), onAnswer };
    const res = await ask('¿Qué indica el denominador de una fracción?');
    assert.equal(res.status, 200); // las cabeceras ya salieron con el primer fragmento
    await assert.rejects(res.text()); // la conexión se corta: el cliente lo ve como error
    assert.deepEqual(saved, []);
  });

  test('respuesta vacía del LLM: no se guarda', async () => {
    const { saved, onAnswer } = recorder();
    scenario = { rag: fakeRag(), llm: fakeLlm({ chunks: [] }), onAnswer };
    assert.equal(await (await ask('¿Qué indica el denominador de una fracción?')).text(), '');
    assert.deepEqual(saved, []);
  });

  test('si guardar falla, el estudiante igual recibe la respuesta completa', async () => {
    scenario = { rag: fakeRag(), llm: fakeLlm(), onAnswer: async () => { throw new Error('base caída'); } };
    const res = await ask('¿Qué indica el denominador de una fracción?');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'El denominador indica partes [1].');
  });
});

describe('streamTurn: la línea de log "tutor" (auditoría de tiempos)', () => {
  let server;
  let url;
  const lines = [];
  const PREGUNTA = '¿Qué indica el denominador de una fracción?';
  const RESPUESTA = ['El denominador ', 'indica partes [1].'];
  const STATS = { load_ms: 0, prompt_tokens: 594, prompt_ms: 6830, eval_tokens: 24, eval_ms: 1781 };
  let rag;

  before(async () => {
    const captura = pino({ level: 'info' }, { write: (l) => lines.push(JSON.parse(l)) });
    const llm = {
      async *chat(_messages, { onStats } = {}) {
        yield* RESPUESTA;
        onStats?.(STATS);
      },
    };
    const app = express();
    app.use(requestContext(captura));
    app.use(express.json());
    app.post('/turno', async (req, res) => {
      await streamTurn({ req, res, llm, rag, tenantId: 't', courseId: 'c', mode: 'tutor', messages: [{ role: 'user', content: req.body.q }], onAnswer: async () => {} });
    });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());

  const ask = async (q) => {
    lines.length = 0;
    const res = await fetch(`${url}/turno`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) });
    await res.text();
    await new Promise((r) => setImmediate(r));
    return lines.filter((l) => l.msg === 'tutor');
  };

  test('respuesta con apuntes: una sola línea con los tiempos de cada fase y las métricas de Ollama', async () => {
    rag = { hasCourse: async () => true, retrieve: async () => ({ hits: [HIT], best: 0.9, timings: { embed_ms: 40, search_ms: 5 } }) };
    const logs = await ask(PREGUNTA);
    assert.equal(logs.length, 1);
    const [l] = logs;
    assert.equal(l.rag, 'grounded');
    assert.equal(l.best_score, 0.9);
    assert.equal(l.embed_ms, 40);
    assert.equal(l.search_ms, 5);
    for (const k of ['has_notes_ms', 'prepare_ms', 'first_token_ms', 'save_ms', 'total_ms']) assert.equal(typeof l[k], 'number', k);
    assert.ok(l.total_ms >= l.first_token_ms && l.first_token_ms >= l.prepare_ms);
    assert.deepEqual(l.llm, STATS);
  });

  test('respuesta fija: la línea no tiene tiempos del LLM', async () => {
    rag = { hasCourse: async () => false, retrieve: async () => assert.fail('no debería buscar') };
    const [l] = await ask(PREGUNTA);
    assert.equal(l.rag, 'no-notes');
    assert.equal(l.first_token_ms, undefined);
    assert.equal(l.llm, undefined);
    assert.equal(typeof l.total_ms, 'number');
  });

  test('el log nunca incluye la pregunta ni la respuesta (datos de menores)', async () => {
    rag = { hasCourse: async () => true, retrieve: async () => ({ hits: [HIT], best: 0.9, timings: { embed_ms: 1, search_ms: 1 } }) };
    await ask(PREGUNTA);
    const todo = JSON.stringify(lines);
    assert.equal(todo.includes('denominador'), false);
    assert.equal(todo.includes('indica partes'), false);
  });
});
