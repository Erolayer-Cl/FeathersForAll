import { invalid } from './validation.js';

// Paginación por cursor (contrato S05: `cursor` + `limit` → `next_cursor`).
// Es "keyset": el cursor guarda los valores de orden de la última fila de la página, y la
// siguiente consulta sigue desde ahí. A diferencia de OFFSET, no salta ni repite filas si
// alguien agrega datos entre una página y otra. Para el cliente el cursor es opaco.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** `limit` de la query (1–100, 20 por defecto) o 400. */
export function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid(`"limit" debe ser un entero entre 1 y ${MAX_LIMIT}`);
  }
  return limit;
}

/** Valores de la última fila → cursor opaco (base64url de un arreglo JSON). */
export function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

/**
 * Cursor → valores de la última fila, o 400 si fue alterado.
 * @param {string} cursor
 * @param {(values: unknown[]) => boolean} isValid  valida la forma esperada (cantidad y tipo de cada valor)
 */
export function decodeCursor(cursor, isValid) {
  let values = null;
  try {
    values = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    // se informa abajo
  }
  if (!Array.isArray(values) || !isValid(values)) {
    throw invalid('"cursor" no es válido: usa el next_cursor de la página anterior');
  }
  return values;
}
