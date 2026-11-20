// Base común para hablar con el backend: URL, token y errores RFC 7807.

/** En desarrollo vacío (Vite reenvía /v1 al backend); en producción, la URL de la API (VITE_API_URL). */
export const API_URL = (import.meta.env?.VITE_API_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  /**
   * @param {string} message  texto para mostrar (el `detail` del problema RFC 7807, si vino)
   * @param {number} status   código HTTP (0 = no hubo respuesta: red caída o servidor apagado)
   * @param {string} [type]   `type` del problema (p. ej. .../errors/invalid-credentials)
   */
  constructor(message, status, type) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
  }
}

/** Mensaje cuando no hubo respuesta (red caída o servidor apagado): ApiError con status 0. */
export const SIN_CONEXION = 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';

/** Convierte una respuesta de error (RFC 7807) en ApiError, usando `detail` si viene. */
export async function toApiError(res) {
  const problem = await res.json().catch(() => null);
  return new ApiError(problem?.detail ?? `Error ${res.status}`, res.status, problem?.type);
}

/**
 * Petición JSON al backend.
 * @param {string} path  ruta desde la raíz de la API (p. ej. '/v1/me')
 * @param {object} [opts]
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} [opts.method]
 * @param {string} [opts.token]   JWT de la sesión (Authorization: Bearer)
 * @param {string} [opts.idempotencyKey]  UUID de la operación (POST que crean recursos): repetirla no duplica nada
 * @param {unknown} [opts.body]   se envía como JSON
 * @param {AbortSignal} [opts.signal]
 * @param {typeof fetch} [opts.fetchImpl]  inyectable en las pruebas
 */
export async function requestJson(path, { method = 'GET', token, body, idempotencyKey, signal, fetchImpl = fetch } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let res;
  try {
    res = await fetchImpl(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(SIN_CONEXION, 0);
  }

  if (!res.ok) throw await toApiError(res);
  return res.status === 204 ? null : res.json();
}
