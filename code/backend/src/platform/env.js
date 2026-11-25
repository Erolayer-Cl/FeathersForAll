/**
 * Lee un entero de una variable de entorno. Vacío o ausente -> `fallback`; algo que no es un entero >= 0 -> error:
 * una configuración mal escrita no debe dejar un límite apagado (o cambiado) sin avisar.
 */
export function intFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new RangeError(`${name} debe ser un entero ≥ 0 (recibí "${raw}")`);
  return Number(raw);
}
