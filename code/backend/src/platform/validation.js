import { HttpProblem } from './problem.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 400 RFC 7807 por un parámetro mal formado. */
export const invalid = (detail) => new HttpProblem(400, 'Solicitud inválida', detail, 'validation-error');

/** UUID válido o 400 (si no, Postgres lanzaría 22P02 y saldría un 500). */
export function uuidParam(value, name, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`"${name}" debe ser un UUID`);
  return value;
}
