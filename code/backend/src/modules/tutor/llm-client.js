// Única pieza del sistema que conoce al proveedor LLM (hoy Ollama local).
// Cambiar de proveedor = reemplazar este archivo y las variables LLM_* (12-Factor 3 y 4).

export class LlmUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}

/**
 * @typedef {{load_ms: number, prompt_tokens: number, prompt_ms: number, eval_tokens: number, eval_ms: number}} LlmStats
 *   load_ms: carga del modelo (~0 si ya estaba en memoria) · prompt_tokens: largo total del prompt ·
 *   prompt_ms: tiempo en procesarlo (bajo si Ollama reutilizó el prefijo en caché) · eval_*: tokens generados.
 */

const ms = (ns) => (typeof ns === 'number' ? Math.round(ns / 1e6) : null);

/** Métricas del último mensaje de Ollama (`done: true`); los tiempos vienen en nanosegundos. */
export function toStats(data) {
  return {
    load_ms: ms(data.load_duration),
    prompt_tokens: data.prompt_eval_count ?? null,
    prompt_ms: ms(data.prompt_eval_duration),
    eval_tokens: data.eval_count ?? null,
    eval_ms: ms(data.eval_duration),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.endpoint  URL base de Ollama, p. ej. http://localhost:11434
 * @param {string} opts.model     Modelo, p. ej. qwen2.5:3b
 * @param {number} opts.timeoutMs Máximo de espera sin recibir datos (se reinicia con cada fragmento)
 * @param {number} [opts.temperature] Creatividad del modelo (0–1); más bajo = respuestas más enfocadas
 * @param {number} [opts.numCtx]     Ventana de contexto en tokens (el RAG agrega apuntes al prompt)
 * @param {string} [opts.keepAlive]  Cuánto mantiene Ollama el modelo en memoria sin uso (p. ej. "30m"). Sin esto
 *   usa su valor por defecto (5 min) y la primera pregunta tras una pausa paga la carga del modelo (~19 s en CPU).
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createOllamaClient({ endpoint, model, timeoutMs, temperature, numCtx, keepAlive, fetchImpl = fetch }) {
  const baseUrl = endpoint.replace(/\/+$/, '');
  const hasOptions = temperature !== undefined || numCtx !== undefined;

  return {
    model,

    /**
     * Envía la conversación y entrega la respuesta como fragmentos de texto.
     * @param {{role: string, content: string}[]} messages
     * @param {{signal?: AbortSignal, onStats?: (stats: LlmStats) => void}} [options]
     *   `onStats` recibe las métricas de Ollama al terminar (solo números, nunca el texto).
     * @returns {AsyncGenerator<string>}
     */
    async *chat(messages, { signal, onStats } = {}) {
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
              ...(keepAlive !== undefined && { keep_alive: keepAlive }),
              ...(hasOptions && { options: { ...(temperature !== undefined && { temperature }), ...(numCtx !== undefined && { num_ctx: numCtx }) } }),
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
              if (data.done) {
                onStats?.(toStats(data));
                return;
              }
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
