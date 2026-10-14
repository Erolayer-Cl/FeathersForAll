import { describe, expect, it } from 'vitest';
import { TutorApiError, checkTutorHealth, streamTutor } from './tutorApi.js';

const enc = new TextEncoder();
function streamResponse(parts, init = { status: 200 }) {
  const body = new ReadableStream({
    start(c) {
      parts.forEach((p) => c.enqueue(enc.encode(p)));
      c.close();
    },
  });
  return new Response(body, init);
}

async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('streamTutor', () => {
  it('envía mode y messages al endpoint del backend y entrega los trozos', async () => {
    let seen;
    const fetchImpl = async (url, opts) => {
      seen = { url, opts };
      return streamResponse(['Ho', 'la']);
    };
    const messages = [{ role: 'user', content: 'Hola' }];
    const chunks = await collect(streamTutor({ mode: 'pruebas', messages, fetchImpl }));
    expect(chunks.join('')).toBe('Hola');
    expect(seen.url).toBe('/v1/dev/chat');
    expect(seen.opts.method).toBe('POST');
    expect(JSON.parse(seen.opts.body)).toEqual({ mode: 'pruebas', messages });
  });

  it('usa el `detail` del error RFC 7807', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ detail: 'El modelo no responde' }), { status: 503, headers: { 'content-type': 'application/problem+json' } });
    const err = await collect(streamTutor({ mode: 'tutor', messages: [], fetchImpl })).catch((e) => e);
    expect(err).toBeInstanceOf(TutorApiError);
    expect(err).toMatchObject({ message: 'El modelo no responde', status: 503 });
  });
});

describe('checkTutorHealth', () => {
  const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
  it('true solo si el modelo está arriba', async () => {
    expect(await checkTutorHealth({ fetchImpl: json({ status: 'ok', llm: 'up' }) })).toBe(true);
    expect(await checkTutorHealth({ fetchImpl: json({ status: 'ok', llm: 'down' }) })).toBe(false);
    expect(await checkTutorHealth({ fetchImpl: json({}, 500) })).toBe(false);
  });
  it('false si el backend no responde', async () => {
    expect(await checkTutorHealth({ fetchImpl: async () => { throw new TypeError('fetch failed'); } })).toBe(false);
  });
});
