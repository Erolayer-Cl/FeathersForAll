-- =============================================================================
-- FeathersForAll — ajustes S06 sobre 01_schema.sql (PostgreSQL 16+)
-- =============================================================================
--
-- Mismas reglas que 01_schema.sql: colegio_id en todo, FKs compuestas, RLS
-- fail-closed, RESTRICT entre entidades independientes y CASCADE solo en
-- composición. Se ejecuta DESPUÉS de 01:
--
--     psql -v ON_ERROR_STOP=1 -f 01_schema.sql -f 02_s06_ajustes.sql
--
-- Qué agrega y por qué (ver ADR 0004):
--   1. colegio_id con DEFAULT app_colegio_id() -> la API no repite el colegio en cada INSERT.
--   2. cursos.periodo / cursos.asignatura      -> el contrato S05 exige "period".
--   3. preguntas.retroalimentacion             -> H2: el docente escribe el feedback por pregunta;
--                                                 al corregir se copia (congelado) a la respuesta.
--   4. Tutor IA asíncrono                      -> el contrato S05 responde 202: la consulta nace
--                                                 "en_cola" sin respuesta; + fuentes (RAG).
--   5. outbox_eventos                          -> patrón Outbox (eventos confiables hacia SQS).
--   6. claves_idempotencia                     -> Idempotency-Key del contrato S05 (24 h).
--   7. colegio_por_rbd()                       -> resolver el colegio ANTES del login sin abrir
--                                                 el RLS de colegios.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. colegio_id por defecto = colegio de la sesión
-- -----------------------------------------------------------------------------
-- Si la API olvida el SET LOCAL, app_colegio_id() es NULL y el INSERT falla por
-- NOT NULL: sigue siendo fail-closed. Si manda otro colegio a mano, RLS WITH CHECK
-- lo rechaza.

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'cursos', 'matriculas', 'evaluaciones', 'preguntas', 'alternativas',
        'intentos_evaluacion', 'respuestas_estudiante', 'apuntes_curso',
        'apuntes_embeddings', 'consultas_tutor_ia'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN colegio_id SET DEFAULT app_colegio_id()', t);
    END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. cursos: periodo y asignatura (contrato S05: CourseInput.period / subject)
-- -----------------------------------------------------------------------------

ALTER TABLE cursos
    ADD COLUMN periodo    VARCHAR(7)  NOT NULL DEFAULT '2026-S2'
        CONSTRAINT chk_cursos_periodo CHECK (periodo ~ '^\d{4}-S[12]$'),
    ADD COLUMN asignatura VARCHAR(80);

-- El DEFAULT solo sirve para no romper filas existentes; desde ahora la API lo manda.
ALTER TABLE cursos ALTER COLUMN periodo DROP DEFAULT;

CREATE INDEX idx_cursos_colegio_periodo ON cursos (colegio_id, periodo);


-- -----------------------------------------------------------------------------
-- 3. preguntas: retroalimentación definida por el docente (H2)
-- -----------------------------------------------------------------------------
-- respuestas_estudiante.retroalimentacion sigue existiendo: es la copia
-- CONGELADA que se guarda al corregir, igual que es_correcta.

ALTER TABLE preguntas ADD COLUMN retroalimentacion TEXT;


-- -----------------------------------------------------------------------------
-- 4. Tutor IA asíncrono: en_cola -> respondida | fallida
-- -----------------------------------------------------------------------------

CREATE TYPE estado_consulta AS ENUM ('en_cola', 'respondida', 'fallida');

ALTER TABLE consultas_tutor_ia
    ALTER COLUMN respuesta DROP NOT NULL,
    ADD COLUMN estado        estado_consulta NOT NULL DEFAULT 'en_cola',
    -- "grounded" del contrato: true si la respuesta se apoyó en apuntes del curso.
    ADD COLUMN con_respaldo  BOOLEAN,
    ADD COLUMN respondida_at TIMESTAMPTZ,
    ADD COLUMN updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD CONSTRAINT chk_consultas_respuesta_segun_estado CHECK (
        (estado = 'en_cola'    AND respuesta IS NULL     AND respondida_at IS NULL)
     OR (estado = 'respondida' AND respuesta IS NOT NULL AND respondida_at IS NOT NULL)
     OR (estado = 'fallida'    AND respondida_at IS NOT NULL)
    ),
    -- Destino de la FK compuesta desde consultas_fuentes.
    ADD CONSTRAINT uq_consultas_id_curso_colegio UNIQUE (id, curso_id, colegio_id);

-- El worker busca las pendientes más antiguas.
CREATE INDEX idx_consultas_en_cola ON consultas_tutor_ia (created_at) WHERE estado = 'en_cola';

CREATE TRIGGER trg_consultas_tutor_ia_updated_at BEFORE UPDATE ON consultas_tutor_ia
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Apuntes usados como fuente de cada respuesta ("sources" del contrato).
-- Las dos FKs comparten curso_id y colegio_id: la fuente SIEMPRE es un apunte
-- del mismo curso de la consulta (el RAG no puede citar otro curso).
CREATE TABLE consultas_fuentes (
    colegio_id  UUID NOT NULL DEFAULT app_colegio_id(),
    curso_id    UUID NOT NULL,
    consulta_id UUID NOT NULL,
    apunte_id   UUID NOT NULL,

    CONSTRAINT pk_consultas_fuentes PRIMARY KEY (consulta_id, apunte_id),

    -- Composición: la fuente no tiene sentido sin la consulta.
    CONSTRAINT fk_fuentes_consulta
        FOREIGN KEY (consulta_id, curso_id, colegio_id)
        REFERENCES consultas_tutor_ia (id, curso_id, colegio_id) ON DELETE CASCADE,

    -- Si el docente borra el apunte, la consulta conserva su respuesta y pierde la cita.
    CONSTRAINT fk_fuentes_apunte
        FOREIGN KEY (apunte_id, curso_id, colegio_id)
        REFERENCES apuntes_curso (id, curso_id, colegio_id) ON DELETE CASCADE
);

CREATE INDEX idx_fuentes_apunte ON consultas_fuentes (apunte_id);
CREATE INDEX idx_fuentes_colegio ON consultas_fuentes (colegio_id);


-- -----------------------------------------------------------------------------
-- 5. Outbox de eventos (ADR 0004)
-- -----------------------------------------------------------------------------
-- La API inserta el evento en la MISMA transacción que el cambio de estado.
-- El relay (worker) lee las pendientes de TODOS los colegios, así que se conecta
-- con feathersforall_plataforma (BYPASSRLS), publica en SQS y marca publicado_at.

CREATE TABLE outbox_eventos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- = event_id
    colegio_id      UUID NOT NULL DEFAULT app_colegio_id()
                    REFERENCES colegios(id) ON DELETE RESTRICT,
    tipo            VARCHAR(80) NOT NULL                          -- ej. consulta_tutor.encolada
                    CONSTRAINT chk_outbox_tipo CHECK (tipo ~ '^[a-z_]+\.[a-z_]+$'),
    version         VARCHAR(10) NOT NULL DEFAULT '1.0',
    agregado_id     UUID NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,           -- solo IDs, sin datos personales
    trace_id        VARCHAR(64),
    creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    publicado_at    TIMESTAMPTZ,
    intentos        SMALLINT NOT NULL DEFAULT 0 CHECK (intentos >= 0)
);

-- Solo las pendientes (índice parcial: queda chico aunque la tabla crezca).
CREATE INDEX idx_outbox_pendientes ON outbox_eventos (creado_at) WHERE publicado_at IS NULL;
CREATE INDEX idx_outbox_colegio ON outbox_eventos (colegio_id);


-- -----------------------------------------------------------------------------
-- 6. Claves de idempotencia (contrato S05: Idempotency-Key en todo POST)
-- -----------------------------------------------------------------------------
-- Misma clave del mismo usuario en 24 h -> se devuelve la respuesta guardada.
-- Un job de plataforma borra las de más de 24 h (ver queries.js).

CREATE TABLE claves_idempotencia (
    colegio_id      UUID NOT NULL DEFAULT app_colegio_id()
                    REFERENCES colegios(id) ON DELETE RESTRICT,
    clave           UUID NOT NULL,
    usuario_id      UUID NOT NULL,
    -- Método y ruta: la misma clave no puede reutilizarse en otro endpoint.
    operacion       VARCHAR(120) NOT NULL,                        -- ej. 'POST /v1/courses'
    status_http     SMALLINT NOT NULL CHECK (status_http BETWEEN 200 AND 599),
    respuesta       JSONB NOT NULL,
    creada_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_claves_idempotencia PRIMARY KEY (colegio_id, clave)
);

CREATE INDEX idx_idempotencia_creada ON claves_idempotencia (creada_at);


-- -----------------------------------------------------------------------------
-- RLS de las tablas nuevas (mismo patrón fail-closed)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['consultas_fuentes', 'outbox_eventos', 'claves_idempotencia'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY aislamiento_colegio ON %I
                 USING (colegio_id = app_colegio_id())
                 WITH CHECK (colegio_id = app_colegio_id())', t);
    END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. Resolver el colegio antes del login
-- -----------------------------------------------------------------------------
-- El login necesita el colegio (el email es único POR colegio), pero colegios
-- tiene RLS fail-closed: sin app.colegio_id la API no lo ve. Esta función
-- devuelve SOLO el id de un colegio activo a partir de su RBD; no expone nada más.
--
-- SECURITY DEFINER: corre con los permisos de su dueño. Para que salte el RLS,
-- el dueño debe ser feathersforall_plataforma (BYPASSRLS). Ver bloque de roles.

CREATE FUNCTION colegio_por_rbd(p_rbd TEXT) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT id FROM colegios WHERE rbd = p_rbd AND activo
$$;

REVOKE ALL ON FUNCTION colegio_por_rbd(TEXT) FROM PUBLIC;


-- -----------------------------------------------------------------------------
-- Roles (referencia — continúa el bloque de 01_schema.sql, ejecutar una vez por entorno)
-- -----------------------------------------------------------------------------
-- GRANT SELECT, INSERT, UPDATE, DELETE ON consultas_fuentes, outbox_eventos,
--       claves_idempotencia TO feathersforall_app;
-- GRANT USAGE ON TYPE estado_consulta TO feathersforall_app;
--
-- -- La función de login corre como plataforma (salta RLS solo para esa búsqueda).
-- GRANT CREATE ON SCHEMA public TO feathersforall_plataforma;   -- necesario para ser dueño
-- GRANT SELECT ON colegios TO feathersforall_plataforma;
-- ALTER FUNCTION colegio_por_rbd(TEXT) OWNER TO feathersforall_plataforma;
-- GRANT EXECUTE ON FUNCTION colegio_por_rbd(TEXT) TO feathersforall_app;
--
-- -- El relay de la outbox y la limpieza de idempotencia usan feathersforall_plataforma.
-- GRANT SELECT, UPDATE ON outbox_eventos TO feathersforall_plataforma;
-- GRANT SELECT, DELETE ON claves_idempotencia TO feathersforall_plataforma;
