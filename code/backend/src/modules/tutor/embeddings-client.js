// Cliente de embeddings (Ollama). Igual que llm-client.js, es la única pieza que
// conoce al proveedor: cambiar de proveedor = reemplazar este archivo (12-Factor 4).
import { LlmUnavailableError } from './llm-client.js';

/**
 * @param {object} opts
 * @param {string} opts.endpoint  URL base de Ollama, p. ej. http://localhost:11434
 * @param {string} opts.model     Modelo de embeddings, p. ej. bge-m3
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.keepAlive]  como en llm-client.js: cuánto queda el modelo en memoria sin uso
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createOllamaEmbedder({ endpoint, model, timeoutMs = 60000, keepAlive, fetchImpl = fetch }) {
  const baseUrl = endpoint.replace(/\/+$/, '');

  return {
    model,

    /** @param {string[]} texts @returns {Promise<number[][]>} un vector por texto, en el mismo orden */
    async embed(texts) {
      if (texts.length === 0) return [];

      let res;
      try {
        res = await fetchImpl(`${baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, input: texts, ...(keepAlive !== undefined && { keep_alive: keepAlive }) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new LlmUnavailableError('No se pudo conectar con el proveedor de embeddings', { cause: err });
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const hint = res.status === 404 ? ` (¿falta \`ollama pull ${model}\`?)` : '';
        throw new LlmUnavailableError(
          `El proveedor de embeddings respondió ${res.status}${hint}: ${body.slice(0, 200)}`,
        );
      }

      const data = await res.json().catch(() => null);
      if (!Array.isArray(data?.embeddings) || data.embeddings.length !== texts.length) {
        throw new LlmUnavailableError('Respuesta de embeddings inválida');
      }
      return data.embeddings;
    },
  };
}
