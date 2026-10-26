-- =============================================================================
-- FeathersForAll — conversaciones guardadas del Tutor IA (PostgreSQL 16+), sobre 01 a 04
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 05_conversaciones_tutor.sql
--
-- El estudiante retoma sus conversaciones con el tutor en cualquier dispositivo (ADR 0008).
-- Son textos escritos por menores, así que:
--   1. Solo las ve, escribe y borra el propio estudiante. Ni el docente ni el admin del
--      colegio las leen (a diferencia de consultas_tutor_ia, que es del tutor asíncrono).
--   2. Se guardan hasta fin del año escolar: purgar_conversaciones_tutor() borra las de
--      años anteriores (la corre un job programado, ver src/jobs/purgar-conversaciones.js).
--   3. Solo se puede conversar sobre un curso donde el estudiante está matriculado (FK).
--
-- Igual que el resto del esquema: aislamiento por colegio (fail-closed) + políticas
-- RESTRICTIVE por usuario. Si la API se equivoca, la base igual lo rechaza.
-- =============================================================================

CREATE TYPE modo_tutor AS ENUM ('tutor', 'pruebas');

CREATE TABLE conversaciones_tutor (
    id              UUID PRIMARY KEY,                          -- lo genera el cliente (primer mensaje)
    colegio_id      UUID NOT NULL DEFAULT app_colegio_id(),
    curso_id        UUID NOT NULL,
    estudiante_id   UUID NOT NULL DEFAULT app_usuario_id(),
    modo            modo_tutor NOT NULL DEFAULT 'tutor',
    titulo          VARCHAR(80) NOT NULL,                      -- inicio de la primera pregunta
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_conversaciones_id_colegio UNIQUE (id, colegio_id),
    CONSTRAINT fk_conversaciones_curso
        FOREIGN KEY (curso_id, colegio_id) REFERENCES cursos (id, colegio_id) ON DELETE CASCADE,
    -- Solo sobre un curso donde está matriculado; si se borra la matrícula, se borran sus conversaciones.
    CONSTRAINT fk_conversaciones_matricula
        FOREIGN KEY (curso_id, estudiante_id) REFERENCES matriculas (curso_id, estudiante_id) ON DELETE CASCADE
);

-- "Mis conversaciones de este curso", de la más reciente a la más antigua.
CREATE INDEX idx_conversaciones_estudiante_curso ON conversaciones_tutor (estudiante_id, curso_id, updated_at DESC);
CREATE INDEX idx_conversaciones_colegio ON conversaciones_tutor (colegio_id);
-- Para la purga por antigüedad.
CREATE INDEX idx_conversaciones_updated ON conversaciones_tutor (updated_at);

CREATE TRIGGER trg_conversaciones_tutor_updated_at BEFORE UPDATE ON conversaciones_tutor
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mensajes_tutor (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id       UUID NOT NULL DEFAULT app_colegio_id(),
    conversacion_id  UUID NOT NULL,
    orden            BIGINT GENERATED ALWAYS AS IDENTITY,      -- orden de llegada dentro de la conversación
    rol              VARCHAR(10) NOT NULL CHECK (rol IN ('user', 'assistant')),
    -- Holgado a propósito: la respuesta del LLM no tiene un largo fijo (depende de LLM_NUM_CTX) y,
    -- si no cupiera, el turno no se guardaría. La pregunta ya viene limitada por la API (4000).
    contenido        TEXT NOT NULL CHECK (length(contenido) BETWEEN 1 AND 100000),
    -- Apuntes usados en la respuesta: [{"doc_id": "...", "score": 0.82}]. Vacío en preguntas y charla.
    fuentes          JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(fuentes) = 'array'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_mensajes_conversacion
        FOREIGN KEY (conversacion_id, colegio_id)
        REFERENCES conversaciones_tutor (id, colegio_id) ON DELETE CASCADE
);

CREATE INDEX idx_mensajes_conversacion ON mensajes_tutor (conversacion_id, orden);
CREATE INDEX idx_mensajes_colegio ON mensajes_tutor (colegio_id);


-- -----------------------------------------------------------------------------
-- RLS: aislamiento por colegio (como 01) + solo el estudiante dueño
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['conversaciones_tutor', 'mensajes_tutor'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY aislamiento_colegio ON %I
                 USING (colegio_id = app_colegio_id())
                 WITH CHECK (colegio_id = app_colegio_id())', t);
    END LOOP;
END;
$$;

-- Leer, crear, actualizar y borrar: solo el estudiante dueño. Crear exige además que
-- el curso sea visible para él (matrícula activa en un curso activo, 04).
CREATE POLICY solo_dueno ON conversaciones_tutor AS RESTRICTIVE FOR ALL
    USING      (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id())
    WITH CHECK (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id() AND puede_ver_curso(curso_id));

-- Los mensajes se ven y se escriben si se ve su conversación (la subconsulta también pasa por el RLS).
CREATE POLICY solo_dueno ON mensajes_tutor AS RESTRICTIVE FOR ALL
    USING      (EXISTS (SELECT 1 FROM conversaciones_tutor c WHERE c.id = conversacion_id))
    WITH CHECK (EXISTS (SELECT 1 FROM conversaciones_tutor c WHERE c.id = conversacion_id));


-- -----------------------------------------------------------------------------
-- Retención: hasta fin del año escolar
-- -----------------------------------------------------------------------------
-- El año escolar chileno calza con el año calendario (marzo a diciembre). Se borran las
-- conversaciones sin actividad desde antes del 1 de enero del año en curso (hora de Chile).
-- SECURITY DEFINER: el job no tiene sesión de estudiante, y el RLS de arriba no le dejaría
-- ver nada. Nadie más puede ejecutarla (REVOKE ... FROM PUBLIC); en producción su dueño
-- debe ser feathersforall_plataforma (como colegio_por_rbd y credenciales_login).

CREATE FUNCTION purgar_conversaciones_tutor(p_ahora timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    borradas integer;
BEGIN
    DELETE FROM conversaciones_tutor
    WHERE updated_at < (date_trunc('year', p_ahora AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago');
    GET DIAGNOSTICS borradas = ROW_COUNT;
    RETURN borradas;   -- los mensajes caen por ON DELETE CASCADE
END;
$$;

REVOKE EXECUTE ON FUNCTION purgar_conversaciones_tutor(timestamptz) FROM PUBLIC;
