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
--   8. embedding vector(1024)                  -> bge-m3, el modelo de embeddings del RAG con Ollama.
--   9. Permisos por rol (RLS RESTRICTIVE)      -> solo el docente del curso o el admin suben
--                                                 material y crean evaluaciones; el estudiante
--                                                 solo rinde y pregunta a su nombre.
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
-- 8. Embeddings: bge-m3 (Ollama) genera vectores de 1024 dimensiones
-- -----------------------------------------------------------------------------
-- 01_schema.sql asumía nomic-embed-text (768). El RAG del equipo usa bge-m3.
-- Si cambian de modelo: cambiar este número y volver a indexar todos los apuntes.

DROP INDEX idx_embeddings_hnsw;
ALTER TABLE apuntes_embeddings
    ALTER COLUMN embedding TYPE vector(1024) USING embedding::text::vector(1024);
CREATE INDEX idx_embeddings_hnsw
    ON apuntes_embeddings USING hnsw (embedding vector_cosine_ops);


-- -----------------------------------------------------------------------------
-- 9. Permisos por ROL (además del aislamiento por colegio)
-- -----------------------------------------------------------------------------
-- El RLS de 01 responde "¿de qué colegio es?". Esto agrega "¿QUIÉN puede escribir?".
-- La API, después de VERIFICAR el JWT, fija en cada transacción:
--     SET LOCAL app.colegio_id = '<uuid>';
--     SET LOCAL app.usuario_id = '<uuid del usuario>';
--     SET LOCAL app.rol        = 'docente' | 'estudiante' | 'admin_colegio';
-- El worker (indexar apuntes, responder al tutor) usa app.rol = 'servicio'.
-- El master opera con feathersforall_plataforma (BYPASSRLS).
--
-- Son políticas RESTRICTIVE: se suman (AND) a "aislamiento_colegio".
-- Leer no cambia; escribir exige el rol correcto. Fail-closed: sin app.rol
-- no se puede escribir en estas tablas.
--
-- Ojo: la base confía en lo que la API pone en app.rol / app.usuario_id. Esos
-- valores deben salir SOLO del JWT verificado, nunca de datos del cliente.

CREATE FUNCTION app_usuario_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.usuario_id', true), '')::uuid
$$;

CREATE FUNCTION app_rol() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.rol', true), '')
$$;

-- Docente de ESE curso, o admin del colegio ("profesor o superior").
CREATE FUNCTION puede_gestionar_curso(p_curso_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        app_rol() = 'admin_colegio'
        OR (app_rol() = 'docente' AND EXISTS (
                SELECT 1 FROM cursos c
                WHERE c.id = p_curso_id AND c.docente_id = app_usuario_id()))
    , false)
$$;

CREATE FUNCTION puede_gestionar_evaluacion(p_evaluacion_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT puede_gestionar_curso((SELECT curso_id FROM evaluaciones WHERE id = p_evaluacion_id))
$$;

CREATE FUNCTION puede_gestionar_pregunta(p_pregunta_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT puede_gestionar_evaluacion((SELECT evaluacion_id FROM preguntas WHERE id = p_pregunta_id))
$$;

-- El estudiante de la sesión es dueño de ese intento y todavía no lo envió.
CREATE FUNCTION es_mi_intento_abierto(p_intento_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(app_rol() = 'estudiante' AND EXISTS (
        SELECT 1 FROM intentos_evaluacion i
        WHERE i.id = p_intento_id
          AND i.estudiante_id = app_usuario_id()
          AND i.fecha_envio IS NULL), false)
$$;

-- Quién creó el material y la evaluación (auditoría). Se llena solo con el
-- usuario de la sesión; NULL solo en operaciones de plataforma.
ALTER TABLE usuarios ADD CONSTRAINT uq_usuarios_id_colegio UNIQUE (id, colegio_id);

ALTER TABLE apuntes_curso
    ADD COLUMN subido_por UUID DEFAULT app_usuario_id(),
    ADD CONSTRAINT fk_apuntes_subido_por
        FOREIGN KEY (subido_por, colegio_id) REFERENCES usuarios (id, colegio_id) ON DELETE RESTRICT;

ALTER TABLE evaluaciones
    ADD COLUMN creado_por UUID DEFAULT app_usuario_id(),
    ADD CONSTRAINT fk_evaluaciones_creado_por
        FOREIGN KEY (creado_por, colegio_id) REFERENCES usuarios (id, colegio_id) ON DELETE RESTRICT;

-- Material, evaluaciones y matrículas: solo el docente del curso o el admin.
-- (apuntes_embeddings también lo escribe el worker de indexación.)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('apuntes_curso',      'puede_gestionar_curso(curso_id)'),
        ('apuntes_embeddings', 'puede_gestionar_curso(curso_id) OR app_rol() = ''servicio'''),
        ('evaluaciones',       'puede_gestionar_curso(curso_id)'),
        ('preguntas',          'puede_gestionar_evaluacion(evaluacion_id)'),
        ('alternativas',       'puede_gestionar_pregunta(pregunta_id)'),
        ('matriculas',         'puede_gestionar_curso(curso_id)')
    ) AS v(tabla, regla) LOOP
        EXECUTE format('CREATE POLICY rol_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (%s)', r.tabla, r.regla);
        EXECUTE format('CREATE POLICY rol_update ON %I AS RESTRICTIVE FOR UPDATE USING (%s) WITH CHECK (%s)', r.tabla, r.regla, r.regla);
        EXECUTE format('CREATE POLICY rol_delete ON %I AS RESTRICTIVE FOR DELETE USING (%s)', r.tabla, r.regla);
    END LOOP;
END;
$$;

-- Cursos: el admin crea cualquiera; un docente solo cursos propios
-- (no puede crear ni traspasar un curso a nombre de otro docente).
CREATE POLICY rol_insert ON cursos AS RESTRICTIVE FOR INSERT
    WITH CHECK (app_rol() = 'admin_colegio' OR (app_rol() = 'docente' AND docente_id = app_usuario_id()));
CREATE POLICY rol_update ON cursos AS RESTRICTIVE FOR UPDATE
    USING      (app_rol() = 'admin_colegio' OR (app_rol() = 'docente' AND docente_id = app_usuario_id()))
    WITH CHECK (app_rol() = 'admin_colegio' OR (app_rol() = 'docente' AND docente_id = app_usuario_id()));
CREATE POLICY rol_delete ON cursos AS RESTRICTIVE FOR DELETE
    USING (app_rol() = 'admin_colegio');

-- Usuarios: solo el admin del colegio los crea, edita o borra.
CREATE POLICY rol_insert ON usuarios AS RESTRICTIVE FOR INSERT WITH CHECK (app_rol() = 'admin_colegio');
CREATE POLICY rol_update ON usuarios AS RESTRICTIVE FOR UPDATE
    USING (app_rol() = 'admin_colegio') WITH CHECK (app_rol() = 'admin_colegio');
CREATE POLICY rol_delete ON usuarios AS RESTRICTIVE FOR DELETE USING (app_rol() = 'admin_colegio');

-- Intentos: el estudiante abre y envía SOLO los suyos. Recorregir es del docente.
CREATE POLICY rol_insert ON intentos_evaluacion AS RESTRICTIVE FOR INSERT
    WITH CHECK (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id());
CREATE POLICY rol_update ON intentos_evaluacion AS RESTRICTIVE FOR UPDATE
    USING      ((app_rol() = 'estudiante' AND estudiante_id = app_usuario_id() AND fecha_envio IS NULL)
                OR puede_gestionar_curso(curso_id))
    WITH CHECK ((app_rol() = 'estudiante' AND estudiante_id = app_usuario_id())
                OR puede_gestionar_curso(curso_id));
CREATE POLICY rol_delete ON intentos_evaluacion AS RESTRICTIVE FOR DELETE
    USING (app_rol() = 'admin_colegio');

-- Respuestas: el estudiante responde en SU intento mientras no lo envíe.
CREATE POLICY rol_insert ON respuestas_estudiante AS RESTRICTIVE FOR INSERT
    WITH CHECK (es_mi_intento_abierto(intento_id));
CREATE POLICY rol_update ON respuestas_estudiante AS RESTRICTIVE FOR UPDATE
    USING      (es_mi_intento_abierto(intento_id) OR puede_gestionar_evaluacion(evaluacion_id))
    WITH CHECK (es_mi_intento_abierto(intento_id) OR puede_gestionar_evaluacion(evaluacion_id));
CREATE POLICY rol_delete ON respuestas_estudiante AS RESTRICTIVE FOR DELETE
    USING (app_rol() = 'admin_colegio');

-- Tutor IA: el estudiante pregunta a su nombre; el worker responde y cita fuentes.
CREATE POLICY rol_insert ON consultas_tutor_ia AS RESTRICTIVE FOR INSERT
    WITH CHECK (app_rol() = 'estudiante' AND estudiante_id = app_usuario_id());
CREATE POLICY rol_update ON consultas_tutor_ia AS RESTRICTIVE FOR UPDATE
    USING (app_rol() = 'servicio') WITH CHECK (app_rol() = 'servicio');
CREATE POLICY rol_delete ON consultas_tutor_ia AS RESTRICTIVE FOR DELETE
    USING (app_rol() = 'admin_colegio');

CREATE POLICY rol_insert ON consultas_fuentes AS RESTRICTIVE FOR INSERT WITH CHECK (app_rol() = 'servicio');
CREATE POLICY rol_update ON consultas_fuentes AS RESTRICTIVE FOR UPDATE
    USING (app_rol() = 'servicio') WITH CHECK (app_rol() = 'servicio');
CREATE POLICY rol_delete ON consultas_fuentes AS RESTRICTIVE FOR DELETE USING (app_rol() = 'servicio');

-- outbox_eventos y claves_idempotencia: las escribe la API en nombre de quien
-- hace la petición; basta con una sesión con rol.
CREATE POLICY rol_insert ON outbox_eventos AS RESTRICTIVE FOR INSERT WITH CHECK (app_rol() IS NOT NULL);
CREATE POLICY rol_insert ON claves_idempotencia AS RESTRICTIVE FOR INSERT WITH CHECK (app_rol() IS NOT NULL);


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
