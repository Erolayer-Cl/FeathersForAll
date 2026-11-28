-- =============================================================================
-- FeathersForAll — rol «apoderado» (PostgreSQL 16+), sobre 01–14
-- =============================================================================
--
--     psql -v ON_ERROR_STOP=1 -f 15_rol_apoderado.sql
--
-- Va sola en su archivo: PostgreSQL no deja USAR un valor nuevo de un enum en la misma transacción que lo
-- agrega. Las tablas, funciones y políticas que lo usan están en 16_apoderado.sql (MVP 5, ADR 0018).
-- =============================================================================

ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'apoderado';
