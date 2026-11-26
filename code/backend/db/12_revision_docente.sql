-- =============================================================================
-- FeathersForAll — el docente revisa las respuestas escritas (PostgreSQL 16+), sobre 01–11
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 12_revision_docente.sql
--
-- En 11 una pregunta de texto se corregía sola contra sus respuestas aceptadas. Ahora:
--   - Una pregunta de texto SIN respuestas aceptadas es de revisión manual: la respuesta queda
--     "por revisar" (revision_pendiente) y vale 0 hasta que el docente decida.
--   - El docente puede marcar cualquier respuesta escrita como correcta o incorrecta (también las que
--     se corrigieron solas) y el puntaje del intento se recalcula. Queda quién y cuándo la revisó.
--
-- Quién puede revisar ya lo dicen las políticas de 02: actualizar respuestas_estudiante e
-- intentos_evaluacion es del docente del curso o del admin (puede_gestionar_evaluacion / _curso).
-- El estudiante no: el trigger de 09/11 vuelve a calcular todo en su sesión y aquí además
-- limpia cualquier marca de revisión que intente poner.
-- =============================================================================

ALTER TABLE respuestas_estudiante
    ADD COLUMN revision_pendiente BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN revisada_por UUID REFERENCES usuarios (id) ON DELETE SET NULL,
    ADD COLUMN revisada_at TIMESTAMPTZ,
    ADD CONSTRAINT chk_respuestas_revision CHECK (NOT (revision_pendiente AND revisada_at IS NOT NULL));

-- "Por revisar" en la bandeja del docente: pocas filas, se consultan por evaluación.
CREATE INDEX idx_respuestas_por_revisar ON respuestas_estudiante (evaluacion_id) WHERE revision_pendiente;

-- 11 + revisión manual: sin respuestas aceptadas, una respuesta escrita no vacía queda por revisar.
CREATE OR REPLACE FUNCTION fijar_correccion_respuesta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tipo        TEXT;
    v_aceptadas   TEXT[];
BEGIN
    IF app_rol() IS DISTINCT FROM 'estudiante' THEN
        RETURN NEW;
    END IF;
    NEW.revisada_por := NULL;
    NEW.revisada_at := NULL;
    SELECT p.tipo, p.respuestas_aceptadas INTO v_tipo, v_aceptadas FROM preguntas p WHERE p.id = NEW.pregunta_id;
    IF v_tipo = 'texto' THEN
        NEW.alternativa_elegida_id := NULL;
        IF v_aceptadas IS NULL THEN
            NEW.es_correcta := false;
            NEW.revision_pendiente := btrim(coalesce(NEW.respuesta_texto, '')) <> '';
        ELSE
            NEW.es_correcta := respuesta_texto_correcta(NEW.pregunta_id, NEW.respuesta_texto);
            NEW.revision_pendiente := false;
        END IF;
    ELSE
        NEW.respuesta_texto := NULL;
        NEW.revision_pendiente := false;
        NEW.es_correcta := COALESCE((
            SELECT a.es_correcta FROM alternativas a
            WHERE a.id = NEW.alternativa_elegida_id AND a.pregunta_id = NEW.pregunta_id
        ), false);
    END IF;
    RETURN NEW;
END;
$$;
