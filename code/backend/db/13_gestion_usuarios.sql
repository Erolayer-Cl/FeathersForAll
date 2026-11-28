-- =============================================================================
-- FeathersForAll — gestión de usuarios y ciclo de vida de la cuenta (PostgreSQL 16+), sobre 01–12
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 13_gestion_usuarios.sql
--
-- Hasta 12 el administrador no tenía cómo crear cuentas, desactivarlas ni restablecer claves desde
-- la API, y nadie podía cambiar su propia contraseña (ADR 0017). Esta migración agrega:
--   1. usuarios.sesiones_desde: los JWT emitidos ANTES de esa hora dejan de valer. Se fija sola al
--      cambiar la contraseña (trigger), así un restablecimiento corta las sesiones abiertas de la
--      cuenta en la siguiente petición (db.withUser, SESION_VIGENTE).
--   2. El rol y el colegio de una cuenta no se cambian desde la API (trigger): las FK compuestas
--      (docente_id, colegio_id, docente_rol) dependen de ellos y el historial de notas también.
--   3. cambiar_mi_clave(): la única forma de que un docente o estudiante actualice SU hash
--      (el RLS de 02 §9 solo deja al admin escribir en usuarios).
--   4. auditoria: quién hizo qué sobre las cuentas y otras acciones sensibles (R-1 del threat model).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Revocar sesiones al cambiar la contraseña
-- -----------------------------------------------------------------------------

ALTER TABLE usuarios ADD COLUMN sesiones_desde TIMESTAMPTZ;

-- Se trunca al segundo porque el `iat` del JWT está en segundos: un token emitido en el mismo
-- segundo del cambio (por ejemplo, el nuevo que entrega POST /v1/me/password) sigue valiendo.
CREATE FUNCTION fijar_sesiones_desde() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
        NEW.sesiones_desde := date_trunc('second', now());
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuarios_sesiones_desde BEFORE UPDATE OF password_hash ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fijar_sesiones_desde();


-- -----------------------------------------------------------------------------
-- 2. El rol y el colegio no cambian desde una sesión de la API
-- -----------------------------------------------------------------------------
-- Las operaciones de plataforma (feathersforall_plataforma, sin app.rol) sí pueden.

CREATE FUNCTION proteger_rol_usuario() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF app_rol() IS NOT NULL
       AND (NEW.rol IS DISTINCT FROM OLD.rol OR NEW.colegio_id IS DISTINCT FROM OLD.colegio_id) THEN
        RAISE EXCEPTION 'El rol y el colegio de una cuenta no se pueden cambiar'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_usuarios_proteger_rol BEFORE UPDATE OF rol, colegio_id ON usuarios
    FOR EACH ROW EXECUTE FUNCTION proteger_rol_usuario();


-- -----------------------------------------------------------------------------
-- 3. Cambiar la propia contraseña
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: actualiza solo la fila de la sesión (app.usuario_id + app.colegio_id). La API
-- ya verificó la clave actual con credenciales_login() antes de llamarla. Devuelve sesiones_desde.
-- En producción su dueño debe ser feathersforall_plataforma (igual que 04 y 08).

CREATE FUNCTION cambiar_mi_clave(p_hash text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_desde timestamptz;
BEGIN
    IF p_hash IS NULL OR p_hash NOT LIKE 'scrypt$%' THEN
        RAISE EXCEPTION 'Hash de contraseña no válido' USING ERRCODE = '22023';
    END IF;
    UPDATE usuarios
       SET password_hash = p_hash
     WHERE id = app_usuario_id()
       AND colegio_id = app_colegio_id()
       AND rol::text = app_rol()
       AND activo
    RETURNING sesiones_desde INTO v_desde;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay una cuenta activa en la sesión' USING ERRCODE = '42501';
    END IF;
    RETURN v_desde;
END;
$$;

REVOKE ALL ON FUNCTION cambiar_mi_clave(text) FROM PUBLIC;


-- -----------------------------------------------------------------------------
-- 4. Auditoría
-- -----------------------------------------------------------------------------
-- Solo se agrega: nadie la edita ni la borra desde la API. La lee el admin de su colegio.
-- `detalle` guarda datos de la acción (rol creado, activo sí/no), NUNCA contraseñas ni contenido.

CREATE TABLE auditoria (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colegio_id  UUID NOT NULL DEFAULT app_colegio_id() REFERENCES colegios (id) ON DELETE RESTRICT,
    actor_id    UUID NOT NULL DEFAULT app_usuario_id(),
    accion      VARCHAR(60) NOT NULL,
    recurso     VARCHAR(40) NOT NULL,
    recurso_id  UUID,
    detalle     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_auditoria_actor
        FOREIGN KEY (actor_id, colegio_id) REFERENCES usuarios (id, colegio_id) ON DELETE RESTRICT
);

CREATE INDEX idx_auditoria_colegio_fecha ON auditoria (colegio_id, created_at DESC);
CREATE INDEX idx_auditoria_recurso ON auditoria (recurso_id);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_colegio ON auditoria
    USING (colegio_id = app_colegio_id())
    WITH CHECK (colegio_id = app_colegio_id());
CREATE POLICY rol_select ON auditoria AS RESTRICTIVE FOR SELECT
    USING (app_rol() = 'admin_colegio');
-- Cada quien registra solo sus propias acciones.
CREATE POLICY rol_insert ON auditoria AS RESTRICTIVE FOR INSERT
    WITH CHECK (app_usuario_id() IS NOT NULL AND actor_id = app_usuario_id());
CREATE POLICY rol_update ON auditoria AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY rol_delete ON auditoria AS RESTRICTIVE FOR DELETE USING (false);

-- Los GRANT del rol de la API (sesiones_desde en el SELECT por columna, EXECUTE de
-- cambiar_mi_clave y solo SELECT/INSERT en auditoria) están en permisos_app.sql.
