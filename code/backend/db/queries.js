// Consultas SQL de AulaViva / FeathersForAll (S06), sobre 01_schema.sql + 02_s06_ajustes.sql.
// Módulo ESM (el backend usa "type": "module"):  import { LOGIN } from './db/queries.js'
//
// Cómo se ejecutan (ver CAMBIOS_SCHEMA.md):
//  * Rol feathersforall_app, dentro de una transacción:
//        BEGIN; SET LOCAL app.colegio_id = '<colegio del JWT>'; ...; COMMIT;
//    colegio_id NO se manda en los INSERT: lo pone el DEFAULT app_colegio_id(),
//    y RLS + FKs compuestas rechazan cualquier mezcla entre colegios.
//  * Las marcadas [plataforma] usan feathersforall_plataforma (BYPASSRLS):
//    master, relay de la outbox y jobs de limpieza.

// --- Identidad y login -----------------------------------------------------------

// Paso 1 (sin app.colegio_id): RBD del subdominio/selector -> id del colegio.
export const COLEGIO_POR_RBD = `
SELECT colegio_por_rbd($1) AS colegio_id`;

// Paso 2 (ya con SET LOCAL app.colegio_id): el email es único POR colegio (CITEXT).
export const LOGIN = `
SELECT id, colegio_id, nombre, email, password_hash, rol
FROM usuarios
WHERE email = $1 AND activo`;

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

export const CURSOS_DOCENTE = `
SELECT id, nombre, periodo, asignatura, nivel
FROM cursos
WHERE docente_id = $1 AND activo
ORDER BY periodo DESC, nombre`;

export const CURSOS_ESTUDIANTE = `
SELECT c.id, c.nombre, c.periodo, c.asignatura, c.nivel
FROM cursos c
JOIN matriculas m ON m.curso_id = c.id
WHERE m.estudiante_id = $1 AND m.activo AND c.activo
ORDER BY c.periodo DESC, c.nombre`;

// RLS ya filtra por colegio: no hace falta WHERE colegio_id.
export const CURSOS_COLEGIO = `
SELECT c.id, c.nombre, c.periodo, c.nivel, u.nombre AS docente
FROM cursos c
JOIN usuarios u ON u.id = c.docente_id
WHERE c.activo
ORDER BY c.periodo DESC, c.nombre`;

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

// Solo si está publicada y no venció. curso_id se toma de la evaluación; la FK a
// matriculas rechaza al estudiante no matriculado.
export const CREAR_INTENTO = `
INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id)
SELECT e.curso_id, e.id, $2
FROM evaluaciones e
WHERE e.id = $1
  AND e.estado = 'publicada'
  AND (e.fecha_cierre IS NULL OR now() < e.fecha_cierre)
RETURNING id`;

// Corrección CONGELADA: copia es_correcta y la retroalimentación de la pregunta
// al momento de responder. $3 NULL = pregunta sin responder (no es correcta).
export const INSERTAR_RESPUESTA = `
INSERT INTO respuestas_estudiante
    (evaluacion_id, intento_id, pregunta_id, alternativa_elegida_id, es_correcta, retroalimentacion)
SELECT i.evaluacion_id, i.id, p.id, a.id, COALESCE(a.es_correcta, false), p.retroalimentacion
FROM intentos_evaluacion i
JOIN preguntas p ON p.id = $2 AND p.evaluacion_id = i.evaluacion_id
LEFT JOIN alternativas a ON a.id = $3 AND a.pregunta_id = p.id
WHERE i.id = $1 AND i.fecha_envio IS NULL
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
export const DETALLE_NOTA = `
SELECT p.orden, p.enunciado, a.texto AS respuesta_elegida,
       COALESCE(r.es_correcta, false) AS es_correcta,
       COALESCE(r.retroalimentacion, p.retroalimentacion) AS retroalimentacion
FROM intentos_evaluacion i
JOIN preguntas p ON p.evaluacion_id = i.evaluacion_id
LEFT JOIN respuestas_estudiante r ON r.intento_id = i.id AND r.pregunta_id = p.id
LEFT JOIN alternativas_publicas a ON a.id = r.alternativa_elegida_id
WHERE i.estudiante_id = $1 AND i.evaluacion_id = $2
ORDER BY p.orden`;

export const DASHBOARD_EVALUACION = `
SELECT u.nombre AS estudiante, i.puntaje, i.fecha_envio
FROM intentos_evaluacion i
JOIN usuarios u ON u.id = i.estudiante_id
WHERE i.evaluacion_id = $1 AND i.fecha_envio IS NOT NULL
ORDER BY i.puntaje DESC NULLS LAST, u.nombre`;

export const ACIERTO_POR_PREGUNTA = `
SELECT p.id AS pregunta_id, p.orden,
       count(r.id) AS respuestas,
       COALESCE(avg(CASE WHEN r.es_correcta THEN 1 ELSE 0 END), 0) AS tasa_acierto
FROM preguntas p
LEFT JOIN respuestas_estudiante r ON r.pregunta_id = p.id
WHERE p.evaluacion_id = $1
GROUP BY p.id, p.orden
ORDER BY p.orden`;

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

// $5 = embedding como texto '[0.1, 0.2, ...]' (768 valores, nomic-embed-text).
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
export const ENCOLAR_CONSULTA_TUTOR = `
INSERT INTO consultas_tutor_ia (curso_id, estudiante_id, pregunta)
VALUES ($1, $2, $3)
RETURNING id, estado, created_at`;

export const INSERTAR_OUTBOX = `
INSERT INTO outbox_eventos (tipo, version, agregado_id, payload, trace_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id`;

// Paso 2 (worker, con SET LOCAL app.colegio_id del evento).
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
