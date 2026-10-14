// ÚNICO punto de contacto del portal con la IA. Si la persona que hace el backend cambia la ruta, el
// formato de la respuesta o agrega autenticación, solo hay que tocar este archivo: la pantalla del Tutor
// (pages/estudiante/TutorPage.jsx) y el estado del chat (tutor/) no cambian.
//
// Contrato actual del backend (code/backend/src/modules/tutor/tutor.routes.js):
//   POST /v1/dev/chat   { mode: 'tutor' | 'pruebas', messages: [{ role: 'user' | 'assistant', content }] }
//   → 200 text/plain en streaming (trozos de texto) · errores 4xx/5xx como RFC 7807 (`detail`)
//   GET  /health        { status: 'ok', llm: 'up' | 'down' }
// TODO(api): cuando exista POST /courses/{courseId}/tutor-questions (openapi.yaml), cambiar aquí la ruta
// y enviar el id del curso; el resto del portal sigue igual.

import { USE_MOCK_TUTOR } from '../config/devFlags.js';

const API_URL = (import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');

export class TutorApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TutorApiError';
    this.status = status;
  }
}

/**
 * Envía la conversación y entrega la respuesta del tutor en trozos de texto.
 * @param {object} params
 * @param {'tutor' | 'pruebas'} params.mode
 * @param {{role: 'user' | 'assistant', content: string}[]} params.messages
 * @param {AbortSignal} [params.signal]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {AsyncGenerator<string>}
 */
export async function* streamTutor({ mode, messages, signal, fetchImpl = fetch }) {
  if (USE_MOCK_TUTOR) {
    yield* streamMockReply({ mode, messages, signal });
    return;
  }

  const res = await fetchImpl(`${API_URL}/v1/dev/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, messages }),
    signal,
  });

  if (!res.ok) {
    const problem = await res.json().catch(() => null);
    throw new TutorApiError(problem?.detail ?? `Error ${res.status}`, res.status);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * ¿Está disponible la IA? `true` solo si el backend responde y su modelo está arriba.
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<boolean>}
 */
export async function checkTutorHealth({ signal, fetchImpl = fetch } = {}) {
  if (USE_MOCK_TUTOR) return true;
  try {
    const res = await fetchImpl(`${API_URL}/health`, { signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.llm === 'up';
  } catch {
    return false;
  }
}

const MOCK_REPLIES = {
  tutor:
    'Claro, lo vemos paso a paso.\n\nPrimero, dime qué parte te cuesta más. Mientras tanto, una idea general: **divide el problema en partes pequeñas** y resuelve una a la vez.\n\n1. Lee el enunciado y subraya los datos.\n2. Escribe qué te piden encontrar.\n3. Elige una estrategia y pruébala.\n\n(Esta es una respuesta de ejemplo: el modo demo está activo.)',
  pruebas:
    'Perfecto, empecemos con la prueba.\n\n**Pregunta 1:** ¿Cuánto es 1/2 + 1/4?\n\n(Esta es una respuesta de ejemplo: el modo demo está activo.)',
};

/** Respuesta de ejemplo en streaming (modo demo, sin backend). */
async function* streamMockReply({ mode, signal }) {
  const words = (MOCK_REPLIES[mode] ?? MOCK_REPLIES.tutor).split(/(?<=\s)/);
  for (const word of words) {
    await new Promise((resolve) => setTimeout(resolve, 35));
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    yield word;
  }
}
