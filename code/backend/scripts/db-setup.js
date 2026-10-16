// Crea la base de desarrollo SIN psql (alternativa a db/crear_bdd.sql).
//   npm run db:setup              → esquema (01 a 04), usuario feathersforall_app y sus permisos
//   npm run db:setup -- --demo    → además los datos demo (90_seed_demo.sql), si la base está vacía
//
// Requiere en .env:
//   DATABASE_ADMIN_URL = superusuario de la base ya creada (createdb feathersforall), p. ej.
//                        postgres://postgres:CLAVE@localhost:5432/feathersforall
//   DATABASE_URL       = postgres://feathersforall_app:OTRA_CLAVE@localhost:5432/feathersforall
//                        (la clave de feathersforall_app se toma de aquí)
// Es seguro repetirlo: si el esquema ya existe no lo vuelve a aplicar. A una base creada antes de
// la etapa 1 le agrega 04_privacidad_login.sql (si falta) y vuelve a aplicar permisos_app.sql.
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
  // 04 llegó después: se aplica si su función todavía no existe.
  const { rows: v } = await client.query("SELECT to_regprocedure('puede_ver_curso(uuid)') IS NOT NULL AS hay");
  if (v[0].hay) console.log('· 04_privacidad_login.sql ya estaba aplicado');
  else await apply('04_privacidad_login.sql');

  // Usuario de la API: sin superusuario ni BYPASSRLS, o el RLS no aplica.
  await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN CREATE ROLE feathersforall_app; END IF;
    END $$`);
  // Sin NOSUPERUSER (exige ser superusuario y falla en Postgres gestionados); se verifica después.
  await client.query(`ALTER ROLE feathersforall_app LOGIN NOBYPASSRLS PASSWORD ${client.escapeLiteral(appPassword)}`);
  await client.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app' AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'feathersforall_app no puede ser superusuario ni tener BYPASSRLS: el RLS no aplicaría';
    END IF;
END $$;`);
  console.log('✔ usuario feathersforall_app (sin BYPASSRLS)');
  await apply('permisos_app.sql');

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
