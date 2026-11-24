-- =============================================================================
-- FeathersForAll — la base corrige y pone el puntaje (PostgreSQL 16+), sobre 01–08
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 09_integridad_evaluaciones.sql
--
-- Las políticas de 02 §9 dejan al estudiante escribir en SU intento abierto, pero no limitaban QUÉ
-- columnas: con una sesión de estudiante se podía guardar una respuesta mala con es_correcta = true o
-- enviar el intento con puntaje = 100 sin responder. La API no lo hace (calcula todo en SQL), pero la
-- idea del RLS es que la base lo impida aunque la API se equivoque.
--
-- Con estos triggers, en una sesión de estudiante la base recalcula:
--   respuestas_estudiante.es_correcta  -> desde alternativas.es_correcta de la alternativa elegida;
--   intentos_evaluacion.puntaje        -> NULL mientras el intento está abierto; al enviarlo, el % de
--                                         respuestas correctas sobre el total de preguntas.
-- Docente, admin, el worker ('servicio') y los scripts sin sesión (datos demo) no pasan por aquí.
-- Las escrituras sin rol ya las rechaza el RLS de 02 §9.
-- =============================================================================

CREATE FUNCTION fijar_correccion_respuesta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF app_rol() IS DISTINCT FROM 'estudiante' THEN
        RETURN NEW;
    END IF;
    NEW.es_correcta := COALESCE((
        SELECT a.es_correcta FROM alternativas a
        WHERE a.id = NEW.alternativa_elegida_id AND a.pregunta_id = NEW.pregunta_id
    ), false);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_respuestas_correccion
    BEFORE INSERT OR UPDATE ON respuestas_estudiante
    FOR EACH ROW EXECUTE FUNCTION fijar_correccion_respuesta();


CREATE FUNCTION fijar_puntaje_intento() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF app_rol() IS DISTINCT FROM 'estudiante' THEN
        RETURN NEW;
    END IF;
    IF NEW.fecha_envio IS NULL THEN
        NEW.puntaje := NULL;
    ELSE
        -- Misma fórmula que ENVIAR_INTENTO (db/queries.js).
        NEW.puntaje := (
            SELECT round(100.0 * count(*) FILTER (WHERE r.es_correcta)
                         / NULLIF((SELECT count(*) FROM preguntas p WHERE p.evaluacion_id = NEW.evaluacion_id), 0), 2)
            FROM respuestas_estudiante r
            WHERE r.intento_id = NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_intentos_puntaje
    BEFORE INSERT OR UPDATE ON intentos_evaluacion
    FOR EACH ROW EXECUTE FUNCTION fijar_puntaje_intento();
