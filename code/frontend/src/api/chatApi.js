// Cliente del chat de desarrollo del backend (POST /v1/dev/chat, respuesta en streaming).

const API_URL = (import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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

  if (!res.ok) {
    // Errores RFC 7807 del backend: se usa `detail` si viene.
    const problem = await res.json().catch(() => null);
    throw new ApiError(problem?.detail ?? `Error ${res.status}`, res.status);
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
