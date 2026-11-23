// Base de datos falsa para las pruebas unitarias de las rutas (sin PostgreSQL).
//
// No ejecuta SQL: cada consulta de db/queries.js se responde con las filas que entrega la prueba.
// Sirve para probar lo que hace la RUTA (validación, permisos por rol, forma de la respuesta, qué
// parámetros manda a la base y con qué sesión). Lo que hace la BASE (RLS, cálculo de la nota,
// permisos por columna) lo prueban los archivos *.pg.test.js contra un PostgreSQL real.
import pino from 'pino';
import { createApp } from '../src/app.js';
import { signJwt } from '../src/platform/auth.js';

export const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';

/**
 * @param {Map<string, (params: unknown[], session: object | null) => unknown[] | {rows: unknown[], rowCount?: number}>} handlers
 *   texto de la consulta (la constante de queries.js) -> filas que responde
 * @returns db falso con `calls`: [{ text, params, session, readOnly }] en el orden en que se consultó
 */
export function fakeDb(handlers = new Map()) {
  const calls = [];
  const run = (session, readOnly) => async (text, params = []) => {
    calls.push({ text, params, session, readOnly });
    // Candado de la transacción (idempotencia, apuntes): no hay nada que responder.
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 0 };
    const handler = handlers.get(text);
    if (!handler) throw new Error(`consulta sin respuesta en la prueba: ${text.trim().split('\n')[0].slice(0, 80)}`);
    const out = await handler(params, session);
    return Array.isArray(out) ? { rows: out, rowCount: out.length } : out;
  };
  const withSession = (session, fn, { readOnly = false } = {}) => fn({ query: run(session, readOnly) });
  return {
    calls,
    handlers,
    withSession,
    withUser: (user, fn, opts) => withSession({ colegioId: user.colegioId, usuarioId: user.id, rol: user.rol }, fn, opts),
    withColegio: (colegioId, fn, opts) => withSession({ colegioId }, fn, opts),
    query: run(null, false),
    ping: async () => true,
    /** Llamadas hechas con esa consulta. */
    callsOf: (text) => calls.filter((c) => c.text === text),
  };
}

/** Levanta la API con la base falsa. Devuelve { url, close, request }. */
export async function startApi(db, opts = {}) {
  const llm = { async *chat() {}, ping: async () => true };
  const server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET, ...opts }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { token, method = 'GET', body } = {}) => fetch(url + path, {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { url, request, close: () => server.close() };
}

/** JWT de un usuario de prueba. */
export const tokenOf = ({ id, colegioId, rol }) => signJwt({ sub: id, tenant_id: colegioId, role: rol }, SECRET);
