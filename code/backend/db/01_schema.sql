-- =============================================================================
-- FeathersForAll — esquema base (PostgreSQL 16+)
-- =============================================================================
--
-- Ideas que guían todo el archivo:
--
-- 1. AISLAMIENTO POR COLEGIO EN LA BASE, NO SOLO EN LA API
--    Cada tabla "de un colegio" lleva su propio colegio_id (denormalizado) y las
--    FKs entre tablas son COMPUESTAS: (x_id, colegio_id) -> padre(id, colegio_id).
--    Así es imposible que un curso del colegio A apunte a un docente del colegio B:
--    la FK exige que el par exista tal cual en la tabla padre.
--
-- 2. ROLES VALIDADOS CON FK, NO CON TRIGGERS
--    Donde una columna debe apuntar a un usuario de cierto rol (docente_id,
--    estudiante_id) se agrega una columna generada constante con ese rol y se
--    incluye en la FK: (docente_id, colegio_id, docente_rol) -> usuarios(id, colegio_id, rol).
--    Es declarativo, no se puede saltar, y además impide cambiarle el rol a un
--    docente que todavía tiene cursos asignados.
--
-- 3. ROW LEVEL SECURITY "FAIL-CLOSED"
--    Toda tabla de colegio tiene RLS filtrando por app_colegio_id(), que lee
--    la variable de sesión app.colegio_id. Si la API olvida setearla, la función
--    devuelve NULL y la query no ve NADA (en vez de verlo todo).
--    Uso desde la API, dentro de cada transacción/request:
--        BEGIN;
--        SET LOCAL app.colegio_id = '<uuid del colegio del usuario autenticado>';
--        ... queries ...
--        COMMIT;
--    SET LOCAL es importante: con un pool de conexiones, un SET normal quedaría
--    "pegado" a la conexión y el siguiente request (de otro colegio) lo heredaría.
--
--    Las operaciones de plataforma (rol master: crear colegios, soporte) deben
--    ir por un rol de base de datos distinto con BYPASSRLS. Ver bloque de roles
--    al final del archivo.
--
-- 4. BORRADO LÓGICO POR DEFECTO
--    Las relaciones entre entidades independientes (colegio, usuario, curso,
--    matrícula) usan ON DELETE RESTRICT: no se borra historial académico por
--    accidente; para "eliminar" se usa activo = false.
--    Solo se usa CASCADE en relaciones de composición, donde el hijo no tiene
--    sentido sin el padre (pregunta -> alternativas, intento -> respuestas,
--    apunte -> embeddings).
-- =============================================================================


-- citext: texto que compara sin distinguir mayúsculas (para emails).
CREATE EXTENSION IF NOT EXISTS citext;
-- vector: pgvector, tipo de dato y búsqueda por similitud para el RAG.
CREATE EXTENSION IF NOT EXISTS vector;
-- No se necesita uuid-ossp: gen_random_uuid() viene incluido desde PG13.


-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

-- Colegio de la sesión actual. current_setting(..., true) devuelve NULL en vez
-- de error si la variable no existe; NULLIF cubre el caso de cadena vacía.
-- Cualquier comparación "colegio_id = NULL" es falsa -> RLS no devuelve filas.
CREATE FUNCTION app_colegio_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.colegio_id', true), '')::uuid
$$;

-- Mantiene updated_at al día en cada UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- colegios
-- -----------------------------------------------------------------------------

CREATE TABLE colegios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      VARCHAR(150) NOT NULL,
    -- El RBD identifica a un único establecimiento en Chile: no puede repetirse.
    -- Sigue siendo opcional (NULL) para colegios de prueba; UNIQUE permite varios NULL.
    rbd         VARCHAR(20) UNIQUE,
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- usuarios
-- -----------------------------------------------------------------------------

CREATE TYPE rol_usuario AS ENUM ('master', 'admin_colegio', 'docente', 'estudiante');

CREATE TABLE usuarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT: no se puede borrar un colegio que tiene usuarios (usar activo = false).
    colegio_id      UUID REFERENCES colegios(id) ON DELETE RESTRICT,
    nombre          VARCHAR(150) NOT NULL,
    -- CITEXT: 'Juan@x.cl' y 'juan@x.cl' cuentan como el mismo email en el UNIQUE.
    email           CITEXT NOT NULL CHECK (length(email) <= 150),
    password_hash   TEXT NOT NULL,
    rol             rol_usuario NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- El mismo email puede existir en dos colegios distintos (un apoderado que
    -- es docente en otro colegio, por ejemplo). Por eso el login debe conocer
    -- el colegio ANTES de buscar el usuario (subdominio o selector).
    CONSTRAINT uq_usuarios_colegio_email UNIQUE (colegio_id, email),

    -- Destino de las FKs compuestas que validan colegio + rol a la vez.
    CONSTRAINT uq_usuarios_id_colegio_rol UNIQUE (id, colegio_id, rol),

    CONSTRAINT chk_colegio_segun_rol CHECK (
        (rol = 'master' AND colegio_id IS NULL)
        OR (rol <> 'master' AND colegio_id IS NOT NULL)
    )
);

-- UNIQUE (colegio_id, email) no frena duplicados cuando colegio_id es NULL
-- (NULL <> NULL), así que los masters necesitan su propio índice único.
CREATE UNIQUE INDEX uq_usuarios_email_master ON usuarios (email) WHERE rol = 'master';
-- (colegio_id, email) ya queda indexado por su UNIQUE; sirve también para
-- buscar por colegio_id porque es la primera columna.


-- -----------------------------------------------------------------------------
-- cursos
-- -----------------------------------------------------------------------------

CREATE TABLE cursos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id  UUID NOT NULL REFERENCES colegios(id) ON DELETE RESTRICT,
    docente_id  UUID NOT NULL,
    -- Columna constante: existe solo para poder meter el rol en la FK de abajo.
    -- GENERATED ALWAYS impide que alguien inserte otro valor.
    docente_rol rol_usuario GENERATED ALWAYS AS ('docente'::rol_usuario) STORED,
    nombre      VARCHAR(150) NOT NULL,
    nivel       VARCHAR(50),
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- El docente debe existir, ser del MISMO colegio y tener rol 'docente'.
    CONSTRAINT fk_cursos_docente
        FOREIGN KEY (docente_id, colegio_id, docente_rol)
        REFERENCES usuarios (id, colegio_id, rol) ON DELETE RESTRICT,

    CONSTRAINT uq_cursos_id_colegio UNIQUE (id, colegio_id)
);

CREATE INDEX idx_cursos_colegio ON cursos (colegio_id);
CREATE INDEX idx_cursos_docente ON cursos (docente_id);


-- -----------------------------------------------------------------------------
-- matriculas
-- -----------------------------------------------------------------------------

CREATE TABLE matriculas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL,
    curso_id        UUID NOT NULL,
    estudiante_id   UUID NOT NULL,
    estudiante_rol  rol_usuario GENERATED ALWAYS AS ('estudiante'::rol_usuario) STORED,
    fecha_matricula TIMESTAMPTZ NOT NULL DEFAULT now(),
    activo          BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT fk_matriculas_curso
        FOREIGN KEY (curso_id, colegio_id)
        REFERENCES cursos (id, colegio_id) ON DELETE RESTRICT,

    -- Estudiante del mismo colegio que el curso, y con rol 'estudiante'.
    CONSTRAINT fk_matriculas_estudiante
        FOREIGN KEY (estudiante_id, colegio_id, estudiante_rol)
        REFERENCES usuarios (id, colegio_id, rol) ON DELETE RESTRICT,

    -- También es el destino de las FKs que exigen "el estudiante está matriculado".
    CONSTRAINT uq_matriculas_curso_estudiante UNIQUE (curso_id, estudiante_id)
);

-- curso_id ya está cubierto por el UNIQUE (es su primera columna).
CREATE INDEX idx_matriculas_estudiante ON matriculas (estudiante_id);
CREATE INDEX idx_matriculas_colegio ON matriculas (colegio_id);


-- -----------------------------------------------------------------------------
-- evaluaciones
-- -----------------------------------------------------------------------------

CREATE TYPE estado_evaluacion AS ENUM ('borrador', 'publicada', 'cerrada');

CREATE TABLE evaluaciones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id          UUID NOT NULL,
    curso_id            UUID NOT NULL,
    titulo              VARCHAR(150) NOT NULL,
    estado              estado_evaluacion NOT NULL DEFAULT 'borrador',
    fecha_publicacion   TIMESTAMPTZ,
    -- Nueva: permite rechazar envíos tardíos (la API compara now() con esto).
    fecha_cierre        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_evaluaciones_curso
        FOREIGN KEY (curso_id, colegio_id)
        REFERENCES cursos (id, colegio_id) ON DELETE RESTRICT,

    -- Una evaluación publicada o cerrada tiene que tener fecha de publicación.
    CONSTRAINT chk_evaluaciones_publicacion CHECK (
        estado = 'borrador' OR fecha_publicacion IS NOT NULL
    ),
    CONSTRAINT chk_evaluaciones_cierre CHECK (
        fecha_cierre IS NULL OR fecha_publicacion IS NULL OR fecha_cierre > fecha_publicacion
    ),

    -- Destinos de FKs compuestas desde preguntas e intentos.
    CONSTRAINT uq_evaluaciones_id_colegio UNIQUE (id, colegio_id),
    CONSTRAINT uq_evaluaciones_id_curso_colegio UNIQUE (id, curso_id, colegio_id)
);

CREATE INDEX idx_evaluaciones_curso ON evaluaciones (curso_id);
CREATE INDEX idx_evaluaciones_colegio ON evaluaciones (colegio_id);


-- -----------------------------------------------------------------------------
-- preguntas
-- -----------------------------------------------------------------------------

CREATE TABLE preguntas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL,
    evaluacion_id   UUID NOT NULL,
    enunciado       TEXT NOT NULL,
    orden           SMALLINT NOT NULL CHECK (orden > 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- CASCADE: una pregunta no existe sin su evaluación. Igual no se podrá
    -- borrar una evaluación ya respondida, porque respuestas_estudiante tiene
    -- RESTRICT hacia preguntas (ver más abajo).
    CONSTRAINT fk_preguntas_evaluacion
        FOREIGN KEY (evaluacion_id, colegio_id)
        REFERENCES evaluaciones (id, colegio_id) ON DELETE CASCADE,

    -- Dos preguntas no pueden tener el mismo número dentro de una evaluación.
    -- DEFERRABLE: para reordenar (intercambiar 1 y 2) dentro de una transacción
    -- se puede ejecutar SET CONSTRAINTS uq_preguntas_orden DEFERRED y la
    -- unicidad se verifica recién en el COMMIT.
    CONSTRAINT uq_preguntas_orden UNIQUE (evaluacion_id, orden)
        DEFERRABLE INITIALLY IMMEDIATE,

    CONSTRAINT uq_preguntas_id_colegio UNIQUE (id, colegio_id),
    CONSTRAINT uq_preguntas_id_evaluacion UNIQUE (id, evaluacion_id)
);

CREATE INDEX idx_preguntas_colegio ON preguntas (colegio_id);
-- evaluacion_id: cubierto por uq_preguntas_orden.


-- -----------------------------------------------------------------------------
-- alternativas
-- -----------------------------------------------------------------------------

CREATE TABLE alternativas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL,
    pregunta_id     UUID NOT NULL,
    texto           VARCHAR(300) NOT NULL,
    -- DATO SENSIBLE: nunca debe llegar al cliente de un estudiante antes de
    -- que la evaluación se cierre. Usar la vista alternativas_publicas.
    es_correcta     BOOLEAN NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_alternativas_pregunta
        FOREIGN KEY (pregunta_id, colegio_id)
        REFERENCES preguntas (id, colegio_id) ON DELETE CASCADE,

    -- Destino de la FK que garantiza "la alternativa elegida es de ESA pregunta".
    CONSTRAINT uq_alternativas_id_pregunta UNIQUE (id, pregunta_id)
);

CREATE INDEX idx_alternativas_pregunta ON alternativas (pregunta_id);
CREATE INDEX idx_alternativas_colegio ON alternativas (colegio_id);

-- Las preguntas son de selección única (respuestas_estudiante guarda UNA
-- alternativa), así que como máximo una alternativa correcta por pregunta.
-- "Al menos una" no se puede expresar con un índice: la API debe validarlo
-- al publicar la evaluación.
CREATE UNIQUE INDEX uq_alternativas_una_correcta
    ON alternativas (pregunta_id) WHERE es_correcta;

-- Lo que puede ver un estudiante: todo menos es_correcta.
-- security_invoker = true hace que la vista respete el RLS de quien consulta
-- (sin esto, la vista se ejecuta con los permisos de su dueño y salta el RLS).
CREATE VIEW alternativas_publicas WITH (security_invoker = true) AS
    SELECT id, colegio_id, pregunta_id, texto
    FROM alternativas;


-- -----------------------------------------------------------------------------
-- intentos_evaluacion
-- -----------------------------------------------------------------------------

CREATE TABLE intentos_evaluacion (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL,
    -- curso_id se denormaliza para poder exigir la matrícula con una FK.
    curso_id        UUID NOT NULL,
    evaluacion_id   UUID NOT NULL,
    estudiante_id   UUID NOT NULL,
    fecha_inicio    TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_envio     TIMESTAMPTZ,
    puntaje         NUMERIC(5,2),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- La evaluación debe ser de ese curso y ese colegio.
    CONSTRAINT fk_intentos_evaluacion
        FOREIGN KEY (evaluacion_id, curso_id, colegio_id)
        REFERENCES evaluaciones (id, curso_id, colegio_id) ON DELETE RESTRICT,

    -- El estudiante debe estar matriculado en ese curso. Como matriculas ya
    -- valida colegio y rol, esto cubre las tres cosas de una vez.
    CONSTRAINT fk_intentos_matricula
        FOREIGN KEY (curso_id, estudiante_id)
        REFERENCES matriculas (curso_id, estudiante_id) ON DELETE RESTRICT,

    CONSTRAINT uq_intentos_evaluacion_estudiante UNIQUE (evaluacion_id, estudiante_id),
    CONSTRAINT uq_intentos_id_evaluacion_colegio UNIQUE (id, evaluacion_id, colegio_id),

    CONSTRAINT chk_intentos_fechas CHECK (fecha_envio IS NULL OR fecha_envio >= fecha_inicio),
    -- Ajusten el máximo a la escala que definan (100 puntos, nota 1.0–7.0, etc.).
    CONSTRAINT chk_intentos_puntaje CHECK (puntaje IS NULL OR puntaje BETWEEN 0 AND 100),
    -- No hay puntaje sin envío.
    CONSTRAINT chk_intentos_puntaje_enviado CHECK (puntaje IS NULL OR fecha_envio IS NOT NULL)
);

CREATE INDEX idx_intentos_estudiante ON intentos_evaluacion (estudiante_id);
CREATE INDEX idx_intentos_curso_estudiante ON intentos_evaluacion (curso_id, estudiante_id);
CREATE INDEX idx_intentos_colegio ON intentos_evaluacion (colegio_id);
-- evaluacion_id: cubierto por uq_intentos_evaluacion_estudiante.


-- -----------------------------------------------------------------------------
-- respuestas_estudiante
-- -----------------------------------------------------------------------------

CREATE TABLE respuestas_estudiante (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id              UUID NOT NULL,
    -- evaluacion_id se denormaliza para amarrar intento y pregunta a la MISMA evaluación.
    evaluacion_id           UUID NOT NULL,
    intento_id              UUID NOT NULL,
    pregunta_id             UUID NOT NULL,
    alternativa_elegida_id  UUID,   -- NULL = pregunta sin responder
    -- Corrección CONGELADA al momento del envío (decisión intencional): si el
    -- docente cambia después la alternativa correcta, las respuestas ya
    -- corregidas no cambian solas. Recorregir debe ser una acción explícita.
    es_correcta             BOOLEAN,
    retroalimentacion       TEXT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- El intento pertenece a esta evaluación y este colegio.
    CONSTRAINT fk_respuestas_intento
        FOREIGN KEY (intento_id, evaluacion_id, colegio_id)
        REFERENCES intentos_evaluacion (id, evaluacion_id, colegio_id) ON DELETE CASCADE,

    -- La pregunta pertenece a la MISMA evaluación que el intento.
    CONSTRAINT fk_respuestas_pregunta
        FOREIGN KEY (pregunta_id, evaluacion_id)
        REFERENCES preguntas (id, evaluacion_id) ON DELETE RESTRICT,

    -- La alternativa elegida pertenece a ESA pregunta. Con MATCH SIMPLE (el
    -- default), si alternativa_elegida_id es NULL la FK no se evalúa.
    CONSTRAINT fk_respuestas_alternativa
        FOREIGN KEY (alternativa_elegida_id, pregunta_id)
        REFERENCES alternativas (id, pregunta_id) ON DELETE RESTRICT,

    CONSTRAINT uq_respuestas_intento_pregunta UNIQUE (intento_id, pregunta_id),

    -- Una pregunta sin responder no puede estar marcada como correcta.
    CONSTRAINT chk_respuestas_sin_alternativa CHECK (
        alternativa_elegida_id IS NOT NULL OR es_correcta IS NOT TRUE
    )
);

CREATE INDEX idx_respuestas_pregunta ON respuestas_estudiante (pregunta_id);
CREATE INDEX idx_respuestas_alternativa ON respuestas_estudiante (alternativa_elegida_id);
CREATE INDEX idx_respuestas_colegio ON respuestas_estudiante (colegio_id);
-- intento_id: cubierto por uq_respuestas_intento_pregunta.


-- -----------------------------------------------------------------------------
-- apuntes_curso
-- -----------------------------------------------------------------------------

CREATE TABLE apuntes_curso (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id  UUID NOT NULL,
    curso_id    UUID NOT NULL,
    titulo      VARCHAR(150) NOT NULL,
    contenido   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_apuntes_curso
        FOREIGN KEY (curso_id, colegio_id)
        REFERENCES cursos (id, colegio_id) ON DELETE RESTRICT,

    CONSTRAINT uq_apuntes_id_curso_colegio UNIQUE (id, curso_id, colegio_id)
);

CREATE INDEX idx_apuntes_curso ON apuntes_curso (curso_id);
CREATE INDEX idx_apuntes_colegio ON apuntes_curso (colegio_id);


-- -----------------------------------------------------------------------------
-- apuntes_embeddings
-- -----------------------------------------------------------------------------

CREATE TABLE apuntes_embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL,
    -- curso_id directamente aquí: la búsqueda del RAG SIEMPRE debe filtrar
    -- por curso, y así no depende de acordarse de hacer un JOIN.
    curso_id        UUID NOT NULL,
    apunte_id       UUID NOT NULL,
    chunk_indice    INTEGER NOT NULL CHECK (chunk_indice >= 0),
    chunk_texto     TEXT NOT NULL,
    -- La dimensión depende del modelo de embeddings: 768 es la de
    -- nomic-embed-text (Ollama). Si cambian de modelo, cambia este número
    -- y hay que regenerar todos los embeddings.
    embedding       vector(768) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Garantiza que curso_id/colegio_id coincidan con los del apunte.
    CONSTRAINT fk_embeddings_apunte
        FOREIGN KEY (apunte_id, curso_id, colegio_id)
        REFERENCES apuntes_curso (id, curso_id, colegio_id) ON DELETE CASCADE,

    CONSTRAINT uq_embeddings_apunte_chunk UNIQUE (apunte_id, chunk_indice)
);

CREATE INDEX idx_embeddings_curso ON apuntes_embeddings (curso_id);
CREATE INDEX idx_embeddings_colegio ON apuntes_embeddings (colegio_id);

-- Índice aproximado para búsqueda por similitud coseno (operador <=>).
-- Ojo: con un filtro WHERE curso_id = ..., HNSW busca primero los vecinos y
-- filtra después, así que puede devolver menos resultados de los pedidos.
-- Desde pgvector 0.8 se corrige con: SET hnsw.iterative_scan = relaxed_order;
CREATE INDEX idx_embeddings_hnsw
    ON apuntes_embeddings USING hnsw (embedding vector_cosine_ops);


-- -----------------------------------------------------------------------------
-- consultas_tutor_ia
-- -----------------------------------------------------------------------------
-- Guarda preguntas escritas por estudiantes, probablemente menores de edad.
-- Definan una política de retención (por ejemplo, borrar registros con más de
-- N meses con un job programado) y documéntenla.

CREATE TABLE consultas_tutor_ia (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL,
    curso_id        UUID NOT NULL,
    estudiante_id   UUID NOT NULL,
    pregunta        TEXT NOT NULL,
    respuesta       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_consultas_curso
        FOREIGN KEY (curso_id, colegio_id)
        REFERENCES cursos (id, colegio_id) ON DELETE RESTRICT,

    -- Solo puede consultar al tutor de un curso donde está matriculado.
    CONSTRAINT fk_consultas_matricula
        FOREIGN KEY (curso_id, estudiante_id)
        REFERENCES matriculas (curso_id, estudiante_id) ON DELETE RESTRICT
);

CREATE INDEX idx_consultas_estudiante ON consultas_tutor_ia (estudiante_id, created_at);
CREATE INDEX idx_consultas_curso_estudiante ON consultas_tutor_ia (curso_id, estudiante_id);
CREATE INDEX idx_consultas_colegio ON consultas_tutor_ia (colegio_id);
-- Para el job de retención (borrar por antigüedad).
CREATE INDEX idx_consultas_created ON consultas_tutor_ia (created_at);


-- -----------------------------------------------------------------------------
-- Triggers de updated_at
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'colegios', 'usuarios', 'cursos', 'evaluaciones', 'preguntas',
        'alternativas', 'intentos_evaluacion', 'respuestas_estudiante', 'apuntes_curso'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- ENABLE activa RLS; FORCE lo aplica incluso al dueño de las tablas (por
-- defecto el dueño lo salta). Los superusuarios y roles con BYPASSRLS siempre
-- lo saltan: esos son los únicos que deben hacer operaciones de plataforma.
--
-- Nota: las verificaciones de FK no pasan por RLS, así que las FKs compuestas
-- siguen funcionando aunque la fila padre no sea "visible" para la sesión.

ALTER TABLE colegios ENABLE ROW LEVEL SECURITY;
ALTER TABLE colegios FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_colegio ON colegios
    USING (id = app_colegio_id())
    WITH CHECK (id = app_colegio_id());

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'usuarios', 'cursos', 'matriculas', 'evaluaciones', 'preguntas',
        'alternativas', 'intentos_evaluacion', 'respuestas_estudiante',
        'apuntes_curso', 'apuntes_embeddings', 'consultas_tutor_ia'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        -- USING filtra lo que se puede leer/actualizar/borrar.
        -- WITH CHECK impide insertar o mover filas hacia otro colegio.
        EXECUTE format(
            'CREATE POLICY aislamiento_colegio ON %I
                 USING (colegio_id = app_colegio_id())
                 WITH CHECK (colegio_id = app_colegio_id())', t);
    END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- Roles de base de datos (referencia — ejecutar una vez por entorno)
-- -----------------------------------------------------------------------------
-- Se deja comentado porque los roles son del servidor, no de la base, y las
-- contraseñas no van en el repo.
--
-- -- Rol de la API: sin BYPASSRLS, no es dueño de las tablas.
-- CREATE ROLE feathersforall_app LOGIN PASSWORD :'app_password';
-- GRANT USAGE ON SCHEMA public TO feathersforall_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feathersforall_app;
--
-- -- Rol de plataforma (master): crear colegios, soporte, migraciones de datos.
-- CREATE ROLE feathersforall_plataforma LOGIN BYPASSRLS PASSWORD :'plataforma_password';
