// Clientes del tutor con respuesta en streaming: el chat de desarrollo (POST /v1/dev/chat, lo usa la
// app del chat, sin sesión) y las conversaciones guardadas del Tutor IA del portal (ADR 0008).
import { API_URL, ApiError, toApiError } from './http.js';

export { ApiError };

/**
 * Lee las cabeceras con que el backend describe el turno (ver tutor.routes.js).
 * @param {Headers} headers
 * @returns {{turn: string | null, sources: {doc_id: string, score: number}[]}}
 *   `turn`: grounded (respondió con apuntes) | chat (charla) | no-info | no-notes | null (sin RAG)
 */
export function readTutorMeta(headers) {
  let sources = [];
  const raw = headers.get('x-rag-sources');
  if (raw) {
    try {
      const parsed = JSON.parse(decodeURIComponent(raw));
      if (Array.isArray(parsed)) sources = parsed;
    } catch {
      // Cabecera dañada: la respuesta sirve igual, solo sin fuentes.
    }
  }
  return { turn: headers.get('x-tutor-turn'), sources };
}

/**
 * POST que responde texto en streaming: entrega la respuesta del tutor en fragmentos.
 * Errores RFC 7807 → ApiError (con `detail` si viene).
 */
async function* streamText(path, body, { token, onMeta, signal, fetchImpl = fetch }) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetchImpl(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw await toApiError(res);
  onMeta?.(readTutorMeta(res.headers));

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
 * Chat de desarrollo (POST /v1/dev/chat): el cliente envía toda la conversación y no se guarda nada.
 * @param {object} params
 * @param {'tutor' | 'pruebas'} params.mode
 * @param {{role: 'user' | 'assistant', content: string}[]} params.messages
 * @param {string} [params.courseId]  curso cuyos apuntes usa el tutor (el backend verifica que participes)
 * @param {string} [params.token]     JWT de la sesión
 * @param {(meta: ReturnType<typeof readTutorMeta>) => void} [params.onMeta]  se llama antes del primer fragmento
 * @param {AbortSignal} [params.signal]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {AsyncGenerator<string>}
 */
export function streamChat({ mode, messages, courseId, ...opts }) {
  const body = { mode, messages };
  if (courseId) body.course_id = courseId;
  return streamText('/v1/dev/chat', body, opts);
}

/**
 * Mensaje en una conversación guardada del portal (POST /v1/courses/{id}/tutor-conversations/{id}/messages).
 * Solo se envía la pregunta nueva: el historial lo tiene el servidor. Si la conversación no existe, la crea
 * con `mode`; pregunta y respuesta se guardan cuando la respuesta termina.
 * @param {object} params
 * @param {string} params.courseId
 * @param {string} params.conversationId  UUID generado por el cliente
 * @param {'tutor' | 'pruebas'} params.mode
 * @param {string} params.content
 * @param {string} params.token
 * @returns {AsyncGenerator<string>}
 */
export function streamTutorMessage({ courseId, conversationId, mode, content, ...opts }) {
  const path = `/v1/courses/${encodeURIComponent(courseId)}/tutor-conversations/${encodeURIComponent(conversationId)}/messages`;
  return streamText(path, { mode, content }, opts);
}
