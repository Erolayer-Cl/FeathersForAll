-- =============================================================================
-- Crea la base de FeathersForAll completa en un solo paso (psql).
-- =============================================================================
--
--   createdb feathersforall
--   psql -d feathersforall -v app_password='una-clave' -f crear_bdd.sql            # solo esquema
--   psql -d feathersforall -v app_password='una-clave' -v demo=1 -f crear_bdd.sql  # + datos demo
--
-- Ejecutar con un superusuario (crea extensiones y el rol de la API).
-- Con Docker no hace falta: `docker compose up -d` lo ejecuta solo (db/docker-init.sh).
-- Después, en .env:
--   DATABASE_URL=postgres://feathersforall_app:una-clave@localhost:5432/feathersforall
-- =============================================================================

\set ON_ERROR_STOP 1

\if :{?app_password}
\else
    \echo 'Falta -v app_password=...  (clave del usuario feathersforall_app)'
    \quit
\endif

\ir 01_schema.sql
\ir 02_s06_ajustes.sql
\ir 03_notas.sql
\ir 04_privacidad_login.sql
\ir 05_conversaciones_tutor.sql

-- Usuario de la API: sin superusuario ni BYPASSRLS, o el RLS no aplica.
-- El rol es del servidor (no de la base): puede existir de otra base.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN
        CREATE ROLE feathersforall_app;
    END IF;
END $$;
-- Sin NOSUPERUSER: nombrarlo exige ser superusuario y falla en Postgres gestionados (Neon, Supabase).
-- Un rol nuevo ya nace sin superusuario; el bloque de abajo lo verifica.
ALTER ROLE feathersforall_app LOGIN NOBYPASSRLS PASSWORD :'app_password';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app' AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'feathersforall_app no puede ser superusuario ni tener BYPASSRLS: el RLS no aplicaría';
    END IF;
END $$;
\ir permisos_app.sql

\if :{?demo}
    \ir 90_seed_demo.sql
    \echo 'Base creada CON datos demo (ver 90_seed_demo.sql).'
\else
    \echo 'Base creada sin datos. Para datos demo: -v demo=1'
\endif
