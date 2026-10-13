-- =============================================================================
-- Crea la base de FeathersForAll completa en un solo paso (psql).
-- =============================================================================
--
--   createdb feathersforall
--   psql -d feathersforall -v app_password='una-clave' -f crear_bdd.sql            # solo esquema
--   psql -d feathersforall -v app_password='una-clave' -v demo=1 -f crear_bdd.sql  # + datos demo
--
-- Ejecutar con un superusuario (crea extensiones y el rol de la API).
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

-- Usuario de la API: sin superusuario ni BYPASSRLS, o el RLS no aplica.
-- El rol es del servidor (no de la base): puede existir de otra base.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN
        CREATE ROLE feathersforall_app;
    END IF;
END $$;
ALTER ROLE feathersforall_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_password';
GRANT USAGE ON SCHEMA public TO feathersforall_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feathersforall_app;

\if :{?demo}
    \ir 90_seed_demo.sql
    \echo 'Base creada CON datos demo (ver 90_seed_demo.sql).'
\else
    \echo 'Base creada sin datos. Para datos demo: -v demo=1'
\endif
