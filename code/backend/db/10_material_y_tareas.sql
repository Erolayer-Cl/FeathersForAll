-- =============================================================================
-- FeathersForAll — material visible para el estudiante y tareas con hora límite (PostgreSQL 16+), sobre 01–09
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 10_material_y_tareas.sql
--
-- 1. apuntes_archivos: el archivo ORIGINAL de cada apunte (apuntes_curso solo guarda el texto que lee el tutor).
--    Lo sube el docente junto con el apunte y lo descargan los estudiantes del curso.
-- 2. tareas: el docente publica una tarea (instrucciones, archivo opcional) con fecha y hora límite.
-- 3. entregas_tarea: cada estudiante sube UN archivo por tarea y puede reemplazarlo hasta la hora límite.
--    Después de esa hora la BASE rechaza la escritura (política tarea_abierta()), aunque la API se equivocara.
--
-- Los archivos van en BYTEA: el proyecto no tiene almacenamiento de objetos y así heredan el RLS por colegio
-- y por curso sin otra pieza (ADR 0016; los límites de tamaño los pone la API y los CHECK de abajo).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Archivo original de cada apunte
-- -----------------------------------------------------------------------------

CREATE TABLE apuntes_archivos (
    apunte_id   UUID PRIMARY KEY,
    colegio_id  UUID NOT NULL DEFAULT app_colegio_id(),
    curso_id    UUID NOT NULL,
    nombre      VARCHAR(150) NOT NULL,
    tipo        VARCHAR(100) NOT NULL,
    bytes       INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 41943040),   -- 40 MB, igual que la subida de apuntes
    contenido   BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Si se borra el apunte (o se quita del tutor), se va también su archivo.
    CONSTRAINT fk_apuntes_archivos_apunte
        FOREIGN KEY (apunte_id, curso_id, colegio_id)
        REFERENCES apuntes_curso (id, curso_id, colegio_id) ON DELETE CASCADE
);

CREATE INDEX idx_apuntes_archivos_curso ON apuntes_archivos (curso_id);

CREATE TRIGGER trg_apuntes_archivos_updated_at BEFORE UPDATE ON apuntes_archivos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. Tareas con hora límite
-- -----------------------------------------------------------------------------

CREATE TABLE tareas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL DEFAULT app_colegio_id(),
    curso_id        UUID NOT NULL,
    titulo          VARCHAR(150) NOT NULL CHECK (length(btrim(titulo)) >= 3),
    instrucciones   TEXT CHECK (length(instrucciones) <= 4000),
    fecha_limite    TIMESTAMPTZ NOT NULL,
    -- Archivo opcional del docente (guía, enunciado). Los cuatro campos van juntos o no va ninguno.
    archivo_nombre  VARCHAR(150),
    archivo_tipo    VARCHAR(100),
    archivo_bytes   INTEGER CHECK (archivo_bytes BETWEEN 1 AND 10485760),   -- 10 MB
    archivo         BYTEA,
    creado_por      UUID DEFAULT app_usuario_id(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_tareas_archivo_completo CHECK (
        (archivo IS NULL) = (archivo_nombre IS NULL)
        AND (archivo IS NULL) = (archivo_tipo IS NULL)
        AND (archivo IS NULL) = (archivo_bytes IS NULL)),
    CONSTRAINT uq_tareas_id_curso_colegio UNIQUE (id, curso_id, colegio_id),
    CONSTRAINT fk_tareas_curso
        FOREIGN KEY (curso_id, colegio_id) REFERENCES cursos (id, colegio_id) ON DELETE RESTRICT,
    CONSTRAINT fk_tareas_creado_por
        FOREIGN KEY (creado_por, colegio_id) REFERENCES usuarios (id, colegio_id) ON DELETE RESTRICT
);

-- "Tareas del curso", de la que cierra antes a la que cierra después.
CREATE INDEX idx_tareas_curso_limite ON tareas (curso_id, fecha_limite);
CREATE INDEX idx_tareas_colegio ON tareas (colegio_id);

CREATE TRIGGER trg_tareas_updated_at BEFORE UPDATE ON tareas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. Entregas: un archivo por estudiante y tarea, reemplazable hasta la hora límite
-- -----------------------------------------------------------------------------

CREATE TABLE entregas_tarea (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL DEFAULT app_colegio_id(),
    curso_id        UUID NOT NULL,
    tarea_id        UUID NOT NULL,
    estudiante_id   UUID NOT NULL DEFAULT app_usuario_id(),
    archivo_nombre  VARCHAR(150) NOT NULL,
    archivo_tipo    VARCHAR(100) NOT NULL,
    archivo_bytes   INTEGER NOT NULL CHECK (archivo_bytes BETWEEN 1 AND 10485760),   -- 10 MB
    archivo         BYTEA NOT NULL,
    -- Hora de la última entrega. En una sesión de estudiante la pone la base (trigger de abajo).
    entregada_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_entregas_tarea_estudiante UNIQUE (tarea_id, estudiante_id),
    CONSTRAINT fk_entregas_tarea
        FOREIGN KEY (tarea_id, curso_id, colegio_id) REFERENCES tareas (id, curso_id, colegio_id) ON DELETE CASCADE,
    -- Solo entrega quien está matriculado en el curso de la tarea.
    CONSTRAINT fk_entregas_matricula
        FOREIGN KEY (curso_id, estudiante_id) REFERENCES matriculas (curso_id, estudiante_id) ON DELETE CASCADE
);

CREATE INDEX idx_entregas_estudiante ON entregas_tarea (estudiante_id);
CREATE INDEX idx_entregas_colegio ON entregas_tarea (colegio_id);

-- ¿La tarea sigue abierta? now() es la hora de inicio de la transacción, que la API abre DESPUÉS de recibir
-- el archivo completo: cuenta la hora en que el archivo llegó al servidor, no la hora en que empezó a subirse.
CREATE FUNCTION tarea_abierta(p_tarea_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT now() <= t.fecha_limite FROM tareas t WHERE t.id = p_tarea_id), false)
$$;

-- El estudiante no elige la hora de su entrega: la base la fija al momento de escribir.
CREATE FUNCTION fijar_hora_entrega() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF app_rol() = 'estudiante' THEN
        NEW.entregada_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entregas_hora
    BEFORE INSERT OR UPDATE ON entregas_tarea
    FOR EACH ROW EXECUTE FUNCTION fijar_hora_entrega();


-- -----------------------------------------------------------------------------
-- RLS: aislamiento por colegio (como 01) + reglas por rol (RESTRICTIVE: se suman con AND)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['apuntes_archivos', 'tareas', 'entregas_tarea'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY aislamiento_colegio ON %I
                 USING (colegio_id = app_colegio_id())
                 WITH CHECK (colegio_id = app_colegio_id())', t);
    END LOOP;
END;
$$;

-- Archivos de apuntes y tareas: los ve quien ve el curso (04); los escribe el docente del curso o el admin (02 §9).
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['apuntes_archivos', 'tareas'] LOOP
        EXECUTE format('CREATE POLICY rol_select ON %I AS RESTRICTIVE FOR SELECT USING (puede_ver_curso(curso_id))', t);
        EXECUTE format('CREATE POLICY rol_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (puede_gestionar_curso(curso_id))', t);
        EXECUTE format('CREATE POLICY rol_update ON %I AS RESTRICTIVE FOR UPDATE USING (puede_gestionar_curso(curso_id)) WITH CHECK (puede_gestionar_curso(curso_id))', t);
        EXECUTE format('CREATE POLICY rol_delete ON %I AS RESTRICTIVE FOR DELETE USING (puede_gestionar_curso(curso_id))', t);
    END LOOP;
END;
$$;

-- Entregas: el estudiante ve la suya; el docente las de sus cursos; el admin las de su colegio (04).
CREATE POLICY rol_select ON entregas_tarea AS RESTRICTIVE FOR SELECT
    USING (puede_ver_estudiante(curso_id, estudiante_id));

-- Escribir: solo el propio estudiante, en un curso que ve, y solo mientras la tarea está abierta.
-- Nadie más escribe entregas (el docente no puede subir ni cambiar la de un estudiante).
CREATE POLICY rol_insert ON entregas_tarea AS RESTRICTIVE FOR INSERT
    WITH CHECK (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id()
                AND puede_ver_curso(curso_id) AND tarea_abierta(tarea_id));
CREATE POLICY rol_update ON entregas_tarea AS RESTRICTIVE FOR UPDATE
    USING      (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id() AND tarea_abierta(tarea_id))
    WITH CHECK (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id()
                AND puede_ver_curso(curso_id) AND tarea_abierta(tarea_id));
CREATE POLICY rol_delete ON entregas_tarea AS RESTRICTIVE FOR DELETE
    USING      (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id() AND tarea_abierta(tarea_id));
