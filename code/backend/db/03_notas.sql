-- =============================================================================
-- FeathersForAll — notas (escala chilena 1.0–7.0) sobre 01 + 02 (PostgreSQL 16+)
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 01_schema.sql -f 02_s06_ajustes.sql -f 03_notas.sql
--
-- La base sigue guardando el PUNTAJE (0–100, % de logro) en intentos_evaluacion.
-- La NOTA no se guarda: se calcula con nota_desde_puntaje() a partir del puntaje
-- y de la exigencia de cada evaluación. Así, si el docente cambia la exigencia,
-- todas las notas se recalculan solas y no hay dos fuentes de verdad.
--
-- Qué agrega:
--   1. evaluaciones.exigencia    -> % de logro para el 4.0 (por defecto 60 %).
--   2. evaluaciones.ponderacion  -> peso de la evaluación en el promedio del curso.
--   3. nota_desde_puntaje()      -> conversión puntaje -> nota 1.0–7.0.
--   4. Vista notas               -> una fila por intento enviado, con su nota.
--   5. Índice parcial            -> consultas rápidas de notas por curso/estudiante.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 y 2. Exigencia y ponderación por evaluación
-- -----------------------------------------------------------------------------

ALTER TABLE evaluaciones
    -- 60 % es la exigencia habitual en Chile; algunos colegios usan 50 % o 70 %.
    ADD COLUMN exigencia   NUMERIC(4,1) NOT NULL DEFAULT 60
        CONSTRAINT chk_evaluaciones_exigencia CHECK (exigencia > 0 AND exigencia < 100),
    -- Peso relativo: el promedio del curso es sum(nota * ponderacion) / sum(ponderacion).
    -- Con todas en 1 es un promedio simple.
    ADD COLUMN ponderacion NUMERIC(5,2) NOT NULL DEFAULT 1
        CONSTRAINT chk_evaluaciones_ponderacion CHECK (ponderacion > 0);


-- -----------------------------------------------------------------------------
-- 3. Puntaje (0–100) -> nota (1.0–7.0)
-- -----------------------------------------------------------------------------
-- Escala lineal por tramos:
--   puntaje <  exigencia: 1.0 + 3.0 * puntaje / exigencia
--   puntaje >= exigencia: 4.0 + 3.0 * (puntaje - exigencia) / (100 - exigencia)
-- Redondeo a un decimal (3.95 -> 4.0), como en las actas.
-- IMMUTABLE + PARALLEL SAFE: Postgres puede usarla en índices y en paralelo.

CREATE FUNCTION nota_desde_puntaje(p_puntaje NUMERIC, p_exigencia NUMERIC DEFAULT 60)
RETURNS NUMERIC(2,1)
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT round(
        CASE
            WHEN p_puntaje < p_exigencia THEN 1.0 + 3.0 * p_puntaje / p_exigencia
            ELSE 4.0 + 3.0 * (p_puntaje - p_exigencia) / (100 - p_exigencia)
        END, 1)::NUMERIC(2,1)
$$;


-- -----------------------------------------------------------------------------
-- 4. Vista de notas
-- -----------------------------------------------------------------------------
-- Solo intentos ENVIADOS: un intento en curso no tiene nota.
-- security_invoker = true: respeta el RLS de quien consulta (ver alternativas_publicas).
-- La vista no filtra por rol: la API decide qué filas puede ver cada usuario
-- (el estudiante las suyas, el docente las de sus cursos).

CREATE VIEW notas WITH (security_invoker = true) AS
    SELECT i.id               AS intento_id,
           i.colegio_id,
           i.curso_id,
           i.evaluacion_id,
           i.estudiante_id,
           e.titulo           AS evaluacion,
           e.estado           AS estado_evaluacion,
           e.exigencia,
           e.ponderacion,
           i.puntaje,
           nota_desde_puntaje(COALESCE(i.puntaje, 0), e.exigencia) AS nota,
           i.fecha_envio
    FROM intentos_evaluacion i
    JOIN evaluaciones e ON e.id = i.evaluacion_id
    WHERE i.fecha_envio IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. Índice para el libro de notas
-- -----------------------------------------------------------------------------
-- Parcial: solo intentos enviados, que son los únicos que tienen nota. Cubre
-- "notas del curso" (curso_id) y "notas de un estudiante en un curso".

CREATE INDEX idx_intentos_notas
    ON intentos_evaluacion (curso_id, estudiante_id, evaluacion_id)
    INCLUDE (puntaje, fecha_envio)
    WHERE fecha_envio IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Roles (referencia — continúa los bloques de 01 y 02)
-- -----------------------------------------------------------------------------
-- GRANT SELECT ON notas TO feathersforall_app;
