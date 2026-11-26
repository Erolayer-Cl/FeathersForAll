-- =============================================================================
-- FeathersForAll — preguntas de respuesta escrita (PostgreSQL 16+), sobre 01–10
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 11_preguntas_texto.sql
--
-- Hasta aquí todas las preguntas eran de alternativas. Ahora una pregunta puede ser de tipo 'texto': el
-- estudiante escribe su respuesta y se corrige al instante contra las respuestas que el docente aceptó
-- ("respuesta corta": 1 a 10 respuestas aceptadas, como "7", "siete" o "Bernardo O'Higgins").
--
-- La comparación es tolerante con lo que no cambia el sentido: mayúsculas, tildes, espacios de más,
-- comillas, el tipo de apóstrofo (’ o ') y la puntuación final, y en los números da igual "7", "7,0" o "7.0". La ñ se respeta
-- (año ≠ ano).
--
-- Igual que con las alternativas (09), en una sesión de estudiante la BASE decide si la respuesta es
-- correcta: el trigger de 09 se reemplaza para que también corrija las preguntas de texto.
-- Las respuestas aceptadas son tan sensibles como alternativas.es_correcta: la API nunca las manda al
-- estudiante.
-- =============================================================================

ALTER TABLE preguntas
    ADD COLUMN tipo VARCHAR(12) NOT NULL DEFAULT 'alternativas'
        CONSTRAINT chk_preguntas_tipo CHECK (tipo IN ('alternativas', 'texto')),
    -- NULL mientras el borrador no las tiene (como la alternativa correcta: se exigen al publicar).
    ADD COLUMN respuestas_aceptadas TEXT[]
        CONSTRAINT chk_preguntas_respuestas_aceptadas CHECK (
            respuestas_aceptadas IS NULL
            OR (tipo = 'texto' AND cardinality(respuestas_aceptadas) BETWEEN 1 AND 10));

ALTER TABLE respuestas_estudiante
    ADD COLUMN respuesta_texto TEXT
        CONSTRAINT chk_respuestas_texto CHECK (
            respuesta_texto IS NULL OR (length(respuesta_texto) <= 1000 AND alternativa_elegida_id IS NULL));

-- 01 decía "sin alternativa no puede ser correcta"; ahora una respuesta escrita también puede serlo.
ALTER TABLE respuestas_estudiante DROP CONSTRAINT chk_respuestas_sin_alternativa;
ALTER TABLE respuestas_estudiante ADD CONSTRAINT chk_respuestas_sin_alternativa CHECK (
    alternativa_elegida_id IS NOT NULL OR respuesta_texto IS NOT NULL OR es_correcta IS NOT TRUE);

-- Forma comparable de una respuesta escrita.
CREATE FUNCTION normalizar_respuesta(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(                                     -- 4. sin signos ni comillas al inicio o al final
             regexp_replace(                                   -- 3. un solo espacio entre palabras
               translate(lower(btrim(coalesce(p_texto, ''))),  -- 1-2. minúsculas, sin tildes (la ñ se queda)
                         'áéíóúüàèìòùâêîôûäëïö’‘´`',                    --      y un solo tipo de apóstrofo
                         'aeiouuaeiouaeiouaeio'''''''''),
               '\s+', ' ', 'g'),
             '^[\s"''“”‘’«».,;:!?¡¿()]+|[\s"''“”‘’«».,;:!?¡¿()]+$', '', 'g')
$$;

-- ¿La respuesta escrita calza con alguna aceptada? Los números se comparan por valor (7 = 7,0 = 7.0).
CREATE FUNCTION respuesta_texto_correcta(p_pregunta_id uuid, p_texto text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(bool_or(
               CASE
                   WHEN r ~ '^-?\d+([.,]\d+)?$' AND a ~ '^-?\d+([.,]\d+)?$'
                       THEN replace(r, ',', '.')::numeric = replace(a, ',', '.')::numeric
                   ELSE r = a
               END), false)
    FROM preguntas p
    CROSS JOIN LATERAL unnest(p.respuestas_aceptadas) AS acep(valor)
    CROSS JOIN LATERAL (SELECT normalizar_respuesta(p_texto) AS r, normalizar_respuesta(acep.valor) AS a) n
    WHERE p.id = p_pregunta_id AND p.tipo = 'texto' AND n.r <> ''
$$;

-- 09 corregía solo alternativas; ahora también las preguntas de texto. Sigue sin aplicar a docente,
-- admin, worker ni scripts sin sesión.
CREATE OR REPLACE FUNCTION fijar_correccion_respuesta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF app_rol() IS DISTINCT FROM 'estudiante' THEN
        RETURN NEW;
    END IF;
    IF (SELECT p.tipo FROM preguntas p WHERE p.id = NEW.pregunta_id) = 'texto' THEN
        NEW.alternativa_elegida_id := NULL;
        NEW.es_correcta := respuesta_texto_correcta(NEW.pregunta_id, NEW.respuesta_texto);
    ELSE
        NEW.respuesta_texto := NULL;
        NEW.es_correcta := COALESCE((
            SELECT a.es_correcta FROM alternativas a
            WHERE a.id = NEW.alternativa_elegida_id AND a.pregunta_id = NEW.pregunta_id
        ), false);
    END IF;
    RETURN NEW;
END;
$$;
