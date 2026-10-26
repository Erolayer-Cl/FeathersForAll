// Retención de las conversaciones del Tutor IA (ADR 0008): borra las de años escolares anteriores.
//   npm run tutor:purgar                       (local, lee .env)
//   node src/jobs/purgar-conversaciones.js     (imagen de la API: CronJob k8s/cronjob-purga.yaml)
//
// Está en src/ y no en scripts/ porque la imagen de la API solo copia src/ (Dockerfile).
// Es idempotente: el CronJob la corre a diario y solo borra algo a partir del 1 de enero.
// Usa DATABASE_ADMIN_URL porque purgar_conversaciones_tutor() no se le da al usuario de la API
// (en producción, el rol feathersforall_plataforma). Ese secreto NO lo ve el Deployment de la API.
import pg from 'pg';
import { CONVERSACIONES_PURGAR } from '../../db/queries.js';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('✖ Falta DATABASE_ADMIN_URL en .env (ver .env.example)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query(CONVERSACIONES_PURGAR);
  console.log(`✔ ${rows[0].borradas} conversación(es) de años anteriores borradas`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
