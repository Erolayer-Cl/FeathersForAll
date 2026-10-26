-- =============================================================================
-- Permisos del usuario de la API (feathersforall_app) — fuente única
-- =============================================================================
--
-- Ejecutar como superusuario DESPUÉS de crear el rol y de aplicar 01–04.
-- Se puede repetir sin problema. Lo aplican crear_bdd.sql, scripts/db-setup.js y las pruebas.
--
-- El rol debe ser NOSUPERUSER y NOBYPASSRLS (lo crean esos mismos scripts): si no, el RLS no aplica.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO feathersforall_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feathersforall_app;

-- El hash de la contraseña no lo lee la API: solo credenciales_login() (04).
-- Por eso el SELECT de usuarios se da columna por columna, sin password_hash.
-- INSERT y UPDATE siguen a nivel de tabla (el admin crea usuarios con su hash).
REVOKE SELECT ON usuarios FROM feathersforall_app;
GRANT SELECT (id, colegio_id, nombre, email, rol, activo, created_at, updated_at)
    ON usuarios TO feathersforall_app;

-- Login en dos pasos: RBD -> colegio (02 §7) y credenciales de ese colegio (04).
GRANT EXECUTE ON FUNCTION colegio_por_rbd(TEXT), credenciales_login(CITEXT) TO feathersforall_app;
