import pg from 'pg';

// NUMERIC llega como texto por defecto (para no perder precisión). Notas y
// puntajes tienen pocos decimales, así que se convierten a number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export class DbUnavailableError extends Error {}

/**
 * Pool de conexiones a PostgreSQL. La API se conecta con feathersforall_app
 * (sin BYPASSRLS): todo pasa por withColegio(), que fija el colegio de la
 * sesión para que el RLS filtre (ver db/CAMBIOS_SCHEMA.md).
 */
export function createDb({ connectionString, max = 10, logger }) {
  const pool = new pg.Pool({ connectionString, max });
  // Un error en una conexión ociosa no debe tumbar el proceso.
  pool.on('error', (err) => logger?.warn({ err: err.message }, 'error en conexión ociosa de PostgreSQL'));

  async function connect() {
    try {
      return await pool.connect();
    } catch (err) {
      throw new DbUnavailableError(`No se pudo conectar con la base de datos: ${err.message}`);
    }
  }

  /**
   * Ejecuta fn(client) en una transacción con la sesión del usuario fijada.
   * set_config(..., true) equivale a SET LOCAL pero acepta parámetros: los
   * valores mueren con la transacción y no contaminan la conexión del pool.
   *   app.colegio_id -> RLS por colegio (01_schema.sql)
   *   app.usuario_id, app.rol -> permisos por rol (02_s06_ajustes.sql §9)
   * Los tres deben salir del JWT verificado (req.user), nunca del cuerpo de la petición.
   */
  async function withSession({ colegioId, usuarioId = '', rol = '' }, fn, { readOnly = false } = {}) {
    const client = await connect();
    try {
      await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      await client.query(
        `SELECT set_config('app.colegio_id', $1, true),
                set_config('app.usuario_id', $2, true),
                set_config('app.rol', $3, true)`,
        [colegioId, usuarioId ?? '', rol ?? ''],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    withSession,

    /** Sesión de un usuario autenticado: req.user = { id, colegioId, rol } (ver auth.js). */
    withUser: (user, fn, opts) => withSession({ colegioId: user.colegioId, usuarioId: user.id, rol: user.rol }, fn, opts),

    /** Solo colegio (lecturas sin usuario). Escribir en tablas con permisos por rol fallará: es a propósito. */
    withColegio: (colegioId, fn, opts) => withSession({ colegioId }, fn, opts),

    async ping() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },

    end: () => pool.end(),
  };
}
