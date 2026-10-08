-- Pruebas de integridad del esquema (S06). Uso, sobre una BD vacía con 01_schema.sql aplicado:
--   psql -d <bd> -f code/backend/db/test_integridad.sql
-- Cada caso marcado 'debe FALLAR' tiene que terminar en ERROR; los 'OK' no.
\set ON_ERROR_STOP 0
INSERT INTO colegios(id,nombre) VALUES ('00000000-0000-0000-0000-00000000000a','Colegio A'),('00000000-0000-0000-0000-00000000000b','Colegio B');
INSERT INTO usuarios(id,colegio_id,nombre,email,password_hash,rol) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','Doc A','doc@x.cl','h','docente'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','Est B','estb@x.cl','h','estudiante'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000b','Doc B','docb@x.cl','h','docente'),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-00000000000a','Est A','esta@x.cl','h','estudiante');
\echo '--- 7) email repetido en otro colegio -> debe FALLAR'
INSERT INTO usuarios(colegio_id,nombre,email,password_hash,rol) VALUES ('00000000-0000-0000-0000-00000000000b','Otro','DOC@x.cl','h','docente');
SET app.tenant_id = '00000000-0000-0000-0000-00000000000a';
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
INSERT INTO preguntas(id,evaluacion_id,enunciado,retroalimentacion) VALUES ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','P1','fb1'),('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','P otra ev','fb2');
INSERT INTO alternativas(id,pregunta_id,texto,es_correcta) VALUES ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','a',true),('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','b',false);
INSERT INTO intentos_evaluacion(id,evaluacion_id,estudiante_id,fecha_envio) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',now());
\echo '--- 4) alternativa de OTRA pregunta -> debe FALLAR'
INSERT INTO respuestas_estudiante(intento_id,evaluacion_id,pregunta_id,alternativa_elegida_id) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002');
\echo '--- 5) pregunta de OTRA evaluacion -> debe FALLAR'
INSERT INTO respuestas_estudiante(intento_id,evaluacion_id,pregunta_id) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');
\echo '--- OK) respuesta valida + puntaje por vista'
INSERT INTO respuestas_estudiante(intento_id,evaluacion_id,pregunta_id,alternativa_elegida_id) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
SELECT correctas,total_preguntas FROM v_puntajes;
\echo '--- 10) segunda alternativa correcta en la misma pregunta -> debe FALLAR'
INSERT INTO alternativas(pregunta_id,texto,es_correcta) VALUES ('40000000-0000-0000-0000-000000000001','c',true);
\echo '--- 9) borrar estudiante con notas -> debe FALLAR (se desactiva, no se borra)'
DELETE FROM usuarios WHERE id='10000000-0000-0000-0000-000000000004';
\echo '--- OK) consulta al tutor en cola y luego borrar colegio A completo -> debe FUNCIONAR'
INSERT INTO consultas_tutor_ia(estudiante_id,curso_id,pregunta) VALUES ('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','q');
DELETE FROM colegios WHERE id='00000000-0000-0000-0000-00000000000a';
SELECT (SELECT count(*) FROM cursos) cursos, (SELECT count(*) FROM consultas_tutor_ia) consultas, (SELECT count(*) FROM usuarios) usuarios;
\echo '--- 11) periodo invalido -> debe FALLAR'
SET app.tenant_id = '00000000-0000-0000-0000-00000000000b';
INSERT INTO cursos(docente_id,nombre,periodo) VALUES ('10000000-0000-0000-0000-000000000003','Y','2026');
\echo '--- 12) publicar sin fecha -> debe FALLAR'
INSERT INTO cursos(id,docente_id,nombre,periodo) VALUES ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000003','Curso B','2026-S2');
INSERT INTO evaluaciones(curso_id,titulo,estado) VALUES ('20000000-0000-0000-0000-0000000000b1','E','publicada');
\echo '--- 13) consulta respondida sin respuesta -> debe FALLAR'
INSERT INTO consultas_tutor_ia(estudiante_id,curso_id,pregunta,estado) VALUES ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-0000000000b1','q','respondida');
\echo '--- 14) sin app.tenant_id -> colegio_id NULL -> debe FALLAR'
RESET app.tenant_id;
INSERT INTO cursos(docente_id,nombre,periodo) VALUES ('10000000-0000-0000-0000-000000000003','Z','2026-S2');
