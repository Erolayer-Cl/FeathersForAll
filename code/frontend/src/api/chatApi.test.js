import { describe, expect, test } from 'vitest';
import { ApiError, streamChat } from './chatApi.js';

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
});
