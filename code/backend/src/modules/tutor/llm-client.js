// Única pieza del sistema que conoce al proveedor LLM (hoy Ollama local).
// Cambiar de proveedor = reemplazar este archivo y las variables LLM_* (12-Factor 3 y 4).

export class LlmUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}

/**
 * @param {object} opts
 * @param {string} opts.endpoint  URL base de Ollama, p. ej. http://localhost:11434
 * @param {string} opts.model     Modelo, p. ej. qwen2.5:3b
 * @param {number} opts.timeoutMs Máximo de espera sin recibir datos (se reinicia con cada fragmento)
 * @param {number} [opts.temperature] Creatividad del modelo (0–1); más bajo = respuestas más enfocadas
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createOllamaClient({ endpoint, model, timeoutMs, temperature, fetchImpl = fetch }) {
  const baseUrl = endpoint.replace(/\/+$/, '');

  return {
    model,

    /**
     * Envía la conversación y entrega la respuesta como fragmentos de texto.
     * @param {{role: string, content: string}[]} messages
     * @param {{signal?: AbortSignal}} [options]
     * @returns {AsyncGenerator<string>}
     */
    async *chat(messages, { signal } = {}) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });

      // Timeout por inactividad: un modelo en CPU puede tardar en cargar y
      // generar, así que se corta solo si pasa timeoutMs sin recibir nada.
      let timedOut = false;
      let timer;
      const armTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      };

      try {
        armTimer();
        let res;
        try {
          res = await fetchImpl(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              stream: true,
              ...(temperature !== undefined && { options: { temperature } }),
            }),
            signal: controller.signal,
          });
        } catch (err) {
          if (signal?.aborted) throw err;
          throw new LlmUnavailableError(
            timedOut ? 'El modelo no respondió a tiempo' : 'No se pudo conectar con el proveedor LLM',
            { cause: err },
          );
        }

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new LlmUnavailableError(`El proveedor LLM respondió ${res.status}: ${body.slice(0, 200)}`);
        }

        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for await (const chunk of res.body) {
            armTimer();
            buffer += decoder.decode(chunk, { stream: true });
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (!line) continue;
              const data = JSON.parse(line);
              if (data.error) throw new LlmUnavailableError(`Error del proveedor LLM: ${data.error}`);
              if (data.message?.content) yield data.message.content;
              if (data.done) return;
            }
          }
        } catch (err) {
          if (err instanceof LlmUnavailableError || signal?.aborted) throw err;
          throw new LlmUnavailableError(
            timedOut ? 'El modelo dejó de responder' : 'Se interrumpió la respuesta del proveedor LLM',
            { cause: err },
          );
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        controller.abort();
      }
    },

    /** true si el proveedor responde (para /health). */
    async ping() {
      try {
        const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
