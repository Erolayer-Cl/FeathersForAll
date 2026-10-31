-- Pruebas de integridad del esquema (S06). Uso, sobre una BD vacía con 01 + 02 + 03 aplicados:
--   psql -d <bd> -f code/backend/db/test_integridad.sql
-- Cada caso marcado 'debe FALLAR' tiene que terminar en ERROR; los 'OK' no.
-- (Las pruebas automáticas con conteo de OK/FAIL están en 98_test_s06_ajustes.sql.)
\set ON_ERROR_STOP 0
INSERT INTO colegios(id,nombre) VALUES ('00000000-0000-0000-0000-00000000000a','Colegio A'),('00000000-0000-0000-0000-00000000000b','Colegio B');
INSERT INTO usuarios(id,colegio_id,nombre,email,password_hash,rol) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','Doc A','doc@x.cl','h','docente'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','Est B','estb@x.cl','h','estudiante'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000b','Doc B','docb@x.cl','h','docente'),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-00000000000a','Est A','esta@x.cl','h','estudiante');
\echo '--- 7) email repetido (otra mayúscula) en el MISMO colegio -> debe FALLAR (CITEXT)'
INSERT INTO usuarios(colegio_id,nombre,email,password_hash,rol) VALUES ('00000000-0000-0000-0000-00000000000a','Otro','DOC@x.cl','h','docente');
\echo '--- OK) el mismo email en OTRO colegio sí se permite'
INSERT INTO usuarios(colegio_id,nombre,email,password_hash,rol) VALUES ('00000000-0000-0000-0000-00000000000b','Otro','DOC@x.cl','h','docente');
SET app.colegio_id = '00000000-0000-0000-0000-00000000000a';
\echo '--- OK) curso valido en A'
INSERT INTO cursos(id,docente_id,nombre,periodo) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Curso A','2026-S2');
\echo '--- 1) curso de A con docente de B -> debe FALLAR'
INSERT INTO cursos(docente_id,nombre,periodo) VALUES ('10000000-0000-0000-0000-000000000003','X','2026-S2');
\echo '--- 2) estudiante de B en curso de A -> debe FALLAR'
INSERT INTO matriculas(curso_id,estudiante_id) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
\echo '--- 3) estudiante como docente -> debe FALLAR'
INSERT INTO cursos(docente_id,nombre,periodo) VALUES ('10000000-0000-0000-0000-000000000004','X','2026-S2');
\echo '--- OK) matricula, evaluacion, preguntas, alternativas, intento validos'
INSERT INTO matriculas(curso_id,estudiante_id) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004');
INSERT INTO evaluaciones(id,curso_id,titulo) VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Ev 1'),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Ev 2');
INSERT INTO preguntas(id,evaluacion_id,enunciado,orden,retroalimentacion) VALUES ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','P1',1,'fb1'),('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','P otra ev',1,'fb2');
INSERT INTO alternativas(id,pregunta_id,texto,es_correcta) VALUES ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','a',true),('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','b',false);
INSERT INTO intentos_evaluacion(id,curso_id,evaluacion_id,estudiante_id,fecha_envio) VALUES ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',now());
\echo '--- 4) alternativa de OTRA pregunta -> debe FALLAR'
INSERT INTO respuestas_estudiante(intento_id,evaluacion_id,pregunta_id,alternativa_elegida_id) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002');
\echo '--- 5) pregunta de OTRA evaluacion -> debe FALLAR'
INSERT INTO respuestas_estudiante(intento_id,evaluacion_id,pregunta_id) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');
\echo '--- OK) respuesta valida + puntaje y nota en la vista notas (esperado 100.00 / 7.0)'
INSERT INTO respuestas_estudiante(intento_id,evaluacion_id,pregunta_id,alternativa_elegida_id,es_correcta) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',true);
UPDATE intentos_evaluacion SET puntaje = 100 WHERE id='60000000-0000-0000-0000-000000000001';
SELECT puntaje, nota FROM notas WHERE intento_id='60000000-0000-0000-0000-000000000001';
\echo '--- 10) segunda alternativa correcta en la misma pregunta -> debe FALLAR'
INSERT INTO alternativas(pregunta_id,texto,es_correcta) VALUES ('40000000-0000-0000-0000-000000000001','c',true);
\echo '--- 9) borrar estudiante con notas -> debe FALLAR (se desactiva, no se borra)'
DELETE FROM usuarios WHERE id='10000000-0000-0000-0000-000000000004';
\echo '--- 8) borrar un colegio con datos -> debe FALLAR (RESTRICT: se usa activo = false)'
DELETE FROM colegios WHERE id='00000000-0000-0000-0000-00000000000a';
\echo '--- 11) periodo invalido -> debe FALLAR'
SET app.colegio_id = '00000000-0000-0000-0000-00000000000b';
INSERT INTO cursos(docente_id,nombre,periodo) VALUES ('10000000-0000-0000-0000-000000000003','Y','2026');
\echo '--- 12) publicar sin fecha -> debe FALLAR'
INSERT INTO cursos(id,docente_id,nombre,periodo) VALUES ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000003','Curso B','2026-S2');
INSERT INTO evaluaciones(curso_id,titulo,estado) VALUES ('20000000-0000-0000-0000-0000000000b1','E','publicada');
\echo '--- 13) consulta respondida sin respuesta -> debe FALLAR'
INSERT INTO matriculas(curso_id,estudiante_id) VALUES ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000002');
INSERT INTO consultas_tutor_ia(estudiante_id,curso_id,pregunta,estado) VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-0000000000b1','q','respondida');
\echo '--- 15) exigencia fuera de rango (100 %) -> debe FALLAR'
INSERT INTO evaluaciones(curso_id,titulo,exigencia) VALUES ('20000000-0000-0000-0000-0000000000b1','E',100);
\echo '--- 14) sin app.colegio_id -> colegio_id NULL -> debe FALLAR'
RESET app.colegio_id;
INSERT INTO cursos(docente_id,nombre,periodo) VALUES ('10000000-0000-0000-0000-000000000003','Z','2026-S2');
