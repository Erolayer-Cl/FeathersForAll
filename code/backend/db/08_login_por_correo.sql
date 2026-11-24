-- =============================================================================
-- FeathersForAll — login sin RBD para estudiantes y docentes (PostgreSQL 16+), sobre 01–07
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 08_login_por_correo.sql
--
-- Hasta 07 el login pedía el RBD porque el correo es único POR colegio. Pero un estudiante
-- pertenece a un solo colegio y su cuenta ya está enlazada a él: no tiene sentido que lo elija.
-- Con esta función la API busca el correo en todos los colegios, verifica la clave contra cada
-- cuenta encontrada y el colegio sale de la cuenta (nunca del cliente).
--
-- SECURITY DEFINER: igual que credenciales_login() (04), es la única vía para leer password_hash
-- sin colegio en la sesión. Solo devuelve cuentas activas, de colegios activos y con rol de colegio
-- (el master no entra por aquí). En producción su dueño debe ser feathersforall_plataforma.
-- =============================================================================

CREATE FUNCTION cuentas_por_correo(p_email citext)
RETURNS TABLE (id uuid, colegio_id uuid, rol rol_usuario, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.id, u.colegio_id, u.rol, u.password_hash
    FROM usuarios u
    JOIN colegios c ON c.id = u.colegio_id AND c.activo
    WHERE u.email = p_email
      AND u.activo
      AND u.rol IN ('estudiante', 'docente', 'admin_colegio')
    LIMIT 5
$$;

REVOKE ALL ON FUNCTION cuentas_por_correo(citext) FROM PUBLIC;

-- El GRANT al rol de la API está en permisos_app.sql.
