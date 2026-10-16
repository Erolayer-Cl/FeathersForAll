// Cliente del chat de desarrollo del backend (POST /v1/dev/chat, respuesta en streaming).
import { API_URL, ApiError, toApiError } from './http.js';

export { ApiError };

/**
 * Envía la conversación y entrega la respuesta del tutor en fragmentos de texto.
 * @param {object} params
 * @param {'tutor' | 'pruebas'} params.mode
 * @param {{role: 'user' | 'assistant', content: string}[]} params.messages
 * @param {AbortSignal} [params.signal]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {AsyncGenerator<string>}
 */
export async function* streamChat({ mode, messages, signal, fetchImpl = fetch }) {
  const res = await fetchImpl(`${API_URL}/v1/dev/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, messages }),
    signal,
  });

  // Errores RFC 7807 del backend: se usa `detail` si viene.
  if (!res.ok) throw await toApiError(res);

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
