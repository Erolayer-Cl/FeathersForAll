// Consultas SQL de AulaViva / FeathersForAll (S06), sobre 01_schema.sql + 02_s06_ajustes.sql + 03_notas.sql
// + 04_privacidad_login.sql (privacidad de lectura por usuario: sin app.rol no se ven datos de estudiantes).
// Módulo ESM (el backend usa "type": "module"):  import { LOGIN } from './db/queries.js'
//
// Cómo se ejecutan (ver CAMBIOS_SCHEMA.md):
//  * Rol feathersforall_app, dentro de una transacción, con los datos del JWT VERIFICADO
//    (en el backend: db.withUser(req.user, fn), ver src/platform/db.js):
//        BEGIN;
//        SET LOCAL app.colegio_id = '<colegio>';
//        SET LOCAL app.usuario_id = '<usuario>';
//        SET LOCAL app.rol        = 'docente' | 'estudiante' | 'admin_colegio';
//        ...; COMMIT;
//    colegio_id NO se manda en los INSERT: lo pone el DEFAULT app_colegio_id(),
//    y RLS + FKs compuestas rechazan cualquier mezcla entre colegios.
//    Permisos por rol (02_s06_ajustes.sql §9): material, evaluaciones y matrículas
//    solo docente del curso o admin; usuarios solo admin; intentos, respuestas y
//    consultas al tutor solo el propio estudiante. Un UPDATE/DELETE sin permiso
//    no da error: afecta 0 filas -> la API debe responder 403/404.
//  * Worker (indexar apuntes, responder al tutor): mismo rol de BD, con
//    app.colegio_id del evento y app.rol = 'servicio' (sin app.usuario_id).
//  * Las marcadas [plataforma] usan feathersforall_plataforma (BYPASSRLS):
//    master, relay de la outbox y jobs de limpieza.

// --- Identidad y login -----------------------------------------------------------

// Paso 1 (sin app.colegio_id): RBD del subdominio/selector -> id del colegio.
export const COLEGIO_POR_RBD = `
SELECT colegio_por_rbd($1) AS colegio_id`;

// Paso 2 (ya con SET LOCAL app.colegio_id): el email es único POR colegio (CITEXT).
// La API no puede leer password_hash directo (permisos_app.sql): solo con esta función (04).
export const LOGIN = `
SELECT id, nombre, email, rol, password_hash
FROM credenciales_login($1)`;

// Perfil del usuario de la sesión (GET /v1/me y respuesta del login).
export const PERFIL = `
SELECT u.id, u.nombre, u.email, u.rol, c.id AS colegio_id, c.nombre AS colegio, c.rbd
FROM usuarios u
JOIN colegios c ON c.id = u.colegio_id
WHERE u.id = $1 AND u.activo`;

// [plataforma] Login del master (no tiene colegio).
export const LOGIN_MASTER = `
SELECT id, nombre, email, password_hash, rol
FROM usuarios
WHERE email = $1 AND rol = 'master' AND activo`;

export const CREAR_USUARIO = `
INSERT INTO usuarios (colegio_id, nombre, email, password_hash, rol)
VALUES (app_colegio_id(), $1, $2, $3, $4)
RETURNING id, nombre, email, rol`;

// Borrado lógico (las FK son RESTRICT: no se pierde historial).
export const DESACTIVAR_USUARIO = `
UPDATE usuarios SET activo = false WHERE id = $1
RETURNING id`;

// --- Gestión académica (H1) -------------------------------------------------------

export const CREAR_CURSO = `
INSERT INTO cursos (docente_id, nombre, periodo, asignatura, nivel)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, nombre, periodo, asignatura, nivel, created_at`;

// Columnas de un curso para la API (contrato: schema Course).
//   matriculados       -> students_count (la API solo lo muestra al personal: para un estudiante,
//                         el RLS de 04 cuenta solo su propia matrícula)
//   apuntes            -> tutor_documents: apuntes que el docente subió al RAG del curso
//   tutor_disponible   -> tutor_available: hay fragmentos indexados, así que el tutor puede responder
const COLUMNAS_CURSO = `
       c.id, c.nombre, c.periodo, c.asignatura, c.nivel, c.docente_id, d.nombre AS docente, c.created_at,
       (SELECT count(*) FROM matriculas m WHERE m.curso_id = c.id AND m.activo) AS matriculados,
       (SELECT count(*) FROM apuntes_curso a WHERE a.curso_id = c.id) AS apuntes,
       EXISTS (SELECT 1 FROM apuntes_embeddings e WHERE e.curso_id = c.id) AS tutor_disponible`;

// Cursos que ve la sesión (GET /v1/courses): el admin, todos los de su colegio; el docente,
// los que dicta; el estudiante, en los que tiene matrícula activa (puede_ver_curso, 04).
// $1 = periodo (NULL = todos), $2 = tamaño de página.
// Paginación keyset por (periodo DESC, nombre, id): $3, $4, $5 = última fila de la página
// anterior (NULL en la primera página).
export const CURSOS_VISIBLES = `
SELECT ${COLUMNAS_CURSO}
FROM cursos c
JOIN usuarios d ON d.id = c.docente_id
WHERE puede_ver_curso(c.id)
  AND ($1::text IS NULL OR c.periodo = $1)
  AND ($3::text IS NULL OR c.periodo < $3 OR (c.periodo = $3 AND (c.nombre, c.id) > ($4::text, $5::uuid)))
ORDER BY c.periodo DESC, c.nombre, c.id
LIMIT $2`;

// Un curso, solo si la sesión lo puede ver (GET /v1/courses/{id}). Si no, 0 filas -> 404.
export const CURSO_DETALLE = `
SELECT ${COLUMNAS_CURSO}
FROM cursos c
JOIN usuarios d ON d.id = c.docente_id
WHERE c.id = $1 AND puede_ver_curso(c.id)`;

// [plataforma]
export const CURSOS_MASTER = `
SELECT c.id, c.nombre, c.periodo, c.nivel, col.nombre AS colegio
FROM cursos c
JOIN colegios col ON col.id = c.colegio_id
ORDER BY col.nombre, c.nombre`;

// Matrícula por correo (contrato S05). Si el estudiante no existe en ESTE colegio
// (RLS) o no es estudiante, no inserta nada -> el backend responde 404.
export const MATRICULAR_POR_EMAIL = `
INSERT INTO matriculas (curso_id, estudiante_id)
SELECT $1, u.id
FROM usuarios u
WHERE u.email = $2 AND u.rol = 'estudiante' AND u.activo
RETURNING id, curso_id, estudiante_id, fecha_matricula`;

// --- Evaluaciones (H2) -----------------------------------------------------------

export const CREAR_EVALUACION = `
INSERT INTO evaluaciones (curso_id, titulo, fecha_cierre)
VALUES ($1, $2, $3)
RETURNING id, estado, created_at`;

export const CREAR_PREGUNTA = `
INSERT INTO preguntas (evaluacion_id, enunciado, orden, retroalimentacion)
VALUES ($1, $2, $3, $4)
RETURNING id`;

export const CREAR_ALTERNATIVA = `
INSERT INTO alternativas (pregunta_id, texto, es_correcta)
VALUES ($1, $2, $3)
RETURNING id`;

// La BD garantiza "como máximo una correcta"; "al menos una" lo valida la API
// antes de publicar: si esto devuelve filas -> 422.
export const PREGUNTAS_SIN_CORRECTA = `
SELECT p.id, p.orden
FROM preguntas p
WHERE p.evaluacion_id = $1
  AND NOT EXISTS (SELECT 1 FROM alternativas a WHERE a.pregunta_id = p.id AND a.es_correcta)
ORDER BY p.orden`;

export const PUBLICAR_EVALUACION = `
UPDATE evaluaciones
SET estado = 'publicada', fecha_publicacion = now()
WHERE id = $1 AND estado = 'borrador'
RETURNING id, estado, fecha_publicacion, fecha_cierre`;

export const CERRAR_EVALUACION = `
UPDATE evaluaciones SET estado = 'cerrada'
WHERE id = $1 AND estado = 'publicada'
RETURNING id, estado`;

export const EVALUACIONES_PUBLICADAS = `
SELECT id, titulo, fecha_publicacion, fecha_cierre
FROM evaluaciones
WHERE curso_id = $1 AND estado = 'publicada'
ORDER BY fecha_publicacion DESC`;

// --- Rendir (H4) ---------------------------------------------------------------------

// Lo que ve el estudiante: alternativas SIN es_correcta (vista alternativas_publicas).
export const PREGUNTAS_PARA_RENDIR = `
SELECT p.id, p.orden, p.enunciado,
       json_agg(json_build_object('id', a.id, 'texto', a.texto) ORDER BY a.id) AS alternativas
FROM preguntas p
JOIN alternativas_publicas a ON a.pregunta_id = p.id
WHERE p.evaluacion_id = $1
GROUP BY p.id
ORDER BY p.orden`;

// Solo si está publicada, no venció y la matrícula está ACTIVA. curso_id se toma
// de la evaluación. La FK a matriculas solo exige que la matrícula exista (no mira
// activo), por eso el JOIN: un estudiante dado de baja no puede rendir.
export const CREAR_INTENTO = `
INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id)
SELECT e.curso_id, e.id, m.estudiante_id
FROM evaluaciones e
JOIN matriculas m ON m.curso_id = e.curso_id AND m.estudiante_id = $2 AND m.activo
WHERE e.id = $1
  AND e.estado = 'publicada'
  AND (e.fecha_cierre IS NULL OR now() < e.fecha_cierre)
RETURNING id`;

// Corrección CONGELADA: copia es_correcta y la retroalimentación de la pregunta
// al momento de responder. $3 NULL = pregunta sin responder (no es correcta).
// No acepta respuestas si la evaluación ya no está publicada o venció.
export const INSERTAR_RESPUESTA = `
INSERT INTO respuestas_estudiante
    (evaluacion_id, intento_id, pregunta_id, alternativa_elegida_id, es_correcta, retroalimentacion)
SELECT i.evaluacion_id, i.id, p.id, a.id, COALESCE(a.es_correcta, false), p.retroalimentacion
FROM intentos_evaluacion i
JOIN evaluaciones e ON e.id = i.evaluacion_id
JOIN preguntas p ON p.id = $2 AND p.evaluacion_id = i.evaluacion_id
LEFT JOIN alternativas a ON a.id = $3 AND a.pregunta_id = p.id
WHERE i.id = $1 AND i.fecha_envio IS NULL
  AND e.estado = 'publicada'
  AND (e.fecha_cierre IS NULL OR now() < e.fecha_cierre)
RETURNING id, es_correcta, retroalimentacion`;

// Cierra el intento y guarda el puntaje (0–100) a partir de las respuestas congeladas.
export const ENVIAR_INTENTO = `
UPDATE intentos_evaluacion i
SET fecha_envio = now(),
    puntaje = (
        SELECT round(100.0 * count(*) FILTER (WHERE r.es_correcta)
                     / NULLIF((SELECT count(*) FROM preguntas p WHERE p.evaluacion_id = i.evaluacion_id), 0), 2)
        FROM respuestas_estudiante r
        WHERE r.intento_id = i.id
    )
WHERE i.id = $1 AND i.fecha_envio IS NULL
RETURNING id, puntaje, fecha_envio`;

// --- Resultados (H3, H4) -----------------------------------------------------------

export const MIS_NOTAS = `
SELECT e.titulo, i.puntaje, i.fecha_envio
FROM intentos_evaluacion i
JOIN evaluaciones e ON e.id = i.evaluacion_id
WHERE i.estudiante_id = $1 AND i.fecha_envio IS NOT NULL
ORDER BY i.fecha_envio DESC`;

// LEFT JOIN: también muestra las preguntas sin responder.
// Solo intentos ENVIADOS: si no, un estudiante vería qué respuestas lleva
// correctas mientras todavía está rindiendo.
export const DETALLE_NOTA = `
SELECT p.orden, p.enunciado, a.texto AS respuesta_elegida,
       COALESCE(r.es_correcta, false) AS es_correcta,
       COALESCE(r.retroalimentacion, p.retroalimentacion) AS retroalimentacion
FROM intentos_evaluacion i
JOIN preguntas p ON p.evaluacion_id = i.evaluacion_id
LEFT JOIN respuestas_estudiante r ON r.intento_id = i.id AND r.pregunta_id = p.id
LEFT JOIN alternativas_publicas a ON a.id = r.alternativa_elegida_id
WHERE i.estudiante_id = $1 AND i.evaluacion_id = $2 AND i.fecha_envio IS NOT NULL
ORDER BY p.orden`;

export const DASHBOARD_EVALUACION = `
SELECT u.nombre AS estudiante, i.puntaje, i.fecha_envio
FROM intentos_evaluacion i
JOIN usuarios u ON u.id = i.estudiante_id
WHERE i.evaluacion_id = $1 AND i.fecha_envio IS NOT NULL
ORDER BY i.puntaje DESC NULLS LAST, u.nombre`;

// Solo cuentan intentos enviados (un intento a medias no es un resultado).
export const ACIERTO_POR_PREGUNTA = `
SELECT p.id AS pregunta_id, p.orden,
       count(r.id) AS respuestas,
       COALESCE(avg(CASE WHEN r.es_correcta THEN 1 ELSE 0 END), 0) AS tasa_acierto
FROM preguntas p
LEFT JOIN (respuestas_estudiante r
           JOIN intentos_evaluacion i ON i.id = r.intento_id AND i.fecha_envio IS NOT NULL)
       ON r.pregunta_id = p.id
WHERE p.evaluacion_id = $1
GROUP BY p.id, p.orden
ORDER BY p.orden`;

// --- Notas (03_notas.sql) ----------------------------------------------------------
// La nota (1.0–7.0) sale de la vista `notas`, que la calcula desde el puntaje y la
// exigencia de la evaluación. Promedios PONDERADOS por evaluaciones.ponderacion y
// solo sobre evaluaciones entregadas (una evaluación no rendida no promedia).

// Acceso a un curso: la API decide con esto si el usuario puede verlo.
export const CURSO_ACCESO = `
SELECT c.id, c.nombre, c.docente_id,
       EXISTS (SELECT 1 FROM matriculas m
               WHERE m.curso_id = c.id AND m.estudiante_id = $2 AND m.activo) AS matriculado
FROM cursos c
WHERE c.id = $1 AND c.activo`;

export const EVALUACION_ACCESO = `
SELECT e.id, e.curso_id, e.titulo, e.estado, e.exigencia, e.ponderacion, c.docente_id
FROM evaluaciones e
JOIN cursos c ON c.id = e.curso_id
WHERE e.id = $1`;

// Ramos del estudiante (GET /v1/me/grades): TODOS sus cursos con matrícula activa, tengan o no
// notas todavía, con su docente y si el tutor tiene apuntes. $2 NULL = todos los ramos.
export const RAMOS_ESTUDIANTE = `
SELECT c.id AS curso_id, c.nombre AS curso, c.asignatura, c.periodo, d.nombre AS docente,
       EXISTS (SELECT 1 FROM apuntes_embeddings e WHERE e.curso_id = c.id) AS tutor_disponible
FROM matriculas m
JOIN cursos c   ON c.id = m.curso_id
JOIN usuarios d ON d.id = c.docente_id
WHERE m.estudiante_id = $1 AND m.activo AND c.activo
  AND ($2::uuid IS NULL OR c.id = $2)
ORDER BY c.nombre`;

// Mis notas (estudiante), opcionalmente de un solo curso ($2 NULL = todos).
export const NOTAS_ESTUDIANTE = `
SELECT n.curso_id, c.nombre AS curso, n.evaluacion_id, n.evaluacion,
       n.puntaje, n.nota, n.ponderacion, n.fecha_envio,
       round(sum(n.nota * n.ponderacion) OVER w / sum(n.ponderacion) OVER w, 1) AS promedio_curso
FROM notas n
JOIN cursos c ON c.id = n.curso_id
WHERE n.estudiante_id = $1 AND ($2::uuid IS NULL OR n.curso_id = $2)
WINDOW w AS (PARTITION BY n.curso_id)
ORDER BY c.nombre, n.fecha_envio`;

// Columnas del libro de notas: evaluaciones ya publicadas (los borradores no tienen notas).
export const LIBRO_NOTAS_EVALUACIONES = `
SELECT id, titulo, estado, exigencia, ponderacion, fecha_publicacion
FROM evaluaciones
WHERE curso_id = $1 AND estado <> 'borrador'
ORDER BY fecha_publicacion, titulo`;

// Filas del libro de notas: una por (estudiante activo, nota). LEFT JOIN para que
// aparezca también quien todavía no tiene notas.
export const LIBRO_NOTAS_ESTUDIANTES = `
SELECT u.id AS estudiante_id, u.nombre, n.evaluacion_id, n.puntaje, n.nota,
       round(sum(n.nota * n.ponderacion) OVER w / NULLIF(sum(n.ponderacion) OVER w, 0), 1) AS promedio
FROM matriculas m
JOIN usuarios u ON u.id = m.estudiante_id
LEFT JOIN notas n ON n.curso_id = m.curso_id AND n.estudiante_id = m.estudiante_id
WHERE m.curso_id = $1 AND m.activo
WINDOW w AS (PARTITION BY u.id)
ORDER BY u.nombre, u.id`;

// Estadísticas por evaluación: entregas, promedio, mínima, máxima, aprobados (>= 4.0).
export const RESUMEN_NOTAS_CURSO = `
SELECT e.id AS evaluacion_id, e.titulo, e.estado,
       count(n.intento_id)                       AS entregas,
       round(avg(n.nota), 1)                     AS promedio,
       min(n.nota)                               AS nota_minima,
       max(n.nota)                               AS nota_maxima,
       count(*) FILTER (WHERE n.nota >= 4.0)     AS aprobados,
       count(*) FILTER (WHERE n.nota <  4.0)     AS reprobados
FROM evaluaciones e
LEFT JOIN notas n ON n.evaluacion_id = e.id
WHERE e.curso_id = $1 AND e.estado <> 'borrador'
GROUP BY e.id
ORDER BY e.fecha_publicacion, e.titulo`;

export const MATRICULADOS_ACTIVOS = `
SELECT count(*) AS total FROM matriculas WHERE curso_id = $1 AND activo`;

// Estudiantes activos con promedio ponderado bajo el umbral ($2, normalmente 4.0).
export const ESTUDIANTES_EN_RIESGO = `
SELECT u.id AS estudiante_id, u.nombre,
       round(sum(n.nota * n.ponderacion) / sum(n.ponderacion), 1) AS promedio,
       count(*) AS evaluaciones_rendidas
FROM notas n
JOIN matriculas m ON m.curso_id = n.curso_id AND m.estudiante_id = n.estudiante_id AND m.activo
JOIN usuarios u ON u.id = n.estudiante_id
WHERE n.curso_id = $1
GROUP BY u.id, u.nombre
HAVING round(sum(n.nota * n.ponderacion) / sum(n.ponderacion), 1) < $2
ORDER BY promedio, u.nombre`;

// Dashboard de una evaluación (contrato S05: getAssessmentResults).
export const RESULTADOS_EVALUACION_RESUMEN = `
SELECT count(*) AS entregas, round(avg(puntaje), 2) AS puntaje_promedio, round(avg(nota), 1) AS nota_promedio
FROM notas
WHERE evaluacion_id = $1`;

// $2 NULL = todos los estudiantes; si no, solo ese.
export const RESULTADOS_EVALUACION_ESTUDIANTES = `
SELECT n.estudiante_id, u.nombre, n.puntaje, n.nota, n.fecha_envio
FROM notas n
JOIN usuarios u ON u.id = n.estudiante_id
WHERE n.evaluacion_id = $1 AND ($2::uuid IS NULL OR n.estudiante_id = $2)
ORDER BY u.nombre`;

// Nota de UN estudiante en UNA evaluación (cabecera del detalle).
export const NOTA_ESTUDIANTE_EVALUACION = `
SELECT evaluacion_id, evaluacion, puntaje, nota, exigencia, ponderacion, fecha_envio
FROM notas
WHERE estudiante_id = $1 AND evaluacion_id = $2`;

// Cambiar exigencia o ponderación: las notas se recalculan solas (la vista las deriva).
export const ACTUALIZAR_CALIFICACION = `
UPDATE evaluaciones
SET exigencia = COALESCE($2, exigencia), ponderacion = COALESCE($3, ponderacion)
WHERE id = $1
RETURNING id, titulo, exigencia, ponderacion`;

// --- Tutor IA (H5) -------------------------------------------------------------------

export const CREAR_APUNTE = `
INSERT INTO apuntes_curso (curso_id, titulo, contenido)
VALUES ($1, $2, $3)
RETURNING id, created_at`;

export const APUNTES_CURSO = `
SELECT id, titulo, contenido, created_at
FROM apuntes_curso
WHERE curso_id = $1
ORDER BY created_at DESC`;

// [servicio] $5 = embedding como texto '[0.1, 0.2, ...]' (1024 valores, bge-m3).
export const INSERTAR_EMBEDDING = `
INSERT INTO apuntes_embeddings (curso_id, apunte_id, chunk_indice, chunk_texto, embedding)
VALUES ($1, $2, $3, $4, $5::vector)
ON CONFLICT (apunte_id, chunk_indice) DO UPDATE
SET chunk_texto = EXCLUDED.chunk_texto, embedding = EXCLUDED.embedding`;

// RAG: SIEMPRE filtra por curso (y RLS por colegio). Distancia coseno (<=>).
export const BUSCAR_CHUNKS = `
SELECT apunte_id, chunk_indice, chunk_texto, embedding <=> $2::vector AS distancia
FROM apuntes_embeddings
WHERE curso_id = $1
ORDER BY embedding <=> $2::vector
LIMIT $3`;

// Paso 1 (API, una transacción): consulta en cola + evento en la outbox -> 202.
// Igual que CREAR_INTENTO: solo con matrícula activa (si no, 0 filas -> 403).
export const ENCOLAR_CONSULTA_TUTOR = `
INSERT INTO consultas_tutor_ia (curso_id, estudiante_id, pregunta)
SELECT m.curso_id, m.estudiante_id, $3
FROM matriculas m
WHERE m.curso_id = $1 AND m.estudiante_id = $2 AND m.activo
RETURNING id, estado, created_at`;

export const INSERTAR_OUTBOX = `
INSERT INTO outbox_eventos (tipo, version, agregado_id, payload, trace_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id`;

// Paso 2 [servicio] (worker, con SET LOCAL app.colegio_id del evento y app.rol = 'servicio').
export const RESPONDER_CONSULTA_TUTOR = `
UPDATE consultas_tutor_ia
SET estado = 'respondida', respuesta = $2, con_respaldo = $3, respondida_at = now()
WHERE id = $1 AND estado = 'en_cola'
RETURNING id`;

export const MARCAR_CONSULTA_FALLIDA = `
UPDATE consultas_tutor_ia
SET estado = 'fallida', respondida_at = now()
WHERE id = $1 AND estado = 'en_cola'
RETURNING id`;

export const AGREGAR_FUENTE_CONSULTA = `
INSERT INTO consultas_fuentes (curso_id, consulta_id, apunte_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING`;

export const OBTENER_CONSULTA_TUTOR = `
SELECT c.id, c.curso_id, c.estado, c.pregunta, c.respuesta, c.con_respaldo,
       c.created_at, c.respondida_at,
       COALESCE(json_agg(json_build_object('note_id', a.id, 'title', a.titulo))
                FILTER (WHERE a.id IS NOT NULL), '[]') AS fuentes
FROM consultas_tutor_ia c
LEFT JOIN consultas_fuentes f ON f.consulta_id = c.id
LEFT JOIN apuntes_curso a ON a.id = f.apunte_id
WHERE c.id = $1
GROUP BY c.id`;

export const HISTORIAL_TUTOR_IA = `
SELECT id, curso_id, estado, pregunta, respuesta, created_at
FROM consultas_tutor_ia
WHERE estudiante_id = $1
ORDER BY created_at DESC`;

// --- Idempotency-Key (contrato S05) ----------------------------------------------------

export const IDEMPOTENCIA_BUSCAR = `
SELECT operacion, status_http, respuesta
FROM claves_idempotencia
WHERE clave = $1 AND creada_at > now() - interval '24 hours'`;

export const IDEMPOTENCIA_GUARDAR = `
INSERT INTO claves_idempotencia (clave, usuario_id, operacion, status_http, respuesta)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING`;

// [plataforma] Job diario.
export const IDEMPOTENCIA_PURGAR = `
DELETE FROM claves_idempotencia WHERE creada_at < now() - interval '24 hours'`;

// --- Outbox relay [plataforma] ---------------------------------------------------------

// SKIP LOCKED: varios workers leen la outbox sin tomar el mismo evento.
export const OUTBOX_PENDIENTES = `
SELECT id, colegio_id, tipo, version, agregado_id, payload, trace_id, creado_at
FROM outbox_eventos
WHERE publicado_at IS NULL
ORDER BY creado_at
LIMIT $1
FOR UPDATE SKIP LOCKED`;

export const OUTBOX_MARCAR_PUBLICADO = `
UPDATE outbox_eventos SET publicado_at = now() WHERE id = $1`;

export const OUTBOX_REINTENTO = `
UPDATE outbox_eventos SET intentos = intentos + 1 WHERE id = $1`;

// --- Conversaciones del Tutor IA (05_conversaciones_tutor.sql, ADR 0008) ---------------
// Solo el estudiante dueño las ve y escribe: lo exige el RLS, así que estas consultas
// no filtran por estudiante a mano (otro usuario simplemente obtiene 0 filas).

// Mis conversaciones de un curso, la más reciente primero. $2 = máximo de filas.
export const CONVERSACIONES_CURSO = `
SELECT c.id, c.curso_id, c.modo, c.titulo, c.created_at, c.updated_at,
       (SELECT count(*) FROM mensajes_tutor m WHERE m.conversacion_id = c.id) AS mensajes
FROM conversaciones_tutor c
WHERE c.curso_id = $1
ORDER BY c.updated_at DESC
LIMIT $2`;

export const CONVERSACION = `
SELECT id, curso_id, modo, titulo, created_at, updated_at
FROM conversaciones_tutor
WHERE id = $1`;

// Historial en orden; $2 = cuántos mensajes como máximo (los más recientes).
export const MENSAJES_CONVERSACION = `
SELECT rol, contenido, fuentes, created_at
FROM (SELECT * FROM mensajes_tutor WHERE conversacion_id = $1 ORDER BY orden DESC LIMIT $2) m
ORDER BY orden`;

// Primer mensaje: crea la conversación. colegio_id y estudiante_id los pone la base (DEFAULT).
// ON CONFLICT DO NOTHING: si el id ya existe (de este u otro usuario) no se toca nada.
export const CREAR_CONVERSACION = `
INSERT INTO conversaciones_tutor (id, curso_id, modo, titulo)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO NOTHING
RETURNING id`;

export const INSERTAR_MENSAJE = `
INSERT INTO mensajes_tutor (conversacion_id, rol, contenido, fuentes)
VALUES ($1, $2, $3, $4::jsonb)`;

export const TOCAR_CONVERSACION = `
UPDATE conversaciones_tutor SET updated_at = now() WHERE id = $1`;

export const BORRAR_CONVERSACION = `
DELETE FROM conversaciones_tutor WHERE id = $1`;

// [plataforma] Job de retención (fin del año escolar): ver src/jobs/purgar-conversaciones.js.
export const CONVERSACIONES_PURGAR = `
SELECT purgar_conversaciones_tutor() AS borradas`;
