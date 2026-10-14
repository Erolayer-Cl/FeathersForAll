// Crea la base de desarrollo SIN psql (alternativa a db/crear_bdd.sql).
//   npm run db:setup              → esquema (01 + 02 + 03) y usuario feathersforall_app
//   npm run db:setup -- --demo    → además los datos demo (90_seed_demo.sql), si la base está vacía
//
// Requiere en .env:
//   DATABASE_ADMIN_URL = superusuario de la base ya creada (createdb feathersforall), p. ej.
//                        postgres://postgres:CLAVE@localhost:5432/feathersforall
//   DATABASE_URL       = postgres://feathersforall_app:OTRA_CLAVE@localhost:5432/feathersforall
//                        (la clave de feathersforall_app se toma de aquí)
// Es seguro repetirlo: si el esquema ya existe no lo vuelve a aplicar.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) {
  console.error('✖ Faltan DATABASE_ADMIN_URL y/o DATABASE_URL en .env (ver .env.example)');
  process.exit(1);
}
const appPassword = decodeURIComponent(new URL(appUrl).password);
if (!appPassword) {
  console.error('✖ DATABASE_URL debe traer la clave de feathersforall_app');
  process.exit(1);
}

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
const client = new pg.Client({ connectionString: adminUrl });
const apply = async (file) => {
  await client.query(await readFile(join(dbDir, file), 'utf8'));
  console.log(`✔ ${file}`);
};

try {
  await client.connect();
  const { rows } = await client.query("SELECT to_regclass('public.colegios') IS NOT NULL AS hay");
  if (rows[0].hay) {
    console.log('· El esquema ya existe: se omiten 01, 02 y 03');
  } else {
    for (const f of ['01_schema.sql', '02_s06_ajustes.sql', '03_notas.sql']) await apply(f);
  }

  // Usuario de la API: sin superusuario ni BYPASSRLS, o el RLS no aplica.
  await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN CREATE ROLE feathersforall_app; END IF;
    END $$`);
  await client.query(`ALTER ROLE feathersforall_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${client.escapeLiteral(appPassword)}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO feathersforall_app;
                      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feathersforall_app`);
  console.log('✔ usuario feathersforall_app (sin BYPASSRLS)');

  if (process.argv.includes('--demo')) {
    const { rows: c } = await client.query('SELECT count(*)::int AS n FROM colegios');
    if (c[0].n > 0) console.log('· Ya hay colegios: se omiten los datos demo');
    else await apply('90_seed_demo.sql');
  }
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
