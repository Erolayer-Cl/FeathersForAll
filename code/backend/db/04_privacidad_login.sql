-- =============================================================================
-- FeathersForAll — privacidad de lectura y login (PostgreSQL 16+), sobre 01 + 02 + 03
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 01_schema.sql -f 02_s06_ajustes.sql -f 03_notas.sql -f 04_privacidad_login.sql
--
-- Hasta 03, el RLS respondía "¿de qué colegio es?" (01) y "¿quién puede escribir?" (02 §9).
-- Pero LEER no tenía límite dentro del colegio: cualquier sesión veía las notas, respuestas
-- y consultas al tutor de todos los estudiantes, e incluso el hash de las contraseñas.
-- Con datos de menores, eso no puede depender solo de que la API no se equivoque.
--
-- Qué agrega (ver ADR 0007):
--   1. puede_ver_curso()       -> quién ve un curso (el par de lectura de puede_gestionar_curso).
--   2. puede_ver_estudiante()  -> quién ve los datos de UN estudiante en UN curso.
--   3. Políticas RESTRICTIVE de SELECT -> privacidad por usuario, fail-closed:
--        estudiante: solo lo suyo · docente: solo sus cursos · admin: su colegio
--        worker ('servicio'): lo que necesita · sesión sin app.rol: nada.
--   4. credenciales_login()    -> la ÚNICA vía para leer password_hash; el rol de la API
--                                 ya no puede hacer SELECT de esa columna (permisos_app.sql).
--
-- No cambia qué puede ESCRIBIR cada rol (eso sigue en 02 §9). La API sigue validando
-- permisos por su lado: la base es la segunda línea de defensa.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. ¿Quién ve un curso?
-- -----------------------------------------------------------------------------
-- El admin del colegio, el docente del curso o un estudiante con matrícula activa.
-- La usan GET /v1/courses (la lista de "mis asignaturas") y el tutor IA, para que
-- ambos apliquen exactamente la misma regla. Un curso desactivado no lo ve nadie.

CREATE FUNCTION puede_ver_curso(p_curso_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((
        SELECT CASE app_rol()
                   WHEN 'admin_colegio' THEN true
                   WHEN 'docente'       THEN c.docente_id = app_usuario_id()
                   WHEN 'estudiante'    THEN EXISTS (
                       SELECT 1 FROM matriculas m
                       WHERE m.curso_id = c.id
                         AND m.estudiante_id = app_usuario_id()
                         AND m.activo)
                   ELSE false
               END
        FROM cursos c
        WHERE c.id = p_curso_id AND c.activo
    ), false)
$$;


-- -----------------------------------------------------------------------------
-- 2. ¿Quién ve los datos de un estudiante en un curso?
-- -----------------------------------------------------------------------------
-- Matrícula, intentos (y por lo tanto notas) y consultas al tutor de ESE estudiante:
--   estudiante -> solo los suyos
--   docente    -> los de los cursos que dicta
--   admin      -> todos los de su colegio (el aislamiento por colegio ya lo da 01)
--   servicio   -> el worker del tutor, que responde consultas de cualquier estudiante
--   sin rol    -> nada (fail-closed, igual que el RLS de 01 sin app.colegio_id)

CREATE FUNCTION puede_ver_estudiante(p_curso_id uuid, p_estudiante_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(CASE app_rol()
        WHEN 'estudiante'    THEN p_estudiante_id = app_usuario_id()
        WHEN 'docente'       THEN puede_gestionar_curso(p_curso_id)
        WHEN 'admin_colegio' THEN true
        WHEN 'servicio'      THEN true
        ELSE false
    END, false)
$$;


-- -----------------------------------------------------------------------------
-- 3. Privacidad de lectura (RESTRICTIVE: se suma con AND a "aislamiento_colegio")
-- -----------------------------------------------------------------------------
-- La vista `notas` (03) tiene security_invoker: hereda la política de intentos_evaluacion.

CREATE POLICY rol_select ON matriculas AS RESTRICTIVE FOR SELECT
    USING (puede_ver_estudiante(curso_id, estudiante_id));

CREATE POLICY rol_select ON intentos_evaluacion AS RESTRICTIVE FOR SELECT
    USING (puede_ver_estudiante(curso_id, estudiante_id));

CREATE POLICY rol_select ON consultas_tutor_ia AS RESTRICTIVE FOR SELECT
    USING (puede_ver_estudiante(curso_id, estudiante_id));

-- Respuestas y fuentes no tienen estudiante_id: se ven si se ve su intento o su consulta.
-- La subconsulta también pasa por el RLS, así que hereda la regla de arriba.
CREATE POLICY rol_select ON respuestas_estudiante AS RESTRICTIVE FOR SELECT
    USING (EXISTS (SELECT 1 FROM intentos_evaluacion i WHERE i.id = intento_id));

CREATE POLICY rol_select ON consultas_fuentes AS RESTRICTIVE FOR SELECT
    USING (EXISTS (SELECT 1 FROM consultas_tutor_ia c WHERE c.id = consulta_id));

-- Usuarios: un estudiante ve su propia fila y al personal del colegio (los nombres de sus
-- profesores), pero no a los demás estudiantes. El personal y el worker ven a todos los
-- usuarios de su colegio (por ejemplo, para matricular por correo).
CREATE POLICY rol_select ON usuarios AS RESTRICTIVE FOR SELECT
    USING (COALESCE(CASE app_rol()
        WHEN 'estudiante'    THEN id = app_usuario_id() OR rol <> 'estudiante'
        WHEN 'docente'       THEN true
        WHEN 'admin_colegio' THEN true
        WHEN 'servicio'      THEN true
        ELSE false
    END, false));


-- -----------------------------------------------------------------------------
-- 4. Credenciales para el login
-- -----------------------------------------------------------------------------
-- Paso 1 (02 §7): colegio_por_rbd() -> colegio. Paso 2: con SET LOCAL app.colegio_id de
-- ESE colegio, esta función devuelve las credenciales del correo. Es la única forma de leer
-- password_hash: permisos_app.sql le quita al rol de la API el SELECT de esa columna.
--
-- SECURITY DEFINER: corre con los permisos de su dueño (salta el RLS), por eso filtra a mano
-- por el colegio de la sesión. Sin app.colegio_id no devuelve nada. Igual que colegio_por_rbd,
-- en producción su dueño debe ser feathersforall_plataforma (no un superusuario).

CREATE FUNCTION credenciales_login(p_email citext)
RETURNS TABLE (id uuid, nombre varchar, email citext, rol rol_usuario, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.id, u.nombre, u.email, u.rol, u.password_hash
    FROM usuarios u
    WHERE u.colegio_id = app_colegio_id()
      AND u.email = p_email
      AND u.activo
$$;

REVOKE ALL ON FUNCTION credenciales_login(citext) FROM PUBLIC;


-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
-- Los GRANT del rol de la API (incluido el SELECT por columna de usuarios y el EXECUTE de
-- colegio_por_rbd / credenciales_login) están en permisos_app.sql, que se aplica DESPUÉS de
-- crear el rol: lo hacen crear_bdd.sql, scripts/db-setup.js y las pruebas.
