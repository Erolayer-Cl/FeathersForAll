-- =============================================================================
-- Pruebas de 02_s06_ajustes.sql (PostgreSQL 16 + pgvector)
-- =============================================================================
-- Ejecutar en una base de PRUEBA vacía (crea datos y roles de prueba):
--
--     createdb feathersforall_test
--     psql -d feathersforall_test -v ON_ERROR_STOP=1 \
--          -f 01_schema.sql -f 02_s06_ajustes.sql -f 98_test_s06_ajustes.sql
--
-- Debe ejecutarse con un superusuario (crea roles). Cada prueba imprime
-- "OK  ..." y al final se lanza un error si alguna falló.
-- =============================================================================

\set ON_ERROR_STOP 1
SET client_min_messages = notice;
\pset tuples_only on
\pset format unaligned

-- Roles de prueba (mismos nombres que el bloque de referencia).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_app') THEN
        CREATE ROLE feathersforall_app;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feathersforall_plataforma') THEN
        CREATE ROLE feathersforall_plataforma BYPASSRLS;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO feathersforall_app, feathersforall_plataforma;
GRANT CREATE ON SCHEMA public TO feathersforall_plataforma;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO feathersforall_app;
GRANT SELECT ON colegios TO feathersforall_plataforma;
GRANT SELECT, UPDATE ON outbox_eventos TO feathersforall_plataforma;
ALTER FUNCTION colegio_por_rbd(TEXT) OWNER TO feathersforall_plataforma;
GRANT EXECUTE ON FUNCTION colegio_por_rbd(TEXT) TO feathersforall_app;

-- Utilidades de prueba (temporales, desaparecen al cerrar la sesión).
CREATE TABLE pg_temp.resultados (n SERIAL, ok BOOLEAN, nombre TEXT);
GRANT ALL ON pg_temp.resultados TO PUBLIC;
GRANT ALL ON SEQUENCE pg_temp.resultados_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.debe_fallar(nombre TEXT, sql TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE sql;
        INSERT INTO pg_temp.resultados (ok, nombre) VALUES (false, nombre);
        RAISE NOTICE 'FAIL %  (se esperaba error y no lo hubo)', nombre;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO pg_temp.resultados (ok, nombre) VALUES (true, nombre);
        RAISE NOTICE 'OK   %  -> %', nombre, SQLERRM;
    END;
END $$;

CREATE FUNCTION pg_temp.debe_funcionar(nombre TEXT, sql TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE sql;
    INSERT INTO pg_temp.resultados (ok, nombre) VALUES (true, nombre);
    RAISE NOTICE 'OK   %', nombre;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp.resultados (ok, nombre) VALUES (false, nombre);
    RAISE NOTICE 'FAIL %  -> %', nombre, SQLERRM;
END $$;

CREATE FUNCTION pg_temp.debe_ser(nombre TEXT, sql TEXT, esperado TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r TEXT;
BEGIN
    EXECUTE sql INTO r;
    INSERT INTO pg_temp.resultados (ok, nombre) VALUES (r IS NOT DISTINCT FROM esperado, nombre);
    RAISE NOTICE '%  %  (obtenido: %, esperado: %)',
        CASE WHEN r IS NOT DISTINCT FROM esperado THEN 'OK  ' ELSE 'FAIL' END, nombre, r, esperado;
END $$;

-- Datos base (como superusuario: salta RLS).
INSERT INTO colegios (id, nombre, rbd) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'Colegio A', '1111-1'),
    ('bbbbbbbb-0000-0000-0000-000000000000', 'Colegio B', '2222-2');
INSERT INTO usuarios (id, colegio_id, nombre, email, password_hash, rol) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Docente A', 'doc@a.cl', 'x', 'docente'),
    ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Estudiante A', 'est@a.cl', 'x', 'estudiante');

SET ROLE feathersforall_app;

-- ---------------------------------------------------------------- login
SELECT pg_temp.debe_ser('colegio_por_rbd encuentra el colegio sin app.colegio_id',
    $$SELECT colegio_por_rbd('1111-1')::text$$, 'aaaaaaaa-0000-0000-0000-000000000000');
SELECT pg_temp.debe_ser('colegio_por_rbd de un RBD inexistente devuelve NULL',
    $$SELECT colegio_por_rbd('9999-9')::text$$, NULL);
SELECT pg_temp.debe_ser('sin app.colegio_id la API sigue sin ver colegios (fail-closed)',
    $$SELECT count(*)::text FROM colegios$$, '0');

BEGIN;
SET LOCAL app.colegio_id = 'aaaaaaaa-0000-0000-0000-000000000000';

-- ---------------------------------------------------------------- 1. DEFAULT colegio_id
SELECT pg_temp.debe_funcionar('curso sin colegio_id explícito toma el de la sesión',
    $$INSERT INTO cursos (id, docente_id, nombre, periodo, asignatura)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Mate 7A', '2026-S2', 'Matemática')$$);
SELECT pg_temp.debe_fallar('curso con colegio_id de OTRO colegio (RLS WITH CHECK)',
    $$INSERT INTO cursos (colegio_id, docente_id, nombre, periodo)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'X', '2026-S2')$$);

-- ---------------------------------------------------------------- 2. periodo
SELECT pg_temp.debe_fallar('curso sin periodo',
    $$INSERT INTO cursos (docente_id, nombre) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'X')$$);
SELECT pg_temp.debe_fallar('periodo con formato inválido',
    $$INSERT INTO cursos (docente_id, nombre, periodo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'X', '2026-3')$$);

INSERT INTO matriculas (curso_id, estudiante_id)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1');

-- ---------------------------------------------------------------- 3. retroalimentación
SELECT pg_temp.debe_funcionar('pregunta con retroalimentación del docente',
    $$INSERT INTO evaluaciones (id, curso_id, titulo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Prueba');
      INSERT INTO preguntas (evaluacion_id, enunciado, orden, retroalimentacion)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1', '¿2+2?', 1, 'Suma las unidades.')$$);

-- ---------------------------------------------------------------- 4. tutor asíncrono
SELECT pg_temp.debe_funcionar('consulta en cola sin respuesta (202 del contrato)',
    $$INSERT INTO consultas_tutor_ia (id, curso_id, estudiante_id, pregunta)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1', '¿Por qué 2+2=4?')$$);
SELECT pg_temp.debe_fallar('consulta respondida sin texto de respuesta',
    $$UPDATE consultas_tutor_ia SET estado = 'respondida', respondida_at = now()
      WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1'$$);
SELECT pg_temp.debe_fallar('consulta en cola con respuesta (estado incoherente)',
    $$INSERT INTO consultas_tutor_ia (curso_id, estudiante_id, pregunta, respuesta)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'q', 'r')$$);
SELECT pg_temp.debe_funcionar('worker marca la consulta como respondida',
    $$UPDATE consultas_tutor_ia SET estado = 'respondida', respuesta = 'Porque...', con_respaldo = true, respondida_at = now()
      WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1'$$);

INSERT INTO apuntes_curso (id, curso_id, titulo, contenido)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Sumas', 'contenido');
SELECT pg_temp.debe_funcionar('fuente: apunte del mismo curso',
    $$INSERT INTO consultas_fuentes (curso_id, consulta_id, apunte_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000b1')$$);

INSERT INTO cursos (id, docente_id, nombre, periodo)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Lenguaje 7A', '2026-S2');
INSERT INTO apuntes_curso (id, curso_id, titulo, contenido)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-0000000000c2', 'Otro curso', 'x');
SELECT pg_temp.debe_fallar('fuente: apunte de OTRO curso',
    $$INSERT INTO consultas_fuentes (curso_id, consulta_id, apunte_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000b2')$$);

-- ---------------------------------------------------------------- 5. outbox
SELECT pg_temp.debe_funcionar('evento en outbox con el colegio de la sesión',
    $$INSERT INTO outbox_eventos (tipo, agregado_id, payload, trace_id)
      VALUES ('consulta_tutor.encolada', 'aaaaaaaa-0000-0000-0000-0000000000f1', '{"curso_id":"c1"}', 'tr-1')$$);
SELECT pg_temp.debe_fallar('evento en outbox de OTRO colegio',
    $$INSERT INTO outbox_eventos (colegio_id, tipo, agregado_id)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'curso.creado', gen_random_uuid())$$);
SELECT pg_temp.debe_fallar('tipo de evento que no sigue recurso.accion',
    $$INSERT INTO outbox_eventos (tipo, agregado_id) VALUES ('CrearCurso', gen_random_uuid())$$);

-- ---------------------------------------------------------------- 6. idempotencia
SELECT pg_temp.debe_funcionar('guardar clave de idempotencia',
    $$INSERT INTO claves_idempotencia (clave, usuario_id, operacion, status_http, respuesta)
      VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'POST /v1/courses', 201, '{"id":"c1"}')$$);
SELECT pg_temp.debe_fallar('reusar la misma clave en el mismo colegio',
    $$INSERT INTO claves_idempotencia (clave, usuario_id, operacion, status_http, respuesta)
      VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'POST /v1/courses', 201, '{}')$$);

COMMIT;

-- ---------------------------------------------------------------- fail-closed en tablas nuevas
SELECT pg_temp.debe_ser('sin app.colegio_id: outbox vacía para la API',
    $$SELECT count(*)::text FROM outbox_eventos$$, '0');
SELECT pg_temp.debe_ser('sin app.colegio_id: fuentes vacías para la API',
    $$SELECT count(*)::text FROM consultas_fuentes$$, '0');
SELECT pg_temp.debe_fallar('sin app.colegio_id no se puede insertar (colegio_id NULL)',
    $$INSERT INTO outbox_eventos (tipo, agregado_id) VALUES ('curso.creado', gen_random_uuid())$$);

RESET ROLE;

-- ---------------------------------------------------------------- relay de plataforma
SET ROLE feathersforall_plataforma;
SELECT pg_temp.debe_ser('el relay (plataforma) ve las pendientes de todos los colegios',
    $$SELECT count(*)::text FROM outbox_eventos WHERE publicado_at IS NULL$$, '1');
RESET ROLE;

-- ---------------------------------------------------------------- resumen
DO $$
DECLARE total INT; malas INT;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO total, malas FROM pg_temp.resultados;
    IF malas > 0 THEN
        RAISE EXCEPTION '% de % pruebas fallaron', malas, total;
    END IF;
    RAISE NOTICE 'TODAS LAS PRUEBAS OK (%)', total;
END $$;
