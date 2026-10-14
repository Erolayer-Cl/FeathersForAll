-- =============================================================================
-- Consultas de notas para ejecutar desde VS Code (extensión "PostgreSQL" de
-- Microsoft, SQLTools o Database Client) o con psql, sobre la base demo:
--     01 + 02 + 03 + 90_seed_demo.sql
-- =============================================================================
--
-- IMPORTANTE — el RLS:
--   * Conéctate como feathersforall_app (el mismo usuario que usa la API).
--     Si te conectas como postgres (superusuario) el RLS NO aplica y verás los
--     datos de TODOS los colegios; para evitarlo, el bloque 0 hace SET ROLE.
--   * Sin app.colegio_id no se ve ninguna fila (fail-closed): ejecuta primero
--     el bloque 0, en la MISMA conexión que las consultas.
--
-- Selecciona un bloque y ejecútalo (en la extensión de Microsoft: Ctrl+Shift+E).


-- ---------------------------------------------------------------------------
-- 0. Preparar la sesión: usuario de la app + Colegio Demo A
-- ---------------------------------------------------------------------------
SET ROLE feathersforall_app;          -- quita esta línea si ya te conectaste como feathersforall_app
SET app.colegio_id = '11111111-1111-1111-1111-111111111111';


-- ---------------------------------------------------------------------------
-- 1. Todas las notas del colegio (vista notas: solo intentos ENVIADOS)
-- ---------------------------------------------------------------------------
SELECT c.nombre AS curso, n.evaluacion, u.nombre AS estudiante,
       n.puntaje, n.exigencia, n.nota, n.ponderacion, n.fecha_envio
FROM notas n
JOIN cursos c   ON c.id = n.curso_id
JOIN usuarios u ON u.id = n.estudiante_id
ORDER BY curso, n.evaluacion, estudiante;


-- ---------------------------------------------------------------------------
-- 2. Libro de notas de Matemáticas: una fila por estudiante, una columna por evaluación
-- ---------------------------------------------------------------------------
SELECT u.nombre AS estudiante,
       max(n.nota) FILTER (WHERE n.evaluacion = 'Fracciones')        AS fracciones,
       max(n.nota) FILTER (WHERE n.evaluacion = 'Números decimales') AS decimales,
       round(sum(n.nota * n.ponderacion) / NULLIF(sum(n.ponderacion), 0), 1) AS promedio
FROM matriculas m
JOIN usuarios u ON u.id = m.estudiante_id
LEFT JOIN notas n ON n.curso_id = m.curso_id AND n.estudiante_id = m.estudiante_id
WHERE m.curso_id = 'c0000000-0000-0000-0000-000000000001' AND m.activo
GROUP BY u.nombre
ORDER BY u.nombre;


-- ---------------------------------------------------------------------------
-- 3. Promedio ponderado de cada estudiante en cada curso
-- ---------------------------------------------------------------------------
SELECT c.nombre AS curso, u.nombre AS estudiante,
       count(*) AS evaluaciones_rendidas,
       round(sum(n.nota * n.ponderacion) / sum(n.ponderacion), 1) AS promedio
FROM notas n
JOIN cursos c   ON c.id = n.curso_id
JOIN usuarios u ON u.id = n.estudiante_id
GROUP BY c.nombre, u.nombre
ORDER BY curso, promedio DESC;


-- ---------------------------------------------------------------------------
-- 4. Estudiantes en riesgo (promedio < 4.0) en cualquier curso
-- ---------------------------------------------------------------------------
SELECT c.nombre AS curso, u.nombre AS estudiante,
       round(sum(n.nota * n.ponderacion) / sum(n.ponderacion), 1) AS promedio
FROM notas n
JOIN cursos c   ON c.id = n.curso_id
JOIN usuarios u ON u.id = n.estudiante_id
GROUP BY c.nombre, u.nombre
HAVING round(sum(n.nota * n.ponderacion) / sum(n.ponderacion), 1) < 4.0
ORDER BY promedio;


-- ---------------------------------------------------------------------------
-- 5. Estadísticas por evaluación (entregas, promedio, mínima, máxima, aprobados)
-- ---------------------------------------------------------------------------
SELECT e.titulo, e.estado,
       count(n.intento_id)                   AS entregas,
       round(avg(n.nota), 1)                 AS promedio,
       min(n.nota)                           AS minima,
       max(n.nota)                           AS maxima,
       count(*) FILTER (WHERE n.nota >= 4.0) AS aprobados,
       count(*) FILTER (WHERE n.nota <  4.0) AS reprobados
FROM evaluaciones e
LEFT JOIN notas n ON n.evaluacion_id = e.id
WHERE e.estado <> 'borrador'
GROUP BY e.id
ORDER BY e.fecha_publicacion;


-- ---------------------------------------------------------------------------
-- 6. Tasa de acierto por pregunta de "Números decimales" (solo intentos enviados:
--    el intento a medias de Tomás no cuenta)
-- ---------------------------------------------------------------------------
SELECT p.orden, p.enunciado,
       count(r.id) AS respuestas,
       round(avg(CASE WHEN r.es_correcta THEN 1 ELSE 0 END), 2) AS tasa_acierto
FROM preguntas p
LEFT JOIN (respuestas_estudiante r
           JOIN intentos_evaluacion i ON i.id = r.intento_id AND i.fecha_envio IS NOT NULL)
       ON r.pregunta_id = p.id
WHERE p.evaluacion_id = 'd0000000-0000-0000-0000-000000000002'
GROUP BY p.id
ORDER BY p.orden;


-- ---------------------------------------------------------------------------
-- 7. Tabla de conversión puntaje -> nota con exigencia 60 % y 50 %
-- ---------------------------------------------------------------------------
SELECT p AS puntaje,
       nota_desde_puntaje(p, 60) AS nota_exigencia_60,
       nota_desde_puntaje(p, 50) AS nota_exigencia_50
FROM generate_series(0, 100, 10) AS p;


-- ---------------------------------------------------------------------------
-- 8. Probar el aislamiento entre colegios (RLS)
-- ---------------------------------------------------------------------------
-- 8a. Colegio B: solo ve SUS notas (Javiera, Diagnóstico).
SET app.colegio_id = '22222222-2222-2222-2222-222222222222';
SELECT evaluacion, estudiante_id, nota FROM notas;

-- 8b. Sin colegio: no ve NADA (0 filas), aunque la tabla tiene datos.
RESET app.colegio_id;
SELECT count(*) AS filas_visibles FROM notas;

-- 8c. Volver al Colegio Demo A.
SET app.colegio_id = '11111111-1111-1111-1111-111111111111';


-- ---------------------------------------------------------------------------
-- 9. Simular un cambio de exigencia SIN guardarlo (ROLLBACK)
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE evaluaciones SET exigencia = 50 WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT estudiante_id, puntaje, nota FROM notas
WHERE evaluacion_id = 'd0000000-0000-0000-0000-000000000001'
ORDER BY puntaje DESC;
ROLLBACK;   -- deshace el cambio


-- ---------------------------------------------------------------------------
-- 10. Volver al usuario original (si usaste SET ROLE en el bloque 0)
-- ---------------------------------------------------------------------------
RESET ROLE;
