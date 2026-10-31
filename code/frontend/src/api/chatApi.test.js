import { describe, expect, test } from 'vitest';
import { ApiError, readTutorMeta, streamChat, streamTutorMessage } from './chatApi.js';

function textStream(parts) {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
      controller.close();
    },
  });
}

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

describe('streamChat', () => {
  test('envía modo y mensajes, y entrega la respuesta por fragmentos', async () => {
    let request;
    const fetchImpl = async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return new Response(textStream(['Hola', ', mundo']), { status: 200 });
    };
    const chunks = await collect(
      streamChat({ mode: 'pruebas', messages: [{ role: 'user', content: 'hola' }], fetchImpl }),
    );
    expect(chunks.join('')).toBe('Hola, mundo');
    expect(request.url).toBe('/v1/dev/chat');
    expect(request.body).toEqual({ mode: 'pruebas', messages: [{ role: 'user', content: 'hola' }] });
  });

  test('convierte un error RFC 7807 en ApiError con su detalle', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ status: 503, detail: 'No se pudo conectar con el proveedor LLM' }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json' },
      });
    const error = await collect(streamChat({ mode: 'tutor', messages: [], fetchImpl })).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, message: 'No se pudo conectar con el proveedor LLM' });
  });

  test('con sesión envía el token y el curso, y entrega las fuentes del turno', async () => {
    let request;
    const sources = [{ doc_id: 'fracciones.md', score: 0.71 }];
    const fetchImpl = async (url, init) => {
      request = { headers: init.headers, body: JSON.parse(init.body) };
      return new Response(textStream(['Una fracción…']), {
        status: 200,
        headers: { 'x-tutor-turn': 'grounded', 'x-rag-sources': encodeURIComponent(JSON.stringify(sources)) },
      });
    };
    let meta;
    const chunks = await collect(
      streamChat({
        mode: 'tutor',
        messages: [{ role: 'user', content: '¿Qué es una fracción?' }],
        courseId: 'c0000000-0000-0000-0000-000000000001',
        token: 'jwt',
        onMeta: (m) => { meta = m; },
        fetchImpl,
      }),
    );
    expect(chunks.join('')).toBe('Una fracción…');
    expect(request.headers.authorization).toBe('Bearer jwt');
    expect(request.body.course_id).toBe('c0000000-0000-0000-0000-000000000001');
    expect(meta).toEqual({ turn: 'grounded', sources });
  });
});

describe('readTutorMeta', () => {
  test('sin cabeceras de RAG: sin turno ni fuentes', () => {
    expect(readTutorMeta(new Headers())).toEqual({ turn: null, sources: [] });
  });

  test('una cabecera de fuentes dañada no rompe la respuesta', () => {
    expect(readTutorMeta(new Headers({ 'x-tutor-turn': 'grounded', 'x-rag-sources': '%E0%A4%A' }))).toEqual({
      turn: 'grounded',
      sources: [],
    });
  });
});

describe('streamTutorMessage', () => {
  test('envía solo la pregunta nueva a la conversación del curso, con el token, y lee las fuentes', async () => {
    let request;
    const fetchImpl = async (url, init) => {
      request = { url, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(textStream(['Indica ', 'cuántas partes [1].']), {
        status: 200,
        headers: { 'x-tutor-turn': 'grounded', 'x-rag-sources': encodeURIComponent(JSON.stringify([{ doc_id: 'fracciones.md', score: 0.8 }])) },
      });
    };
    let meta;
    const chunks = await collect(
      streamTutorMessage({ courseId: 'c1', conversationId: 'k1', mode: 'tutor', content: '¿Qué es?', token: 'jwt', fetchImpl, onMeta: (m) => (meta = m) }),
    );
    expect(chunks.join('')).toBe('Indica cuántas partes [1].');
    expect(request.url).toBe('/v1/courses/c1/tutor-conversations/k1/messages');
    expect(request.headers.authorization).toBe('Bearer jwt');
    expect(request.body).toEqual({ mode: 'tutor', content: '¿Qué es?' });
    expect(meta).toEqual({ turn: 'grounded', sources: [{ doc_id: 'fracciones.md', score: 0.8 }] });
  });
});
