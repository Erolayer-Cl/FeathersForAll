-- =============================================================================
-- FeathersForAll — la respuesta correcta es secreta también en la base (PostgreSQL 16+), sobre 01–16
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 17_secreto_respuestas.sql
--
-- Hasta 16, una sesión de estudiante podía leer alternativas.es_correcta y preguntas.respuestas_aceptadas de una
-- evaluación publicada: la API nunca se las mandaba, pero un error en una consulta las habría filtrado. Ahora:
--   * permisos_app.sql le quita al rol de la API el SELECT de esas DOS columnas (permiso por columna, como con
--     usuarios.password_hash). Nadie las lee con un SELECT directo, sea cual sea el rol de la sesión.
--   * La corrección la hace el trigger de 09/11/12, que pasa a SECURITY DEFINER: solo corre al responder (no se
--     puede usar para preguntar «¿esta es la correcta?» sin dejar la respuesta guardada y congelada).
--   * El docente del curso y el admin las leen con alternativas_staff() y aceptadas_staff(), que exigen
--     puede_gestionar_evaluacion() y el colegio de la sesión.
-- En producción el dueño de estas funciones debe ser feathersforall_plataforma (igual que 04, 08, 13 y 16).
-- =============================================================================

ALTER FUNCTION fijar_correccion_respuesta() SECURITY DEFINER;

CREATE FUNCTION alternativas_staff(p_evaluacion uuid)
RETURNS TABLE (id uuid, pregunta_id uuid, texto varchar, es_correcta boolean, orden integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT a.id, a.pregunta_id, a.texto, a.es_correcta, a.orden
    FROM alternativas a
    JOIN preguntas p ON p.id = a.pregunta_id
    WHERE p.evaluacion_id = p_evaluacion
      AND a.colegio_id = app_colegio_id()
      AND app_rol() IN ('docente', 'admin_colegio')
      AND puede_gestionar_evaluacion(p_evaluacion)
$$;

CREATE FUNCTION aceptadas_staff(p_evaluacion uuid)
RETURNS TABLE (pregunta_id uuid, respuestas_aceptadas text[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.id, p.respuestas_aceptadas::text[]
    FROM preguntas p
    WHERE p.evaluacion_id = p_evaluacion
      AND p.colegio_id = app_colegio_id()
      AND app_rol() IN ('docente', 'admin_colegio')
      AND puede_gestionar_evaluacion(p_evaluacion)
$$;

REVOKE ALL ON FUNCTION alternativas_staff(uuid), aceptadas_staff(uuid) FROM PUBLIC;
-- Los GRANT y el REVOKE por columna están en permisos_app.sql.
