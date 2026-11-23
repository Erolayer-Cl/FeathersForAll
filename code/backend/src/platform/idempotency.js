import { HttpProblem } from './problem.js';
import { UUID } from './validation.js';
import * as Q from '../../db/queries.js';

/**
 * Idempotency-Key de los POST que crean recursos (contrato: "el servidor guarda la respuesta por clave 24 h").
 *
 * Todo ocurre en UNA transacción: se toma un candado por clave, se busca la respuesta guardada, se ejecuta la
 * operación y se guarda su respuesta. Así dos envíos simultáneos con la misma clave no crean dos recursos (el
 * segundo espera el candado y recibe la respuesta del primero) y, si la operación falla, no queda nada guardado:
 * reintentar con la misma clave vuelve a intentar.
 *
 * Misma clave, mismo usuario y misma operación -> se repite la respuesta (cabecera `Idempotent-Replayed: true`).
 * Misma clave en otra operación u otro usuario -> 422 (la clave no se puede reutilizar).
 *
 * @param {object} p
 * @param {ReturnType<import('./db.js').createDb>} p.db
 * @param {import('express').Request} p.req    con req.user (requireAuth)
 * @param {import('express').Response} p.res
 * @param {(client: import('pg').PoolClient) => Promise<{status: number, body: object}>} p.run
 *   la operación; recibe el cliente de la transacción y devuelve el status y el cuerpo de la respuesta
 */
export async function withIdempotency({ db, req, res, run }) {
  const key = req.get('idempotency-key');
  if (!key || !UUID.test(key)) {
    throw new HttpProblem(400, 'Solicitud inválida', 'Falta la cabecera Idempotency-Key (un UUID) en esta operación', 'validation-error');
  }
  const operacion = `${req.method} ${req.route.path}`.slice(0, 120);

  const out = await db.withUser(req.user, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`idem:${req.user.colegioId}:${key}`]);
    const previa = (await client.query(Q.IDEMPOTENCIA_BUSCAR, [key])).rows[0];
    if (previa) {
      if (previa.operacion !== operacion || previa.usuario_id !== req.user.id) {
        throw new HttpProblem(422, 'Idempotency-Key reutilizada', 'Esa clave ya se usó en otra operación: genera una clave nueva (UUID) por cada operación', 'idempotency-key-reused');
      }
      return { status: previa.status_http, body: previa.respuesta, replayed: true };
    }
    const result = await run(client);
    // Se guarda lo que ve el cliente (JSON), no objetos con Date: el reintento recibe exactamente lo mismo.
    const body = JSON.parse(JSON.stringify(result.body));
    await client.query(Q.IDEMPOTENCIA_GUARDAR, [key, req.user.id, operacion, result.status, body]);
    return { status: result.status, body };
  });

  if (out.replayed) res.set('Idempotent-Replayed', 'true');
  res.status(out.status).json(out.body);
}
