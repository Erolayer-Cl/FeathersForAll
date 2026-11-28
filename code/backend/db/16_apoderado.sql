-- =============================================================================
-- FeathersForAll — panel del apoderado (PostgreSQL 16+), sobre 01–15
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 16_apoderado.sql
--
-- MVP 5: el apoderado sigue el avance de SUS pupilos (notas, promedios y evaluaciones pendientes). ADR 0018.
--
-- Diseño (mínimo privilegio, son datos de menores):
--   * El vínculo apoderado ↔ estudiante lo crea y lo quita SOLO el admin del colegio (apoderados_estudiantes).
--   * Para el RLS, el apoderado no ve NINGUNA tabla académica: puede_ver_curso() y puede_ver_estudiante() de 04
--     le responden false (ELSE). No ve cursos, apuntes, respuestas, conversaciones del tutor ni a otros estudiantes.
--   * Lo único que lee lo entregan tres funciones SECURITY DEFINER, cada una limitada a un pupilo VINCULADO en el
--     colegio de la sesión: sus ramos con promedio, sus notas y sus evaluaciones pendientes. Solo lectura.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vínculo apoderado ↔ estudiante
-- -----------------------------------------------------------------------------

CREATE TABLE apoderados_estudiantes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id      UUID NOT NULL DEFAULT app_colegio_id(),
    apoderado_id    UUID NOT NULL,
    apoderado_rol   rol_usuario GENERATED ALWAYS AS ('apoderado'::rol_usuario) STORED,
    estudiante_id   UUID NOT NULL,
    estudiante_rol  rol_usuario GENERATED ALWAYS AS ('estudiante'::rol_usuario) STORED,
    creado_por      UUID DEFAULT app_usuario_id(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Mismo colegio y el rol correcto en cada punta: declarativo, no se puede saltar.
    CONSTRAINT fk_apoderado
        FOREIGN KEY (apoderado_id, colegio_id, apoderado_rol) REFERENCES usuarios (id, colegio_id, rol) ON DELETE RESTRICT,
    CONSTRAINT fk_pupilo
        FOREIGN KEY (estudiante_id, colegio_id, estudiante_rol) REFERENCES usuarios (id, colegio_id, rol) ON DELETE RESTRICT,
    CONSTRAINT uq_apoderado_estudiante UNIQUE (apoderado_id, estudiante_id)
);

CREATE INDEX idx_apoderados_estudiante ON apoderados_estudiantes (estudiante_id);
CREATE INDEX idx_apoderados_colegio ON apoderados_estudiantes (colegio_id);

ALTER TABLE apoderados_estudiantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE apoderados_estudiantes FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_colegio ON apoderados_estudiantes
    USING (colegio_id = app_colegio_id())
    WITH CHECK (colegio_id = app_colegio_id());
CREATE POLICY rol_select ON apoderados_estudiantes AS RESTRICTIVE FOR SELECT
    USING (app_rol() = 'admin_colegio' OR (app_rol() = 'apoderado' AND apoderado_id = app_usuario_id()));
CREATE POLICY rol_insert ON apoderados_estudiantes AS RESTRICTIVE FOR INSERT WITH CHECK (app_rol() = 'admin_colegio');
CREATE POLICY rol_update ON apoderados_estudiantes AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY rol_delete ON apoderados_estudiantes AS RESTRICTIVE FOR DELETE USING (app_rol() = 'admin_colegio');


-- -----------------------------------------------------------------------------
-- 2. Usuarios: el apoderado ve solo su propia fila
-- -----------------------------------------------------------------------------
-- (La necesita SESION_VIGENTE en cada petición y su perfil.) Mismo contenido que 04 + el caso apoderado.

DROP POLICY rol_select ON usuarios;
CREATE POLICY rol_select ON usuarios AS RESTRICTIVE FOR SELECT
    USING (COALESCE(CASE app_rol()
        WHEN 'estudiante'    THEN id = app_usuario_id() OR rol NOT IN ('estudiante', 'apoderado')
        WHEN 'docente'       THEN true
        WHEN 'admin_colegio' THEN true
        WHEN 'servicio'      THEN true
        WHEN 'apoderado'     THEN id = app_usuario_id()
        ELSE false
    END, false));


-- -----------------------------------------------------------------------------
-- 2b. Ninguna tabla académica para el apoderado
-- -----------------------------------------------------------------------------
-- RESTRICTIVE (se suma con AND): en una sesión de apoderado, toda tabla con colegio_id queda vacía, salvo su
-- propia fila de usuarios, sus vínculos, su colegio, la bitácora (solo admin igual) y las claves de idempotencia.
-- Así, aunque una política futura olvide el caso, el apoderado no lee cursos, notas ni conversaciones directo.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
        WHERE c.table_schema = 'public' AND c.column_name = 'colegio_id' AND tb.table_type = 'BASE TABLE'
          AND c.table_name NOT IN ('usuarios', 'apoderados_estudiantes', 'auditoria', 'claves_idempotencia')
    LOOP
        EXECUTE format('CREATE POLICY sin_apoderado ON %I AS RESTRICTIVE FOR ALL
                            USING (app_rol() IS DISTINCT FROM ''apoderado'')
                            WITH CHECK (app_rol() IS DISTINCT FROM ''apoderado'')', t);
    END LOOP;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Lo que lee el apoderado (SECURITY DEFINER, solo pupilos vinculados)
-- -----------------------------------------------------------------------------
-- En producción su dueño debe ser feathersforall_plataforma (igual que 04, 08 y 13).

-- ¿p_estudiante es pupilo del apoderado de la sesión, en su colegio, y sigue activo?
CREATE FUNCTION es_mi_pupilo(p_estudiante uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(app_rol() = 'apoderado' AND EXISTS (
        SELECT 1
        FROM apoderados_estudiantes v
        JOIN usuarios e ON e.id = v.estudiante_id AND e.activo
        WHERE v.apoderado_id = app_usuario_id()
          AND v.estudiante_id = p_estudiante
          AND v.colegio_id = app_colegio_id()), false)
$$;

CREATE FUNCTION mis_pupilos()
RETURNS TABLE (estudiante_id uuid, nombre varchar)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT e.id, e.nombre
    FROM apoderados_estudiantes v
    JOIN usuarios e ON e.id = v.estudiante_id AND e.activo
    WHERE app_rol() = 'apoderado'
      AND v.apoderado_id = app_usuario_id()
      AND v.colegio_id = app_colegio_id()
    ORDER BY e.nombre, e.id
$$;

-- Ramos del pupilo con su docente y promedio ponderado (null si aún no tiene notas).
CREATE FUNCTION ramos_pupilo(p_estudiante uuid)
RETURNS TABLE (curso_id uuid, curso varchar, asignatura varchar, periodo varchar, docente varchar, promedio numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT c.id, c.nombre, c.asignatura, c.periodo, d.nombre,
           (SELECT round(sum(n.nota * n.ponderacion) / NULLIF(sum(n.ponderacion), 0), 1)
            FROM notas n WHERE n.curso_id = c.id AND n.estudiante_id = p_estudiante)
    FROM matriculas m
    JOIN cursos c   ON c.id = m.curso_id AND c.activo
    JOIN usuarios d ON d.id = c.docente_id
    WHERE es_mi_pupilo(p_estudiante)
      AND m.estudiante_id = p_estudiante AND m.activo
      AND c.colegio_id = app_colegio_id()
    ORDER BY c.nombre, c.id
$$;

-- Notas del pupilo (con las provisionales marcadas). Sin respuestas ni retroalimentación: solo el resultado.
CREATE FUNCTION notas_pupilo(p_estudiante uuid)
RETURNS TABLE (curso_id uuid, evaluacion_id uuid, evaluacion varchar, puntaje numeric, nota numeric,
               ponderacion numeric, fecha_envio timestamptz, por_revisar integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT n.curso_id, n.evaluacion_id, n.evaluacion, n.puntaje, n.nota, n.ponderacion, n.fecha_envio,
           (SELECT count(*) FROM respuestas_estudiante r WHERE r.intento_id = n.intento_id AND r.revision_pendiente)::int
    FROM notas n
    JOIN matriculas m ON m.curso_id = n.curso_id AND m.estudiante_id = n.estudiante_id AND m.activo
    WHERE es_mi_pupilo(p_estudiante)
      AND n.estudiante_id = p_estudiante
      AND n.colegio_id = app_colegio_id()
    ORDER BY n.fecha_envio
$$;

-- Evaluaciones publicadas que el pupilo todavía puede rendir (sin entregar y sin cierre vencido).
CREATE FUNCTION pendientes_pupilo(p_estudiante uuid)
RETURNS TABLE (curso_id uuid, evaluacion_id uuid, titulo varchar, fecha_cierre timestamptz, duracion_min integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT e.curso_id, e.id, e.titulo, e.fecha_cierre, e.duracion_min
    FROM evaluaciones e
    JOIN matriculas m ON m.curso_id = e.curso_id AND m.estudiante_id = p_estudiante AND m.activo
    WHERE es_mi_pupilo(p_estudiante)
      AND e.colegio_id = app_colegio_id()
      AND e.estado = 'publicada'
      AND (e.fecha_cierre IS NULL OR e.fecha_cierre > now())
      AND NOT EXISTS (SELECT 1 FROM intentos_evaluacion i
                      WHERE i.evaluacion_id = e.id AND i.estudiante_id = p_estudiante AND i.fecha_envio IS NOT NULL)
    ORDER BY e.fecha_cierre NULLS LAST, e.titulo
$$;

REVOKE ALL ON FUNCTION es_mi_pupilo(uuid), mis_pupilos(), ramos_pupilo(uuid), notas_pupilo(uuid), pendientes_pupilo(uuid) FROM PUBLIC;


-- -----------------------------------------------------------------------------
-- 4. Login: el apoderado entra con su correo, igual que estudiantes y docentes
-- -----------------------------------------------------------------------------

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
      AND u.rol IN ('estudiante', 'docente', 'admin_colegio', 'apoderado')
    ORDER BY u.created_at, u.id
    LIMIT 21
$$;

-- Los GRANT (EXECUTE de las funciones y el REVOKE de UPDATE del vínculo) están en permisos_app.sql.
