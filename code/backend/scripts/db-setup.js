// Crea la base de desarrollo SIN psql (alternativa a db/crear_bdd.sql).
//   npm run db:setup              → esquema (01 a 12), usuario feathersforall_app y sus permisos
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
  // 05 (conversaciones del tutor, ADR 0008): igual, si su tabla todavía no existe.
  const { rows: v5 } = await client.query("SELECT to_regclass('public.conversaciones_tutor') IS NOT NULL AS hay");
  if (v5[0].hay) console.log('· 05_conversaciones_tutor.sql ya estaba aplicado');
  else await apply('05_conversaciones_tutor.sql');
  // 06 (orden de las alternativas): se aplica si la columna todavía no existe.
  const { rows: v6 } = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alternativas' AND column_name = 'orden') AS hay");
  if (v6[0].hay) console.log('· 06_alternativas_orden.sql ya estaba aplicado');
  else await apply('06_alternativas_orden.sql');
  // 07 (índice GIN del RAG): se aplica si la columna tsv todavía no existe.
  const { rows: v7 } = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'apuntes_embeddings' AND column_name = 'tsv') AS hay");
  if (v7[0].hay) console.log('· 07_rag_indices.sql ya estaba aplicado');
  else await apply('07_rag_indices.sql');
  // 08 (login solo con correo): se aplica si su función todavía no existe.
  const { rows: v8 } = await client.query("SELECT to_regprocedure('cuentas_por_correo(citext)') IS NOT NULL AS hay");
  if (v8[0].hay) console.log('· 08_login_por_correo.sql ya estaba aplicado');
  else await apply('08_login_por_correo.sql');
  // 09 (la base corrige y pone el puntaje): se aplica si su trigger todavía no existe.
  const { rows: v9 } = await client.query("SELECT to_regproc('fijar_puntaje_intento') IS NOT NULL AS hay");
  if (v9[0].hay) console.log('· 09_integridad_evaluaciones.sql ya estaba aplicado');
  else await apply('09_integridad_evaluaciones.sql');
  // 10 (material visible y tareas con hora límite): se aplica si su tabla todavía no existe.
  const { rows: v10 } = await client.query("SELECT to_regclass('public.tareas') IS NOT NULL AS hay");
  if (v10[0].hay) console.log('· 10_material_y_tareas.sql ya estaba aplicado');
  else await apply('10_material_y_tareas.sql');
  // 11 (preguntas de respuesta escrita): se aplica si preguntas todavía no tiene la columna tipo.
  const { rows: v11 } = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'preguntas' AND column_name = 'tipo') AS hay");
  if (v11[0].hay) console.log('· 11_preguntas_texto.sql ya estaba aplicado');
  else await apply('11_preguntas_texto.sql');
  // 12 (revisión docente de respuestas escritas): se aplica si respuestas_estudiante no tiene revision_pendiente.
  const { rows: v12 } = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'respuestas_estudiante' AND column_name = 'revision_pendiente') AS hay");
  if (v12[0].hay) console.log('· 12_revision_docente.sql ya estaba aplicado');
  else await apply('12_revision_docente.sql');
  // 13 (gestión de usuarios, revocación al cambiar la clave y auditoría): si su tabla todavía no existe.
  const { rows: v13 } = await client.query("SELECT to_regclass('public.auditoria') IS NOT NULL AS hay");
  if (v13[0].hay) console.log('· 13_gestion_usuarios.sql ya estaba aplicado');
  else await apply('13_gestion_usuarios.sql');
  // 14 (correcciones de la revisión: borradores, material visible, números chilenos): si falta su función.
  const { rows: v14 } = await client.query("SELECT to_regproc('numero_chileno') IS NOT NULL AS hay");
  if (v14[0].hay) console.log('· 14_correcciones_revision.sql ya estaba aplicado');
  else await apply('14_correcciones_revision.sql');
  // 15 + 16 (panel del apoderado, MVP 5): el valor del enum va solo en 15 (no se usa en la misma transacción).
  const { rows: v15 } = await client.query("SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'rol_usuario' AND e.enumlabel = 'apoderado') AS hay");
  if (v15[0].hay) console.log('· 15_rol_apoderado.sql ya estaba aplicado');
  else await apply('15_rol_apoderado.sql');
  const { rows: v16 } = await client.query("SELECT to_regclass('public.apoderados_estudiantes') IS NOT NULL AS hay");
  if (v16[0].hay) console.log('· 16_apoderado.sql ya estaba aplicado');
  else await apply('16_apoderado.sql');
  // 17 (la respuesta correcta es secreta también en la base): si su función todavía no existe.
  const { rows: v17 } = await client.query("SELECT to_regproc('alternativas_staff') IS NOT NULL AS hay");
  if (v17[0].hay) console.log('· 17_secreto_respuestas.sql ya estaba aplicado');
  else await apply('17_secreto_respuestas.sql');

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
