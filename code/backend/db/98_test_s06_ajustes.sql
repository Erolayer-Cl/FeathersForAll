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
--
-- Nota: un UPDATE/DELETE bloqueado por RLS no da error, simplemente no afecta
-- filas. Por eso esas pruebas verifican "0 filas modificadas".
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

-- Cambia el usuario de la sesión dentro de la transacción (lo que hace la API tras verificar el JWT).
CREATE FUNCTION pg_temp.como(rol TEXT, usuario TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('app.rol', COALESCE(rol, ''), true);
    PERFORM set_config('app.usuario_id', COALESCE(usuario, ''), true);
END $$;

-- Datos base (como superusuario: salta RLS).
-- Colegio A: docente d1 (dueño de c1), docente d2, admin a1, estudiantes e1 y e2.
INSERT INTO colegios (id, nombre, rbd) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'Colegio A', '1111-1'),
    ('bbbbbbbb-0000-0000-0000-000000000000', 'Colegio B', '2222-2');
INSERT INTO usuarios (id, colegio_id, nombre, email, password_hash, rol) VALUES
    ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Docente 1', 'doc1@a.cl', 'x', 'docente'),
    ('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000000', 'Docente 2', 'doc2@a.cl', 'x', 'docente'),
    ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Admin A',   'admin@a.cl', 'x', 'admin_colegio'),
    ('aaaaaaaa-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Estudiante 1', 'est1@a.cl', 'x', 'estudiante'),
    ('aaaaaaaa-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000000', 'Estudiante 2', 'est2@a.cl', 'x', 'estudiante');

SET ROLE feathersforall_app;

-- ================================================================ login
SELECT pg_temp.debe_ser('colegio_por_rbd encuentra el colegio sin app.colegio_id',
    $$SELECT colegio_por_rbd('1111-1')::text$$, 'aaaaaaaa-0000-0000-0000-000000000000');
SELECT pg_temp.debe_ser('colegio_por_rbd de un RBD inexistente devuelve NULL',
    $$SELECT colegio_por_rbd('9999-9')::text$$, NULL);
SELECT pg_temp.debe_ser('sin app.colegio_id la API sigue sin ver colegios (fail-closed)',
    $$SELECT count(*)::text FROM colegios$$, '0');

BEGIN;
SET LOCAL app.colegio_id = 'aaaaaaaa-0000-0000-0000-000000000000';

-- ================================================================ cursos y periodo
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.debe_funcionar('docente crea SU curso (colegio_id por defecto)',
    $$INSERT INTO cursos (id, docente_id, nombre, periodo, asignatura)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Mate 7A', '2026-S2', 'Matemática')$$);
SELECT pg_temp.debe_fallar('docente crea un curso a nombre de OTRO docente',
    $$INSERT INTO cursos (docente_id, nombre, periodo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d2', 'X', '2026-S2')$$);
SELECT pg_temp.debe_fallar('curso con colegio_id de OTRO colegio (RLS WITH CHECK)',
    $$INSERT INTO cursos (colegio_id, docente_id, nombre, periodo)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'X', '2026-S2')$$);
SELECT pg_temp.debe_fallar('curso sin periodo',
    $$INSERT INTO cursos (docente_id, nombre) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'X')$$);
SELECT pg_temp.debe_fallar('periodo con formato inválido',
    $$INSERT INTO cursos (docente_id, nombre, periodo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'X', '2026-3')$$);

SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('estudiante crea un curso',
    $$INSERT INTO cursos (docente_id, nombre, periodo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000d1', 'X', '2026-S2')$$);

SELECT pg_temp.como('admin_colegio', 'aaaaaaaa-0000-0000-0000-0000000000a1');
SELECT pg_temp.debe_funcionar('admin crea un curso para el docente 2',
    $$INSERT INTO cursos (id, docente_id, nombre, periodo)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000000d2', 'Lenguaje 7A', '2026-S2')$$);

-- ================================================================ matrículas
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('estudiante se matricula solo',
    $$INSERT INTO matriculas (curso_id, estudiante_id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1')$$);
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d2');
SELECT pg_temp.debe_fallar('docente matricula en un curso que NO es suyo',
    $$INSERT INTO matriculas (curso_id, estudiante_id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1')$$);
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.debe_funcionar('docente matricula en SU curso',
    $$INSERT INTO matriculas (curso_id, estudiante_id) VALUES
      ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1'),
      ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e2')$$);

-- ================================================================ material (apuntes)
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('ESTUDIANTE sube material',
    $$INSERT INTO apuntes_curso (curso_id, titulo, contenido) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'Trampa', 'x')$$);
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d2');
SELECT pg_temp.debe_fallar('docente de OTRO curso sube material',
    $$INSERT INTO apuntes_curso (curso_id, titulo, contenido) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'X', 'x')$$);
SELECT pg_temp.como(NULL, NULL);
SELECT pg_temp.debe_fallar('sin app.rol nadie sube material (fail-closed)',
    $$INSERT INTO apuntes_curso (curso_id, titulo, contenido) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'X', 'x')$$);
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.debe_funcionar('docente del curso sube material',
    $$INSERT INTO apuntes_curso (id, curso_id, titulo, contenido)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Sumas', 'contenido')$$);
SELECT pg_temp.debe_ser('subido_por queda registrado con el docente de la sesión',
    $$SELECT subido_por::text FROM apuntes_curso WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000b1'$$,
    'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.como('admin_colegio', 'aaaaaaaa-0000-0000-0000-0000000000a1');
SELECT pg_temp.debe_funcionar('admin del colegio sube material a cualquier curso',
    $$INSERT INTO apuntes_curso (id, curso_id, titulo, contenido)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-0000000000c2', 'Otro curso', 'x')$$);
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_ser('estudiante SÍ puede leer el material de su colegio',
    $$SELECT count(*)::text FROM apuntes_curso$$, '2');
SELECT pg_temp.debe_ser('estudiante que intenta borrar material no borra nada',
    $$WITH x AS (DELETE FROM apuntes_curso WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000b1' RETURNING 1)
      SELECT count(*)::text FROM x$$, '0');

-- ================================================================ embeddings (bge-m3: 1024)
SELECT pg_temp.como('servicio', NULL);
SELECT pg_temp.debe_funcionar('worker (servicio) guarda un embedding de 1024 dimensiones',
    $$INSERT INTO apuntes_embeddings (curso_id, apunte_id, chunk_indice, chunk_texto, embedding)
      SELECT 'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 0, 'Sumar es...',
             (SELECT array_agg(0.01)::vector(1024) FROM generate_series(1, 1024))$$);
SELECT pg_temp.debe_fallar('embedding de 768 dimensiones (modelo equivocado)',
    $$INSERT INTO apuntes_embeddings (curso_id, apunte_id, chunk_indice, chunk_texto, embedding)
      SELECT 'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 1, 'x',
             (SELECT array_agg(0.01)::vector FROM generate_series(1, 768))$$);
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('estudiante inserta embeddings',
    $$INSERT INTO apuntes_embeddings (curso_id, apunte_id, chunk_indice, chunk_texto, embedding)
      SELECT 'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 2, 'x',
             (SELECT array_agg(0.01)::vector(1024) FROM generate_series(1, 1024))$$);

-- ================================================================ evaluaciones
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('ESTUDIANTE crea una evaluación',
    $$INSERT INTO evaluaciones (curso_id, titulo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'Trampa')$$);
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.debe_funcionar('docente crea evaluación y pregunta con retroalimentación',
    $$INSERT INTO evaluaciones (id, curso_id, titulo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Prueba');
      INSERT INTO preguntas (id, evaluacion_id, enunciado, orden, retroalimentacion)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000f9', 'aaaaaaaa-0000-0000-0000-0000000000a9', '¿2+2?', 1, 'Suma las unidades.');
      INSERT INTO alternativas (id, pregunta_id, texto, es_correcta)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000e9', 'aaaaaaaa-0000-0000-0000-0000000000f9', '4', true);
      UPDATE evaluaciones SET estado = 'publicada', fecha_publicacion = now() WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a9'$$);
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('estudiante agrega una alternativa a una pregunta',
    $$INSERT INTO alternativas (pregunta_id, texto) VALUES ('aaaaaaaa-0000-0000-0000-0000000000f9', '5')$$);
SELECT pg_temp.debe_ser('estudiante que intenta cambiar la respuesta correcta no modifica nada',
    $$WITH x AS (UPDATE alternativas SET es_correcta = false WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000e9' RETURNING 1)
      SELECT count(*)::text FROM x$$, '0');
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d2');
SELECT pg_temp.debe_fallar('docente de OTRO curso crea evaluación en c1',
    $$INSERT INTO evaluaciones (curso_id, titulo) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'X')$$);

-- ================================================================ rendir
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_fallar('estudiante abre un intento a nombre de OTRO estudiante',
    $$INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-0000000000e2')$$);
SELECT pg_temp.debe_funcionar('estudiante abre SU intento y responde',
    $$INSERT INTO intentos_evaluacion (id, curso_id, evaluacion_id, estudiante_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c9', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-0000000000e1');
      INSERT INTO respuestas_estudiante (evaluacion_id, intento_id, pregunta_id, alternativa_elegida_id, es_correcta, retroalimentacion)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-0000000000c9', 'aaaaaaaa-0000-0000-0000-0000000000f9',
              'aaaaaaaa-0000-0000-0000-0000000000e9', true, 'Suma las unidades.');
      UPDATE intentos_evaluacion SET fecha_envio = now(), puntaje = 100 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000c9'$$);
SELECT pg_temp.debe_ser('estudiante que intenta cambiarse la nota de un intento enviado no modifica nada',
    $$WITH x AS (UPDATE intentos_evaluacion SET puntaje = 0 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000c9' RETURNING 1)
      SELECT count(*)::text FROM x$$, '0');
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.debe_fallar('el docente no rinde evaluaciones',
    $$INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-0000000000e2')$$);

-- ================================================================ tutor asíncrono
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_funcionar('estudiante pregunta al tutor: consulta en cola sin respuesta (202)',
    $$INSERT INTO consultas_tutor_ia (id, curso_id, estudiante_id, pregunta)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1', '¿Por qué 2+2=4?')$$);
SELECT pg_temp.debe_fallar('estudiante pregunta a nombre de OTRO estudiante',
    $$INSERT INTO consultas_tutor_ia (curso_id, estudiante_id, pregunta)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e2', 'q')$$);
SELECT pg_temp.debe_fallar('consulta en cola con respuesta (estado incoherente)',
    $$INSERT INTO consultas_tutor_ia (curso_id, estudiante_id, pregunta, respuesta)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'q', 'r')$$);
SELECT pg_temp.debe_ser('estudiante que intenta escribir su propia respuesta no modifica nada',
    $$WITH x AS (UPDATE consultas_tutor_ia SET estado = 'respondida', respuesta = 'yo', respondida_at = now()
                 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1' RETURNING 1)
      SELECT count(*)::text FROM x$$, '0');

SELECT pg_temp.como('servicio', NULL);
SELECT pg_temp.debe_fallar('worker marca respondida sin texto de respuesta',
    $$UPDATE consultas_tutor_ia SET estado = 'respondida', respondida_at = now()
      WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1'$$);
SELECT pg_temp.debe_funcionar('worker marca la consulta como respondida y cita la fuente',
    $$UPDATE consultas_tutor_ia SET estado = 'respondida', respuesta = 'Porque...', con_respaldo = true, respondida_at = now()
      WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1';
      INSERT INTO consultas_fuentes (curso_id, consulta_id, apunte_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000b1')$$);
SELECT pg_temp.debe_fallar('fuente: apunte de OTRO curso',
    $$INSERT INTO consultas_fuentes (curso_id, consulta_id, apunte_id)
      VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000b2')$$);

-- ================================================================ outbox e idempotencia
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_funcionar('evento en outbox con el colegio de la sesión',
    $$INSERT INTO outbox_eventos (tipo, agregado_id, payload, trace_id)
      VALUES ('consulta_tutor.encolada', 'aaaaaaaa-0000-0000-0000-0000000000f1', '{"curso_id":"c1"}', 'tr-1')$$);
SELECT pg_temp.debe_fallar('evento en outbox de OTRO colegio',
    $$INSERT INTO outbox_eventos (colegio_id, tipo, agregado_id)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'curso.creado', gen_random_uuid())$$);
SELECT pg_temp.debe_fallar('tipo de evento que no sigue recurso.accion',
    $$INSERT INTO outbox_eventos (tipo, agregado_id) VALUES ('CrearCurso', gen_random_uuid())$$);
SELECT pg_temp.debe_funcionar('guardar clave de idempotencia',
    $$INSERT INTO claves_idempotencia (clave, usuario_id, operacion, status_http, respuesta)
      VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'POST /v1/courses/c1/tutor-questions', 202, '{"id":"f1"}')$$);
SELECT pg_temp.debe_fallar('reusar la misma clave en el mismo colegio',
    $$INSERT INTO claves_idempotencia (clave, usuario_id, operacion, status_http, respuesta)
      VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000e1', 'POST /v1/courses/c1/tutor-questions', 202, '{}')$$);

-- ================================================================ usuarios
SELECT pg_temp.como('docente', 'aaaaaaaa-0000-0000-0000-0000000000d1');
SELECT pg_temp.debe_fallar('docente crea usuarios',
    $$INSERT INTO usuarios (colegio_id, nombre, email, password_hash, rol)
      VALUES (app_colegio_id(), 'X', 'x@a.cl', 'x', 'estudiante')$$);
SELECT pg_temp.como('estudiante', 'aaaaaaaa-0000-0000-0000-0000000000e1');
SELECT pg_temp.debe_ser('estudiante que intenta ascenderse a admin no modifica nada',
    $$WITH x AS (UPDATE usuarios SET rol = 'admin_colegio' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000e1' RETURNING 1)
      SELECT count(*)::text FROM x$$, '0');
SELECT pg_temp.como('admin_colegio', 'aaaaaaaa-0000-0000-0000-0000000000a1');
SELECT pg_temp.debe_funcionar('admin crea un estudiante',
    $$INSERT INTO usuarios (colegio_id, nombre, email, password_hash, rol)
      VALUES (app_colegio_id(), 'Nuevo', 'nuevo@a.cl', 'x', 'estudiante')$$);

COMMIT;

-- ================================================================ fail-closed fuera de transacción
SELECT pg_temp.debe_ser('sin app.colegio_id: outbox vacía para la API',
    $$SELECT count(*)::text FROM outbox_eventos$$, '0');
SELECT pg_temp.debe_ser('sin app.colegio_id: fuentes vacías para la API',
    $$SELECT count(*)::text FROM consultas_fuentes$$, '0');
SELECT pg_temp.debe_fallar('sin app.colegio_id no se puede insertar (colegio_id NULL)',
    $$INSERT INTO outbox_eventos (tipo, agregado_id) VALUES ('curso.creado', gen_random_uuid())$$);

RESET ROLE;

-- ================================================================ relay de plataforma
SET ROLE feathersforall_plataforma;
SELECT pg_temp.debe_ser('el relay (plataforma) ve las pendientes de todos los colegios',
    $$SELECT count(*)::text FROM outbox_eventos WHERE publicado_at IS NULL$$, '1');
RESET ROLE;

-- ================================================================ resumen
DO $$
DECLARE total INT; malas INT;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO total, malas FROM pg_temp.resultados;
    IF malas > 0 THEN
        RAISE EXCEPTION '% de % pruebas fallaron', malas, total;
    END IF;
    RAISE NOTICE 'TODAS LAS PRUEBAS OK (%)', total;
END $$;
