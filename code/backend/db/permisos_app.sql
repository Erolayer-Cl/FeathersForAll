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
GRANT SELECT (id, colegio_id, nombre, email, rol, activo, created_at, updated_at, sesiones_desde)
    ON usuarios TO feathersforall_app;

-- Login en dos pasos: RBD -> colegio (02 §7) y credenciales de ese colegio (04).
GRANT EXECUTE ON FUNCTION colegio_por_rbd(TEXT), credenciales_login(CITEXT) TO feathersforall_app;
-- Login solo con correo (estudiantes y docentes): el colegio sale de la cuenta (08).
GRANT EXECUTE ON FUNCTION cuentas_por_correo(CITEXT) TO feathersforall_app;

-- Cambiar la propia contraseña (13): única vía para que un docente o estudiante escriba su hash.
GRANT EXECUTE ON FUNCTION cambiar_mi_clave(TEXT) TO feathersforall_app;
-- Auditoría (13): solo se agrega y se lee. Ni la API puede editar ni borrar lo registrado.
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM feathersforall_app;
-- Política de borradores (14): la usan las políticas de preguntas y alternativas en toda sesión.
GRANT EXECUTE ON FUNCTION evaluacion_visible_para_estudiante(UUID) TO feathersforall_app;
-- Panel del apoderado (16): lo único que lee el apoderado, siempre limitado a sus pupilos vinculados.
GRANT EXECUTE ON FUNCTION es_mi_pupilo(UUID), mis_pupilos(), ramos_pupilo(UUID), notas_pupilo(UUID), pendientes_pupilo(UUID) TO feathersforall_app;
REVOKE UPDATE ON apoderados_estudiantes FROM feathersforall_app;

-- La respuesta correcta es secreta (17): sin SELECT de alternativas.es_correcta ni preguntas.respuestas_aceptadas.
-- Se arma el permiso por columna con TODAS las demás columnas (así una columna nueva queda legible sin tocar esto).
REVOKE SELECT ON alternativas, preguntas FROM feathersforall_app;
DO $$
DECLARE
    v_cols TEXT;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ') INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'alternativas' AND column_name <> 'es_correcta';
    EXECUTE format('GRANT SELECT (%s) ON alternativas TO feathersforall_app', v_cols);
    SELECT string_agg(quote_ident(column_name), ', ') INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'preguntas' AND column_name <> 'respuestas_aceptadas';
    EXECUTE format('GRANT SELECT (%s) ON preguntas TO feathersforall_app', v_cols);
END;
$$;
GRANT EXECUTE ON FUNCTION alternativas_staff(UUID), aceptadas_staff(UUID) TO feathersforall_app;
