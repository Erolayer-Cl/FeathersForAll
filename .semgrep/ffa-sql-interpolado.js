// Casos de prueba de la regla (semgrep --test .semgrep/). No es código de la app.
import * as Q from '../code/backend/db/queries.js';

async function casos(client, courseId, email, appPassword) {
  // ruleid: ffa-sql-interpolado
  await client.query(`SELECT * FROM cursos WHERE id = '${courseId}'`);

  // ruleid: ffa-sql-interpolado
  await client.query("SELECT * FROM usuarios WHERE email = '" + email + "'");

  // ok: ffa-sql-interpolado
  await client.query('SELECT * FROM cursos WHERE id = $1', [courseId]);

  // ok: ffa-sql-interpolado
  await client.query(Q.PERFIL, [email]);

  // ok: ffa-sql-interpolado
  await client.query(`SELECT a.titulo
     FROM apuntes_curso a
     WHERE a.curso_id = $1`, [courseId]);

  // ok: ffa-sql-interpolado
  await client.query(`ALTER ROLE feathersforall_app PASSWORD ${client.escapeLiteral(appPassword)}`);
}
