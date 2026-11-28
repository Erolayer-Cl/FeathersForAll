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

// Login sin RBD (08): cuentas activas con ese correo en cualquier colegio. La API verifica la
// clave contra cada una; el colegio sale de la cuenta que coincide.
export const CUENTAS_POR_CORREO = `
SELECT id, colegio_id, rol, password_hash
FROM cuentas_por_correo($1)`;

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

// --- Gestión de usuarios del colegio (v1.12, 13_gestion_usuarios.sql) ----------------
// Solo el admin (la API responde 403 antes; el RLS de 02 §9 tampoco deja escribir a otros).
// El master nunca aparece: es de plataforma.

// Lista con filtros opcionales y keyset por (nombre, id). $3 llega ya escapado para LIKE.
export const USUARIOS_LISTA = `
SELECT id, nombre, email, rol, activo, created_at, updated_at
FROM usuarios
WHERE rol <> 'master'
  AND ($1::text IS NULL OR rol::text = $1)
  AND ($2::boolean IS NULL OR activo = $2)
  AND ($3::text IS NULL OR nombre ILIKE '%' || $3 || '%' OR email::text ILIKE '%' || $3 || '%')
  AND ($5::text IS NULL OR (nombre, id) > ($5::text, $6::uuid))
ORDER BY nombre, id
LIMIT $4`;

export const USUARIO_DETALLE = `
SELECT id, nombre, email, rol, activo, created_at, updated_at
FROM usuarios
WHERE id = $1 AND rol <> 'master'`;

// Cursos de la cuenta: los que dicta (docente) y en los que está matriculado (estudiante).
export const USUARIO_CURSOS = `
SELECT c.id, c.nombre, c.periodo, c.asignatura, 'teacher' AS relacion
FROM cursos c
WHERE c.docente_id = $1
UNION ALL
SELECT c.id, c.nombre, c.periodo, c.asignatura, 'student' AS relacion
FROM matriculas m
JOIN cursos c ON c.id = m.curso_id
WHERE m.estudiante_id = $1 AND m.activo
ORDER BY periodo DESC, nombre, id`;

// Alta de cuenta: el colegio lo pone app_colegio_id() (DEFAULT de la sesión del admin).
export const USUARIO_CREAR = `
INSERT INTO usuarios (colegio_id, nombre, email, password_hash, rol)
VALUES (app_colegio_id(), $1, $2, $3, $4::rol_usuario)
RETURNING id, nombre, email, rol, activo, created_at, updated_at`;

// Cambios parciales: NULL = no tocar. El rol y el colegio no se cambian (trigger de 13).
export const USUARIO_ACTUALIZAR = `
UPDATE usuarios
SET nombre = COALESCE($2, nombre),
    email  = COALESCE($3::citext, email),
    activo = COALESCE($4, activo)
WHERE id = $1 AND rol <> 'master'
RETURNING id, nombre, email, rol, activo, created_at, updated_at`;

// Restablecer la clave de otra cuenta: el trigger de 13 fija sesiones_desde y corta sus sesiones.
export const USUARIO_RESTABLECER_CLAVE = `
UPDATE usuarios SET password_hash = $2
WHERE id = $1 AND rol <> 'master'
RETURNING id`;

// Cambiar la propia clave (cualquier rol): única vía para docentes y estudiantes (13).
export const CAMBIAR_MI_CLAVE = `
SELECT cambiar_mi_clave($1) AS sesiones_desde`;

// --- Apoderados (16, MVP 5) ------------------------------------------------------------
// Vínculos que gestiona el admin (RLS: solo él escribe). $1 = apoderado.
export const PUPILOS_DE_APODERADO = `
SELECT e.id AS estudiante_id, e.nombre, e.email, e.activo, v.created_at
FROM apoderados_estudiantes v
JOIN usuarios e ON e.id = v.estudiante_id
WHERE v.apoderado_id = $1
ORDER BY e.nombre, e.id`;

// Vincular por correo: el estudiante debe ser del colegio (FK compuesta + RLS de usuarios). 0 filas = no existe.
export const VINCULAR_PUPILO = `
INSERT INTO apoderados_estudiantes (apoderado_id, estudiante_id)
SELECT a.id, e.id
FROM usuarios a, usuarios e
WHERE a.id = $1 AND a.rol = 'apoderado'
  AND e.email = $2::citext AND e.rol = 'estudiante' AND e.activo
RETURNING estudiante_id`;

export const DESVINCULAR_PUPILO = `
DELETE FROM apoderados_estudiantes WHERE apoderado_id = $1 AND estudiante_id = $2
RETURNING estudiante_id`;

// Lo que lee el apoderado: SOLO por las funciones de 16, limitadas a sus pupilos vinculados.
export const MIS_PUPILOS = `SELECT estudiante_id, nombre FROM mis_pupilos()`;
export const RAMOS_PUPILO = `SELECT curso_id, curso, asignatura, periodo, docente, promedio FROM ramos_pupilo($1)`;
export const NOTAS_PUPILO = `
SELECT curso_id, evaluacion_id, evaluacion, puntaje, nota, ponderacion, fecha_envio, por_revisar FROM notas_pupilo($1)`;
export const PENDIENTES_PUPILO = `SELECT curso_id, evaluacion_id, titulo, fecha_cierre, duracion_min FROM pendientes_pupilo($1)`;

// --- Auditoría (13) ------------------------------------------------------------------
// actor_id y colegio_id los pone la base desde la sesión. `detalle` nunca lleva claves ni contenido.
export const AUDITAR = `
INSERT INTO auditoria (accion, recurso, recurso_id, detalle)
VALUES ($1, $2, $3, $4::jsonb)`;

// Bitácora del colegio (solo admin, RLS), de la más reciente a la más antigua, keyset por (fecha, id).
export const AUDITORIA_LISTA = `
SELECT a.id, a.accion, a.recurso, a.recurso_id, a.detalle, a.created_at,
       a.created_at::text AS cursor_at,  -- con microsegundos: el Date de JS los perdería
       a.actor_id, u.nombre AS actor, u.rol AS actor_rol
FROM auditoria a
JOIN usuarios u ON u.id = a.actor_id
WHERE ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
ORDER BY a.created_at DESC, a.id DESC
LIMIT $1`;

// --- Gestión académica (H1) -------------------------------------------------------

export const CREAR_CURSO = `
INSERT INTO cursos (docente_id, nombre, periodo, asignatura, nivel)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, nombre, periodo, asignatura, nivel, created_at`;

// Columnas de un curso para la API (contrato: schema Course).
//   matriculados       -> students_count (la API solo lo muestra al personal: para un estudiante,
//                         el RLS de 04 cuenta solo su propia matrícula)
//   apuntes            -> tutor_documents: apuntes que el docente subió al RAG del curso
//   tutor_disponible   -> tutor_available: hay fragmentos de apuntes del docente, así que el tutor puede responder
// Las Bases del Mineduc ("MINEDUC · …", doc-kinds.js) no cuentan: con solo ellas el tutor dice que faltan apuntes.
const COLUMNAS_CURSO = `
       c.id, c.nombre, c.periodo, c.asignatura, c.nivel, c.docente_id, d.nombre AS docente, c.created_at,
       (SELECT count(*) FROM matriculas m WHERE m.curso_id = c.id AND m.activo) AS matriculados,
       (SELECT count(*) FROM apuntes_curso a WHERE a.curso_id = c.id AND a.titulo !~* '^MINEDUC([^[:alnum:]_]|$)') AS apuntes,
       EXISTS (SELECT 1 FROM apuntes_embeddings e JOIN apuntes_curso a ON a.id = e.apunte_id
               WHERE e.curso_id = c.id AND a.titulo !~* '^MINEDUC([^[:alnum:]_]|$)') AS tutor_disponible`;

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

// Alumnos matriculados (activos) de un curso. Solo para el docente del curso y el admin.
export const ESTUDIANTES_CURSO = `
SELECT m.id AS matricula_id, m.fecha_matricula, u.id AS estudiante_id, u.nombre, u.email
FROM matriculas m
JOIN usuarios u ON u.id = m.estudiante_id
WHERE m.curso_id = $1 AND m.activo
ORDER BY u.nombre, u.id`;

// --- Evaluaciones (H2) -----------------------------------------------------------

// Lista para el docente/admin: todas, borradores incluidos.
export const EVALUACIONES_DEL_CURSO = `
SELECT e.id, e.titulo, e.estado, e.fecha_publicacion, e.fecha_cierre, e.duracion_min,
       (SELECT count(*) FROM preguntas p WHERE p.evaluacion_id = e.id)::int AS preguntas,
       (SELECT count(*) FROM intentos_evaluacion i WHERE i.evaluacion_id = e.id AND i.fecha_envio IS NOT NULL)::int AS entregas
FROM evaluaciones e
WHERE e.curso_id = $1
ORDER BY e.created_at DESC, e.id`;

// Lista para el estudiante ($2 = su id): solo publicadas y cerradas (nunca borradores), con su nota si ya la rindió.
export const EVALUACIONES_PARA_ESTUDIANTE = `
SELECT e.id, e.titulo, e.estado, e.fecha_publicacion, e.fecha_cierre, e.duracion_min,
       (SELECT count(*) FROM preguntas p WHERE p.evaluacion_id = e.id)::int AS preguntas,
       n.nota, n.puntaje, n.fecha_envio AS entregada_at,
       i.fecha_inicio AS iniciada_at,
       (SELECT count(*) FROM respuestas_estudiante r WHERE r.intento_id = i.id AND r.revision_pendiente)::int AS por_revisar
FROM evaluaciones e
LEFT JOIN notas n ON n.evaluacion_id = e.id AND n.estudiante_id = $2
LEFT JOIN intentos_evaluacion i ON i.evaluacion_id = e.id AND i.estudiante_id = $2
WHERE e.curso_id = $1 AND e.estado IN ('publicada', 'cerrada')
ORDER BY e.fecha_publicacion DESC, e.id`;

// Evaluación completa, CON las alternativas correctas: solo para el docente del curso y el admin.
// LEFT JOIN: las preguntas de texto (11) no tienen alternativas; traen sus respuestas aceptadas.
export const PREGUNTAS_PARA_DOCENTE = `
-- 17: la alternativa correcta y las respuestas aceptadas salen de funciones solo para el personal del curso.
SELECT p.id, p.orden, p.enunciado, p.retroalimentacion, p.tipo, ac.respuestas_aceptadas,
       COALESCE(json_agg(json_build_object('texto', a.texto, 'es_correcta', a.es_correcta) ORDER BY a.orden, a.id)
                FILTER (WHERE a.id IS NOT NULL), '[]') AS alternativas
FROM preguntas p
LEFT JOIN alternativas_staff($1) a ON a.pregunta_id = p.id
LEFT JOIN aceptadas_staff($1) ac ON ac.pregunta_id = p.id
WHERE p.evaluacion_id = $1
GROUP BY p.id, ac.respuestas_aceptadas
ORDER BY p.orden`;

// Un intento (enviado o no) del estudiante en la evaluación: para responder 409 si ya la rindió.
// plazo: inicio + duración o el cierre, lo que llegue primero (14); vencido = pasó el plazo + el margen de red.
export const INTENTO_DEL_ESTUDIANTE = `
SELECT i.id, i.fecha_envio, i.fecha_inicio,
       plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) AS plazo,
       COALESCE(now() > plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) + margen_plazo(), false) AS vencido
FROM intentos_evaluacion i
JOIN evaluaciones e ON e.id = i.evaluacion_id
WHERE i.evaluacion_id = $1 AND i.estudiante_id = $2`;

// v1.12 · Empezar (o retomar) una evaluación con tiempo: crea el intento abierto si no existe. Mismas condiciones
// que CREAR_INTENTO. 0 filas = ya existía (se lee con INTENTO_DEL_ESTUDIANTE) o no se puede empezar.
export const INICIAR_INTENTO = `
INSERT INTO intentos_evaluacion (curso_id, evaluacion_id, estudiante_id)
SELECT e.curso_id, e.id, m.estudiante_id
FROM evaluaciones e
JOIN matriculas m ON m.curso_id = e.curso_id AND m.estudiante_id = $2 AND m.activo
WHERE e.id = $1
  AND e.estado = 'publicada'
  AND (e.fecha_cierre IS NULL OR now() < e.fecha_cierre)
ON CONFLICT (evaluacion_id, estudiante_id) DO NOTHING
RETURNING id`;

// Intentos abiertos cuyo plazo (más el margen) ya pasó: se cierran con lo que alcanzaron a responder (nada, si
// el portal no alcanzó a entregar) y así tienen nota. RLS: el estudiante solo cierra el suyo; el docente, los de
// sus cursos. $1 = evaluación o NULL; $2 = curso o NULL.
export const CERRAR_INTENTOS_VENCIDOS = `
UPDATE intentos_evaluacion i
SET fecha_envio = least(now(), plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre)),
    puntaje = (
        SELECT round(100.0 * count(*) FILTER (WHERE r.es_correcta)
                     / NULLIF((SELECT count(*) FROM preguntas p WHERE p.evaluacion_id = i.evaluacion_id), 0), 2)
        FROM respuestas_estudiante r
        WHERE r.intento_id = i.id)
FROM evaluaciones e
WHERE e.id = i.evaluacion_id
  AND i.fecha_envio IS NULL
  AND ($1::uuid IS NULL OR i.evaluacion_id = $1)
  AND ($2::uuid IS NULL OR i.curso_id = $2)
  AND plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) IS NOT NULL
  AND now() > plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) + margen_plazo()
RETURNING i.id`;

export const CREAR_EVALUACION = `
INSERT INTO evaluaciones (curso_id, titulo, fecha_cierre, duracion_min)
VALUES ($1, $2, $3, $4)
RETURNING id, estado, created_at`;

// $5 = 'alternativas' | 'texto'; $6 = respuestas aceptadas (solo texto; NULL si el borrador aún no las tiene).
export const CREAR_PREGUNTA = `
INSERT INTO preguntas (evaluacion_id, enunciado, orden, retroalimentacion, tipo, respuestas_aceptadas)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id`;

// $4 = posición de la alternativa (0, 1, 2…): el índice que usan correct_option y selected_option.
export const CREAR_ALTERNATIVA = `
INSERT INTO alternativas (pregunta_id, texto, es_correcta, orden)
VALUES ($1, $2, $3, $4)
RETURNING id`;

// La BD garantiza "como máximo una correcta"; "al menos una" lo valida la API
// antes de publicar: si esto devuelve filas -> 422.
// Editar un borrador: cambia el título y el cierre, y se vuelven a crear las preguntas (las alternativas caen en cascada).
export const ACTUALIZAR_BORRADOR = `
UPDATE evaluaciones SET titulo = $2, fecha_cierre = $3, duracion_min = $4
WHERE id = $1 AND estado = 'borrador'
RETURNING id`;

export const BORRAR_PREGUNTAS = `
DELETE FROM preguntas WHERE evaluacion_id = $1`;

export const BORRAR_BORRADOR = `
DELETE FROM evaluaciones WHERE id = $1 AND estado = 'borrador'
RETURNING id`;

export const CONTAR_PREGUNTAS = `
SELECT count(*)::int AS n FROM preguntas WHERE evaluacion_id = $1`;

export const PREGUNTAS_SIN_CORRECTA = `
SELECT p.id, p.orden, p.tipo
FROM preguntas p
WHERE p.evaluacion_id = $1
  -- Las de texto no se exigen: sin respuestas aceptadas, el docente las revisa a mano (12).
  AND p.tipo = 'alternativas'
  AND NOT EXISTS (SELECT 1 FROM alternativas_staff($1) a WHERE a.pregunta_id = p.id AND a.es_correcta)
ORDER BY p.orden`;

// $2 = true para fijar el cierre en el mismo paso ($3: fecha futura o NULL = sin cierre automático); false = deja el del borrador.
export const PUBLICAR_EVALUACION = `
UPDATE evaluaciones
SET estado = 'publicada', fecha_publicacion = now(),
    fecha_cierre = CASE WHEN $2 THEN $3::timestamptz ELSE fecha_cierre END
WHERE id = $1 AND estado = 'borrador'
RETURNING id, estado, fecha_publicacion, fecha_cierre`;

// Cambiar solo el cierre (extenderlo, adelantarlo o quitarlo) de un borrador o de una evaluación publicada.
export const CAMBIAR_CIERRE_EVALUACION = `
UPDATE evaluaciones SET fecha_cierre = $2
WHERE id = $1 AND estado IN ('borrador', 'publicada')
RETURNING id`;

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
// Las de texto vienen sin alternativas (y nunca con sus respuestas aceptadas).
export const PREGUNTAS_PARA_RENDIR = `
SELECT p.id, p.orden, p.enunciado, p.tipo,
       COALESCE(json_agg(json_build_object('id', a.id, 'texto', a.texto) ORDER BY a.orden, a.id)
                FILTER (WHERE a.id IS NOT NULL), '[]') AS alternativas
FROM preguntas p
LEFT JOIN alternativas_publicas a ON a.pregunta_id = p.id
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
// $4 = respuesta escrita (preguntas de texto, 11): la corrige la base con respuesta_texto_correcta().
// No acepta respuestas si la evaluación ya no está publicada o venció.
export const INSERTAR_RESPUESTA = `
INSERT INTO respuestas_estudiante
    (evaluacion_id, intento_id, pregunta_id, alternativa_elegida_id, respuesta_texto, es_correcta, retroalimentacion)
SELECT i.evaluacion_id, i.id, p.id, a.id,
       CASE WHEN p.tipo = 'texto' THEN $4::text END,
       -- La corrección la pone el trigger de la base (17: el estudiante no puede leer la respuesta correcta).
       false,
       p.retroalimentacion
FROM intentos_evaluacion i
JOIN evaluaciones e ON e.id = i.evaluacion_id
JOIN preguntas p ON p.id = $2 AND p.evaluacion_id = i.evaluacion_id
LEFT JOIN alternativas a ON a.id = $3 AND a.pregunta_id = p.id
WHERE i.id = $1 AND i.fecha_envio IS NULL
  AND e.estado = 'publicada'
  -- Plazo del intento (14): inicio + duración o el cierre, con el margen de red.
  AND (plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) IS NULL
       OR now() <= plazo_intento(i.fecha_inicio, e.duracion_min, e.fecha_cierre) + margen_plazo())
RETURNING id, es_correcta, retroalimentacion, revision_pendiente`;

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
SELECT p.orden, p.enunciado, COALESCE(a.texto, r.respuesta_texto) AS respuesta_elegida, p.tipo, r.revision_pendiente,
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
SELECT e.id, e.curso_id, e.titulo, e.estado, e.exigencia, e.ponderacion, e.fecha_publicacion, e.fecha_cierre,
       e.duracion_min, c.docente_id
FROM evaluaciones e
JOIN cursos c ON c.id = e.curso_id
WHERE e.id = $1`;

// Ramos del estudiante (GET /v1/me/grades): TODOS sus cursos con matrícula activa, tengan o no
// notas todavía, con su docente y si el tutor tiene apuntes. $2 NULL = todos los ramos.
export const RAMOS_ESTUDIANTE = `
SELECT c.id AS curso_id, c.nombre AS curso, c.asignatura, c.periodo, d.nombre AS docente,
       EXISTS (SELECT 1 FROM apuntes_embeddings e JOIN apuntes_curso a ON a.id = e.apunte_id
               WHERE e.curso_id = c.id AND a.titulo !~* '^MINEDUC([^[:alnum:]_]|$)') AS tutor_disponible
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
       -- v1.12: respuestas escritas por revisar (la nota es provisional mientras sea > 0).
       (SELECT count(*) FROM respuestas_estudiante r WHERE r.intento_id = n.intento_id AND r.revision_pendiente)::int AS por_revisar,
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
       (SELECT count(*) FROM respuestas_estudiante r WHERE r.intento_id = n.intento_id AND r.revision_pendiente)::int AS por_revisar,
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
       count(*) AS evaluaciones_rendidas,
       -- Notas provisionales (con respuestas escritas por revisar): el riesgo puede cambiar al revisar.
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM respuestas_estudiante r
                                      WHERE r.intento_id = n.intento_id AND r.revision_pendiente)) AS notas_provisionales
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
SELECT n.estudiante_id, u.nombre, n.puntaje, n.nota, n.fecha_envio,
       (SELECT count(*) FROM respuestas_estudiante r WHERE r.intento_id = n.intento_id AND r.revision_pendiente)::int AS por_revisar
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
SELECT usuario_id, operacion, status_http, respuesta
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

// ---------------------------------------------------------------------------------------------------------
// Material del curso y tareas con hora límite (v1.8, 10_material_y_tareas.sql). El RLS de 10 ya limita qué
// filas ve cada rol; estas consultas no repiten esas reglas, solo eligen columnas.

// ¿Participa el usuario de la sesión en el curso? (misma regla que el resto: puede_ver_curso, 04)
export const CURSO_PARTICIPACION = `
SELECT c.id, c.docente_id, puede_ver_curso(c.id) AS visible
FROM cursos c
WHERE c.id = $1 AND c.activo`;

// Apuntes del curso que ven los estudiantes (sin las Bases Mineduc), con el archivo original si se guardó.
export const MATERIALES_CURSO = `
SELECT a.titulo AS name,
       COALESCE(f.tipo, 'text/plain') AS content_type,
       COALESCE(f.bytes, octet_length(a.contenido))::int AS size_bytes,
       (f.apunte_id IS NOT NULL) AS original,
       a.visible_estudiante AS visible,
       a.created_at AS uploaded_at
FROM apuntes_curso a
LEFT JOIN apuntes_archivos f ON f.apunte_id = a.id
-- $2 = true para el estudiante: solo lo que el docente marcó como visible (14). El personal ve todo.
WHERE a.curso_id = $1 AND a.titulo !~* '^MINEDUC([^[:alnum:]_]|$)' AND (NOT $2::boolean OR a.visible_estudiante)
ORDER BY a.created_at DESC, a.titulo`;

export const MATERIAL_ARCHIVO = `
SELECT a.titulo, a.contenido AS texto, f.nombre, f.tipo, f.contenido
FROM apuntes_curso a
LEFT JOIN apuntes_archivos f ON f.apunte_id = a.id
WHERE a.curso_id = $1 AND a.titulo = $2 AND a.titulo !~* '^MINEDUC([^[:alnum:]_]|$)' AND (NOT $3::boolean OR a.visible_estudiante)`;

// Mostrar u ocultar un apunte como material para los estudiantes (14). El tutor lo usa igual.
export const VISIBILIDAD_APUNTE = `
UPDATE apuntes_curso SET visible_estudiante = $3
WHERE curso_id = $1 AND titulo = $2 AND titulo !~* '^MINEDUC([^[:alnum:]_]|$)'
RETURNING titulo, visible_estudiante`;

// Visibilidad de cada apunte del curso, para la lista del docente.
export const VISIBILIDAD_APUNTES_CURSO = `
SELECT titulo, visible_estudiante FROM apuntes_curso WHERE curso_id = $1`;

// Guarda (o reemplaza) el archivo original del apunte recién indexado. 0 filas si el apunte no existe.
export const GUARDAR_ARCHIVO_APUNTE = `
INSERT INTO apuntes_archivos (apunte_id, curso_id, nombre, tipo, bytes, contenido)
SELECT a.id, a.curso_id, a.titulo, $3, $4, $5
FROM apuntes_curso a
WHERE a.curso_id = $1 AND a.titulo = $2
ON CONFLICT (apunte_id) DO UPDATE
   SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, bytes = EXCLUDED.bytes, contenido = EXCLUDED.contenido`;

// Quita el original guardado de un apunte (si no se pudo guardar el nuevo al reemplazarlo).
export const QUITAR_ARCHIVO_APUNTE = `
DELETE FROM apuntes_archivos f
USING apuntes_curso a
WHERE f.apunte_id = a.id AND a.curso_id = $1 AND a.titulo = $2`;

// Columnas comunes de una tarea (sin el archivo: los bytes solo se leen al descargar).
const TAREA_COLUMNAS = `
       t.id, t.curso_id, t.titulo, t.instrucciones, t.fecha_limite, (now() <= t.fecha_limite) AS abierta,
       t.archivo_nombre, t.archivo_tipo, t.archivo_bytes, t.created_at`;

// Tareas del curso. Para el estudiante trae su entrega ($2 = su id); para el personal, cuántos entregaron.
export const TAREAS_CURSO = `
SELECT ${TAREA_COLUMNAS},
       e.archivo_nombre AS entrega_nombre, e.archivo_bytes AS entrega_bytes, e.entregada_at,
       (SELECT count(*) FROM entregas_tarea x JOIN matriculas mx ON mx.curso_id = x.curso_id AND mx.estudiante_id = x.estudiante_id AND mx.activo
        WHERE x.tarea_id = t.id)::int AS entregas,  -- solo matrículas activas: igual que «estudiantes»
       (SELECT count(*) FROM matriculas m WHERE m.curso_id = t.curso_id AND m.activo)::int AS estudiantes
FROM tareas t
LEFT JOIN entregas_tarea e ON e.tarea_id = t.id AND e.estudiante_id = $2
WHERE t.curso_id = $1
ORDER BY t.fecha_limite, t.created_at`;

export const TAREA_ACCESO = `
SELECT ${TAREA_COLUMNAS}, c.docente_id,
       e.archivo_nombre AS entrega_nombre, e.archivo_bytes AS entrega_bytes, e.entregada_at,
       (SELECT count(*) FROM entregas_tarea x JOIN matriculas mx ON mx.curso_id = x.curso_id AND mx.estudiante_id = x.estudiante_id AND mx.activo
        WHERE x.tarea_id = t.id)::int AS entregas,  -- solo matrículas activas: igual que «estudiantes»
       (SELECT count(*) FROM matriculas m WHERE m.curso_id = t.curso_id AND m.activo)::int AS estudiantes
FROM tareas t
JOIN cursos c ON c.id = t.curso_id AND c.activo
LEFT JOIN entregas_tarea e ON e.tarea_id = t.id AND e.estudiante_id = $2
WHERE t.id = $1`;

export const CREAR_TAREA = `
INSERT INTO tareas (curso_id, titulo, instrucciones, fecha_limite)
VALUES ($1, $2, $3, $4)
RETURNING id`;

// PATCH: solo cambia lo que viene ($2..$4 NULL = no cambia; $5 = true para borrar las instrucciones).
export const ACTUALIZAR_TAREA = `
UPDATE tareas
SET titulo        = COALESCE($2, titulo),
    instrucciones = CASE WHEN $5 THEN NULL ELSE COALESCE($3, instrucciones) END,
    fecha_limite  = COALESCE($4, fecha_limite)
WHERE id = $1`;

export const BORRAR_TAREA = `DELETE FROM tareas WHERE id = $1`;

export const GUARDAR_ARCHIVO_TAREA = `
UPDATE tareas SET archivo_nombre = $2, archivo_tipo = $3, archivo_bytes = $4, archivo = $5 WHERE id = $1`;

export const QUITAR_ARCHIVO_TAREA = `
UPDATE tareas SET archivo_nombre = NULL, archivo_tipo = NULL, archivo_bytes = NULL, archivo = NULL
WHERE id = $1 AND archivo IS NOT NULL`;

export const ARCHIVO_TAREA = `
SELECT archivo_nombre AS nombre, archivo_tipo AS tipo, archivo AS contenido
FROM tareas WHERE id = $1 AND archivo IS NOT NULL`;

// Entrega del estudiante de la sesión: crea o reemplaza. El RLS de 10 la rechaza si la tarea ya cerró.
// "creada" = true si es la primera entrega (xmax = 0 en una fila recién insertada).
export const GUARDAR_ENTREGA = `
INSERT INTO entregas_tarea (curso_id, tarea_id, archivo_nombre, archivo_tipo, archivo_bytes, archivo)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (tarea_id, estudiante_id) DO UPDATE
   SET archivo_nombre = EXCLUDED.archivo_nombre, archivo_tipo = EXCLUDED.archivo_tipo,
       archivo_bytes = EXCLUDED.archivo_bytes, archivo = EXCLUDED.archivo
RETURNING archivo_nombre, archivo_bytes, entregada_at, (xmax = 0) AS creada`;

export const ARCHIVO_ENTREGA = `
SELECT archivo_nombre AS nombre, archivo_tipo AS tipo, archivo AS contenido
FROM entregas_tarea WHERE tarea_id = $1 AND estudiante_id = $2`;

// Para el docente: todos los estudiantes con matrícula activa, con su entrega o sin ella.
export const ENTREGAS_TAREA = `
SELECT u.id AS estudiante_id, u.nombre, e.archivo_nombre, e.archivo_bytes, e.entregada_at
FROM matriculas m
JOIN usuarios u ON u.id = m.estudiante_id
LEFT JOIN entregas_tarea e ON e.tarea_id = $1 AND e.estudiante_id = m.estudiante_id
WHERE m.curso_id = $2 AND m.activo
ORDER BY u.nombre`;

// ---------------------------------------------------------------------------------------------------------
// Revisión docente de respuestas escritas (v1.11, 12_revision_docente.sql).

// Todas las respuestas escritas de una evaluación, las por revisar primero. El RLS (04) ya limita al personal
// del curso; la API además exige ser staff.
export const RESPUESTAS_ESCRITAS = `
SELECT r.id, r.pregunta_id, p.orden, p.enunciado, ac.respuestas_aceptadas, i.estudiante_id, u.nombre,
       r.respuesta_texto, r.es_correcta, r.revision_pendiente, r.revisada_at, i.fecha_envio
FROM respuestas_estudiante r
JOIN preguntas p ON p.id = r.pregunta_id AND p.tipo = 'texto'
JOIN intentos_evaluacion i ON i.id = r.intento_id AND i.fecha_envio IS NOT NULL
JOIN usuarios u ON u.id = i.estudiante_id
LEFT JOIN aceptadas_staff($1) ac ON ac.pregunta_id = p.id
WHERE r.evaluacion_id = $1 AND r.respuesta_texto IS NOT NULL
ORDER BY r.revision_pendiente DESC, p.orden, u.nombre`;

// El docente decide: marca la respuesta escrita ($2) como correcta o no ($3) y se recalcula el puntaje del intento
// con la misma fórmula de ENVIAR_INTENTO. Solo respuestas de texto de esa evaluación ($1) y de intentos enviados.
// Antes de REVISAR_RESPUESTA, en la misma transacción: bloquea el intento de esa respuesta. Dos revisiones
// simultáneas de respuestas del MISMO intento quedan en fila, y como REVISAR_RESPUESTA es otra sentencia, su
// foto de la base ya incluye lo que confirmó la primera: el puntaje no pierde ninguna de las dos.
export const BLOQUEAR_INTENTO_DE_RESPUESTA = `
SELECT i.id
FROM respuestas_estudiante r
JOIN intentos_evaluacion i ON i.id = r.intento_id
WHERE r.id = $2 AND r.evaluacion_id = $1
FOR UPDATE OF i`;

export const REVISAR_RESPUESTA = `
WITH revisada AS (
    UPDATE respuestas_estudiante r
    SET es_correcta = $3, revision_pendiente = false, revisada_por = app_usuario_id(), revisada_at = now()
    FROM preguntas p, intentos_evaluacion i
    WHERE r.id = $2 AND r.evaluacion_id = $1 AND p.id = r.pregunta_id AND p.tipo = 'texto'
      AND i.id = r.intento_id AND i.fecha_envio IS NOT NULL
    RETURNING r.id, r.intento_id, r.es_correcta, r.revisada_at
), recalculado AS (
    UPDATE intentos_evaluacion i
    SET puntaje = (
        SELECT round(100.0 * count(*) FILTER (WHERE CASE WHEN x.id = rv.id THEN rv.es_correcta ELSE x.es_correcta END)
                     / NULLIF((SELECT count(*) FROM preguntas q WHERE q.evaluacion_id = i.evaluacion_id), 0), 2)
        FROM respuestas_estudiante x
        WHERE x.intento_id = i.id)
    FROM revisada rv
    WHERE i.id = rv.intento_id
    RETURNING i.id, i.puntaje, i.evaluacion_id
)
SELECT rv.id, rv.es_correcta, rv.revisada_at, rc.puntaje,
       nota_desde_puntaje(COALESCE(rc.puntaje, 0), e.exigencia) AS nota
FROM revisada rv
JOIN recalculado rc ON rc.id = rv.intento_id
JOIN evaluaciones e ON e.id = rc.evaluacion_id`;

// Cuántas respuestas del intento del estudiante esperan revisión (para avisar que la nota es provisional).
export const PENDIENTES_INTENTO = `
SELECT count(*) FILTER (WHERE r.revision_pendiente)::int AS pendientes
FROM intentos_evaluacion i
JOIN respuestas_estudiante r ON r.intento_id = i.id
WHERE i.evaluacion_id = $1 AND i.estudiante_id = $2`;
