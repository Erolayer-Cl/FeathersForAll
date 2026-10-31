// Base temporal para las pruebas de integración contra un PostgreSQL REAL.
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
//
// TEST_DATABASE_URL es un superusuario (con `docker compose up -d`, el del compose). Cada archivo
// de pruebas crea su propia base, aplica el esquema completo (01–05), los permisos del rol de la API
// (permisos_app.sql) y los datos demo, y la borra al terminar.
//
// La API se conecta como `feathersforall_app_test`: un rol de LOGIN que HEREDA los permisos de
// feathersforall_app (mismos GRANT, sin BYPASSRLS), así el RLS aplica igual que en producción.
// Se usa un rol aparte para no cambiar la clave de feathersforall_app: los roles son del servidor,
// no de la base, y la base de desarrollo del compose vive en el mismo servidor.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const ADMIN_URL = process.env.TEST_DATABASE_URL;
export const SKIP = !ADMIN_URL && 'sin TEST_DATABASE_URL';

const TEST_ROLE = 'feathersforall_app_test';
const TEST_PASSWORD = 'test';
const FILES = ['01_schema.sql', '02_s06_ajustes.sql', '03_notas.sql', '04_privacidad_login.sql', '05_conversaciones_tutor.sql', 'permisos_app.sql', '90_seed_demo.sql'];

const readSql = (file) => readFile(new URL(`../db/${file}`, import.meta.url), 'utf8');

/**
 * Crea la base temporal. Devuelve:
 *   appUrl      conexión del rol de pruebas (para createDb)
 *   superuser   cliente superusuario de ESA base (para preparar casos: desactivar un usuario, etc.)
 *   drop()      borra la base (llamar en `after`)
 */
export async function createTestDatabase(prefix = 'ffa_test') {
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);

  // Varios archivos de pruebas corren en paralelo (procesos distintos): sin el lock, dos
  // CREATE/ALTER ROLE simultáneos fallan con "tuple concurrently updated".
  await admin.query(`SELECT pg_advisory_lock(hashtext('feathersforall_roles'))`);
  try {
    await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN
          CREATE ROLE feathersforall_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TEST_ROLE}') THEN
          CREATE ROLE ${TEST_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS INHERIT IN ROLE feathersforall_app PASSWORD '${TEST_PASSWORD}';
        END IF;
      END $$`);
  } finally {
    await admin.query(`SELECT pg_advisory_unlock(hashtext('feathersforall_roles'))`);
  }

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const superuser = new pg.Client({ connectionString: url.href });
  await superuser.connect();
  for (const file of FILES) await superuser.query(await readSql(file));

  const appUrl = new URL(url);
  appUrl.username = TEST_ROLE;
  appUrl.password = TEST_PASSWORD;

  return {
    appUrl: appUrl.href,
    superuser,
    async drop() {
      await superuser.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

// IDs de 90_seed_demo.sql, para que las pruebas se lean con nombres.
export const DEMO = {
  colegioA: '11111111-1111-1111-1111-111111111111',
  colegioB: '22222222-2222-2222-2222-222222222222',
  ana: 'a0000000-0000-0000-0000-000000000001',      // docente Matemáticas (A)
  luis: 'a0000000-0000-0000-0000-000000000002',     // docente Historia (A)
  marta: 'a0000000-0000-0000-0000-000000000003',    // admin colegio A
  camila: 'e0000000-0000-0000-0000-000000000001',
  benja: 'e0000000-0000-0000-0000-000000000002',
  sofia: 'e0000000-0000-0000-0000-000000000003',
  tomas: 'e0000000-0000-0000-0000-000000000004',
  pedro: 'b0000000-0000-0000-0000-000000000001',    // docente colegio B
  javiera: 'b0000000-0000-0000-0000-000000000002',  // estudiante colegio B
  mate: 'c0000000-0000-0000-0000-000000000001',
  historia: 'c0000000-0000-0000-0000-000000000002',
  mateB: 'c0000000-0000-0000-0000-0000000000b1',
  fracciones: 'd0000000-0000-0000-0000-000000000001',
  decimales: 'd0000000-0000-0000-0000-000000000002',
  password: 'demo1234',
};
