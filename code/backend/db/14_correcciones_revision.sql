-- =============================================================================
-- FeathersForAll — correcciones de la revisión del 27-11-2026 (PostgreSQL 16+), sobre 01–13
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 14_correcciones_revision.sql
--
-- La revisión de código y de permisos entre roles encontró, en la base:
--   1. Una sesión de estudiante leía evaluaciones en BORRADOR (y sus preguntas y alternativas) de los
--      cursos de su colegio. La API nunca se las entregaba, pero el RLS prometía lo contrario.
--   2. Todo apunte del tutor pasaba a ser material descargable, también pautas con respuestas que el
--      docente subió solo para el modo «Practicar una prueba» (antes de v1.8 no se descargaban).
--   3. Respuestas escritas: «1.000» (punto de miles, como se escribe en Chile) se tomaba como 1,0, y las
--      mayúsculas con tilde dependían del locale de la base.
--   4. cuentas_por_correo() cortaba en 5 cuentas sin orden: con más, una cuenta válida podía quedar fuera.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Borradores: solo el personal
-- -----------------------------------------------------------------------------
-- Política RESTRICTIVE adicional: se suma (AND) a las de 01, 02 y 04. El estudiante solo ve evaluaciones
-- publicadas o cerradas; docente, admin y worker siguen igual. Lo que el estudiante sí ve de una publicada
-- (sin la alternativa correcta antes de entregar) lo sigue filtrando la API.

CREATE FUNCTION evaluacion_visible_para_estudiante(p_evaluacion_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM evaluaciones e
        WHERE e.id = p_evaluacion_id
          AND e.colegio_id = app_colegio_id()
          AND e.estado <> 'borrador')
$$;
REVOKE ALL ON FUNCTION evaluacion_visible_para_estudiante(uuid) FROM PUBLIC;

CREATE POLICY sin_borradores_estudiante ON evaluaciones AS RESTRICTIVE FOR SELECT
    USING (app_rol() IS DISTINCT FROM 'estudiante' OR estado <> 'borrador');

CREATE POLICY sin_borradores_estudiante ON preguntas AS RESTRICTIVE FOR SELECT
    USING (app_rol() IS DISTINCT FROM 'estudiante' OR evaluacion_visible_para_estudiante(evaluacion_id));

CREATE POLICY sin_borradores_estudiante ON alternativas AS RESTRICTIVE FOR SELECT
    USING (app_rol() IS DISTINCT FROM 'estudiante'
           OR evaluacion_visible_para_estudiante((SELECT p.evaluacion_id FROM preguntas p WHERE p.id = pregunta_id)));


-- -----------------------------------------------------------------------------
-- 2. Qué apuntes del tutor ven los estudiantes como material
-- -----------------------------------------------------------------------------
-- Los subidos desde v1.8 (con archivo original) se subieron sabiendo que eran material: quedan visibles.
-- Los anteriores pueden ser pautas para el tutor: quedan ocultos hasta que el docente los muestre.
-- El tutor sigue usando todos (visible o no): esto es solo la descarga.

ALTER TABLE apuntes_curso ADD COLUMN visible_estudiante BOOLEAN NOT NULL DEFAULT true;
UPDATE apuntes_curso a SET visible_estudiante = false
WHERE NOT EXISTS (SELECT 1 FROM apuntes_archivos f WHERE f.apunte_id = a.id);


-- -----------------------------------------------------------------------------
-- 3. Respuestas escritas: tildes en mayúscula y punto de miles
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION normalizar_respuesta(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(                                     -- 4. sin signos ni comillas al inicio o al final
             regexp_replace(                                   -- 3. un solo espacio entre palabras
               translate(lower(translate(btrim(coalesce(p_texto, '')),
                                         -- 0. mayúsculas con tilde antes de lower(): no depende del locale
                                         'ÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖÑ',
                                         'áéíóúüàèìòùâêîôûäëïöñ')),
                         'áéíóúüàèìòùâêîôûäëïö’‘´`',           -- 1-2. minúsculas, sin tildes (la ñ se queda)
                         'aeiouuaeiouaeiouaeio'''''''''),     --      y un solo tipo de apóstrofo
               '\s+', ' ', 'g'),
             '^[\s"''“”‘’«».,;:!?¡¿()]+|[\s"''“”‘’«».,;:!?¡¿()]+$', '', 'g')
$$;

-- Número escrito a la chilena -> numeric, o NULL si no es un número.
--   «1.000» y «12.500.000» -> miles (punto cada 3 cifras, sin coma); «1.000,5» -> 1000.5; «7,0» y «7.0» -> 7.
--   «1.5» sigue siendo 1,5 (un solo punto seguido de 1, 2 o más de 3 cifras no es separador de miles).
CREATE FUNCTION numero_chileno(p_texto text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN p_texto ~ '^-?\d{1,3}(\.\d{3})+(,\d+)?$' THEN replace(replace(p_texto, '.', ''), ',', '.')::numeric
        WHEN p_texto ~ '^-?\d+([.,]\d+)?$'             THEN replace(p_texto, ',', '.')::numeric
        ELSE NULL
    END
$$;

CREATE OR REPLACE FUNCTION respuesta_texto_correcta(p_pregunta_id uuid, p_texto text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(bool_or(
               CASE
                   WHEN numero_chileno(r) IS NOT NULL AND numero_chileno(a) IS NOT NULL
                       THEN numero_chileno(r) = numero_chileno(a)
                   ELSE r = a
               END), false)
    FROM preguntas p
    CROSS JOIN LATERAL unnest(p.respuestas_aceptadas) AS acep(valor)
    CROSS JOIN LATERAL (SELECT normalizar_respuesta(p_texto) AS r, normalizar_respuesta(acep.valor) AS a) n
    WHERE p.id = p_pregunta_id AND p.tipo = 'texto' AND n.r <> ''
$$;


-- -----------------------------------------------------------------------------
-- 4. Login sin RBD: orden estable y más margen
-- -----------------------------------------------------------------------------
-- Con más de 20 cuentas con el mismo correo (no pasa en la práctica) la API pide el RBD igual que con 2.

CREATE OR REPLACE FUNCTION cuentas_por_correo(p_email citext)
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
    ORDER BY u.created_at, u.id
    LIMIT 21
$$;


-- -----------------------------------------------------------------------------
-- 5. Duración por intento (pruebas con tiempo, contrato v1.12)
-- -----------------------------------------------------------------------------
-- Hasta aquí solo había una hora de cierre común (fecha_cierre). Ahora el docente puede fijar además
-- cuántos minutos tiene cada estudiante desde que EMPIEZA (POST /v1/assessments/{id}/attempts). El plazo
-- de un intento es lo que llegue primero: inicio + duración o el cierre de la evaluación.
-- Se aceptan respuestas hasta 30 s después del plazo: el portal entrega solo al llegar a 0 y la red tarda.

ALTER TABLE evaluaciones ADD COLUMN duracion_min INTEGER
    CONSTRAINT chk_evaluaciones_duracion CHECK (duracion_min BETWEEN 1 AND 600);

CREATE FUNCTION plazo_intento(p_fecha_inicio timestamptz, p_duracion_min integer, p_fecha_cierre timestamptz)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN p_duracion_min IS NULL THEN p_fecha_cierre
        WHEN p_fecha_cierre IS NULL THEN p_fecha_inicio + make_interval(mins => p_duracion_min)
        ELSE least(p_fecha_inicio + make_interval(mins => p_duracion_min), p_fecha_cierre)
    END
$$;

-- Margen de red sobre el plazo (el mismo que usa la API en sus consultas).
CREATE FUNCTION margen_plazo() RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT interval '30 seconds' $$;

-- En una sesión de estudiante la hora de inicio y la de envío las pone la base: el estudiante no puede
-- correr su inicio hacia adelante (más tiempo) ni fechar un envío en el pasado.
CREATE FUNCTION fijar_horas_intento() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF app_rol() IS DISTINCT FROM 'estudiante' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.fecha_inicio := now();
        NEW.fecha_envio := NULL;
    ELSE
        NEW.fecha_inicio := OLD.fecha_inicio;
        IF NEW.fecha_envio IS NOT NULL AND OLD.fecha_envio IS NULL THEN
            -- Un intento que se cierra solo después del plazo (CERRAR_INTENTOS_VENCIDOS) queda con la hora del plazo.
            NEW.fecha_envio := least(now(), COALESCE((
                SELECT plazo_intento(OLD.fecha_inicio, e.duracion_min, e.fecha_cierre)
                FROM evaluaciones e WHERE e.id = OLD.evaluacion_id), now()));
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Nombre que ordena antes de trg_intentos_puntaje (los triggers BEFORE corren por orden alfabético).
CREATE TRIGGER trg_intentos_horas
    BEFORE INSERT OR UPDATE ON intentos_evaluacion
    FOR EACH ROW EXECUTE FUNCTION fijar_horas_intento();

-- Una respuesta de estudiante fuera del plazo de su intento se rechaza en la base (la API ya responde 409
-- antes; esto es por si se equivoca). 55000 = object_not_in_prerequisite_state -> 409 en problem.js.
CREATE FUNCTION verificar_plazo_respuesta() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_plazo timestamptz;
BEGIN
    IF app_rol() IS DISTINCT FROM 'estudiante' THEN
        RETURN NEW;
    END IF;
    SELECT plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) INTO v_plazo
    FROM intentos_evaluacion i
    JOIN evaluaciones e ON e.id = i.evaluacion_id
    WHERE i.id = NEW.intento_id;
    IF v_plazo IS NOT NULL AND now() > v_plazo + margen_plazo() THEN
        RAISE EXCEPTION 'El plazo de este intento ya terminó' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_respuestas_plazo
    BEFORE INSERT OR UPDATE ON respuestas_estudiante
    FOR EACH ROW EXECUTE FUNCTION verificar_plazo_respuesta();
