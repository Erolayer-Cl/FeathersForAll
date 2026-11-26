// Cliente de la API para el portal (contrato: FeathersForAll/api/openapi.yaml v1.11.0).
// Cada función recibe el token de la sesión; `opts` acepta { signal, fetchImpl }.
import { API_URL, ApiError, requestJson, toApiError } from './http.js';

/** POST /v1/auth/login → { access_token, token_type, expires_in, user }. El RBD solo lo manda el acceso de administración. */
export function login({ rbd, email, password }, opts) {
  return requestJson('/v1/auth/login', { method: 'POST', body: { ...(rbd && { rbd }), email, password }, ...opts });
}

/** GET /v1/me → perfil propio { id, name, email, role, school } */
export function getMe(token, opts) {
  return requestJson('/v1/me', { token, ...opts });
}

/** GET /v1/courses → todos los cursos visibles (recorre las páginas con next_cursor). */
export async function getCourses(token, opts) {
  const courses = [];
  let cursor = null;
  // Tope de páginas por si el servidor devolviera siempre un cursor (no debería).
  for (let page = 0; page < 20; page++) {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const body = await requestJson(`/v1/courses${query}`, { token, ...opts });
    courses.push(...body.data);
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  return courses;
}

/** GET /v1/courses/{id} → un curso (404 si no participas en él). */
export function getCourse(token, courseId, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}`, { token, ...opts });
}

/** GET /v1/me/grades → mis ramos con sus notas { student_id, courses: [...] } (solo estudiantes). */
export function getMyGrades(token, opts) {
  return requestJson('/v1/me/grades', { token, ...opts });
}

/** GET /v1/me/grades/{assessmentId} → detalle de una evaluación entregada, con retroalimentación. */
export function getGradeDetail(token, assessmentId, opts) {
  return requestJson(`/v1/me/grades/${encodeURIComponent(assessmentId)}`, { token, ...opts });
}

// --- Conversaciones guardadas del Tutor IA (v1.2, ADR 0008): solo las ve el propio estudiante.
// El envío de mensajes responde en streaming: está en chatApi.js (streamTutorMessage).

/** GET /v1/courses/{id}/tutor-conversations → mis conversaciones del curso { data: [...] }, la más reciente primero. */
export function getTutorConversations(token, courseId, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/tutor-conversations?limit=50`, { token, ...opts });
}

/** GET /v1/tutor-conversations/{id} → la conversación con sus mensajes en orden. */
export function getTutorConversation(token, conversationId, opts) {
  return requestJson(`/v1/tutor-conversations/${encodeURIComponent(conversationId)}`, { token, ...opts });
}

/** DELETE /v1/tutor-conversations/{id} → null (204). */
export function deleteTutorConversation(token, conversationId, opts) {
  return requestJson(`/v1/tutor-conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE', token, ...opts });
}

// --- Apuntes del tutor por curso (contrato v1.3: solo el docente del curso y el administrador).

/** Tamaño máximo de un archivo de apuntes (igual que el límite del backend). */
export const MAX_APUNTE_BYTES = 40 * 1024 * 1024;
/** Extensiones que acepta la carga de apuntes. */
export const APUNTE_EXTENSIONES = ['.pdf', '.txt', '.md'];

const TIPO_POR_EXTENSION = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown' };
const documentoPath = (courseId, name) =>
  `/v1/courses/${encodeURIComponent(courseId)}/documents${name === undefined ? '' : `/${encodeURIComponent(name)}`}`;

/** GET /v1/courses/{id}/documents → { data: [{ name, chunks, official }] } los apuntes indexados del curso. */
export function getCourseDocuments(token, courseId, opts) {
  return requestJson(documentoPath(courseId), { token, ...opts });
}

/**
 * PUT /v1/courses/{id}/documents/{nombre} → { name, chunks, official, pages? } (201 nuevo, 200 reemplazado)
 * Sube un PDF, .txt o .md como cuerpo binario; el formato lo dice la extensión del nombre.
 * Un PDF grande tarda: el servidor lo lee y calcula los embeddings antes de responder.
 */
export async function uploadCourseFile(token, courseId, file, { signal, fetchImpl = fetch } = {}) {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  let res;
  try {
    res = await fetchImpl(`${API_URL}${documentoPath(courseId, file.name)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': TIPO_POR_EXTENSION[ext] ?? 'application/octet-stream',
        accept: 'application/json',
      },
      body: file,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', 0);
  }
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/** DELETE /v1/courses/{id}/documents/{nombre} → null (204). El tutor deja de usar ese apunte. */
export function deleteCourseDocument(token, courseId, name, opts) {
  return requestJson(documentoPath(courseId, name), { method: 'DELETE', token, ...opts });
}

// --- Ciclo mínimo (contrato v1.4): cursos y matrículas (H1), evaluaciones (H2, H3) y rendir (H4).
// Los POST llevan `idempotencyKey` (un UUID por operación): si la respuesta se pierde y se reintenta con la
// misma clave, el servidor devuelve lo mismo sin crear nada dos veces.

/** POST /v1/courses → el curso creado. `input`: { name, period, subject?, grade_level? } (el admin agrega teacher_id). */
export function createCourse(token, input, idempotencyKey, opts) {
  return requestJson('/v1/courses', { method: 'POST', token, body: input, idempotencyKey, ...opts });
}

/** GET /v1/courses/{id}/enrollments → { data: [{ id, student_id, name, email, enrolled_at }] } (docente y admin). */
export function getEnrollments(token, courseId, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/enrollments`, { token, ...opts });
}

/** POST /v1/courses/{id}/enrollments → { id, course_id, student_id, enrolled_at }. 404 si el correo no es de un estudiante del colegio. */
export function enrollStudent(token, courseId, email, idempotencyKey, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/enrollments`, {
    method: 'POST', token, body: { student_email: email }, idempotencyKey, ...opts,
  });
}

/** GET /v1/courses/{id}/assessments → { data: [...] }: docente, todas; estudiante, las publicadas con su nota. */
export function getAssessments(token, courseId, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/assessments`, { token, ...opts });
}

/** GET /v1/assessments/{id} → la evaluación (docente: con la alternativa correcta; estudiante: sin ella). */
export function getAssessment(token, assessmentId, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}`, { token, ...opts });
}

/** POST /v1/courses/{id}/assessments → la evaluación en borrador. `input`: { title, questions: [{ statement, options, correct_option, feedback }] }. */
export function createAssessment(token, courseId, input, idempotencyKey, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/assessments`, {
    method: 'POST', token, body: input, idempotencyKey, ...opts,
  });
}

/** PATCH /v1/assessments/{id} → la evaluación con su nuevo estado ('published' | 'closed'). 422 si falta una alternativa correcta. */
export function setAssessmentStatus(token, assessmentId, status, opts) {
  return patchAssessment(token, assessmentId, { status }, opts);
}

/**
 * PATCH /v1/assessments/{id} (v1.9) → la evaluación. `cambios`: { status?, closes_at? }; closes_at es ISO con zona
 * o null (sin cierre automático). Sirve para publicar con su hora de cierre o para cambiarla después.
 */
export function patchAssessment(token, assessmentId, cambios, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}`, { method: 'PATCH', token, body: cambios, ...opts });
}

/** GET /v1/assessments/{id}/results → resumen, acierto por pregunta y entregas (docente y admin). */
export function getAssessmentResults(token, assessmentId, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/results`, { token, ...opts });
}

/** POST /v1/courses/{id}/assessments/generate → borrador propuesto por la IA { title, questions, source, sources } (NO guarda nada). */
export function generateAssessment(token, courseId, input, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/assessments/generate`, { method: 'POST', token, body: input, ...opts });
}

/** PUT /v1/assessments/{id} → el borrador con sus preguntas reemplazadas. 409 si ya está publicado. */
export function updateAssessment(token, assessmentId, input, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}`, { method: 'PUT', token, body: input, ...opts });
}

/** DELETE /v1/assessments/{id} → null (204). Solo borradores. */
export function deleteAssessment(token, assessmentId, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}`, { method: 'DELETE', token, ...opts });
}

/** POST /v1/assessments/{id}/submissions → { score, max_score, percentage, grade, answers: [{ question_id, correct, feedback }] }. 409 si ya la rindió. */
export function submitAssessment(token, assessmentId, answers, idempotencyKey, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/submissions`, {
    method: 'POST', token, body: { answers }, idempotencyKey, ...opts,
  });
}

// --- Notas del curso para el docente y el admin (H3). Todas responden 403 al estudiante y 404 si no participas en el curso.

/** GET /v1/courses/{id}/gradebook → { course_id, course, assessments: [{ id, title, status, pass_threshold, weight, published_at }], students: [{ student_id, name, average, grades: { [assessmentId]: nota } }], course_average }. Sin borradores. */
export function getGradebook(token, courseId, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/gradebook`, { token, ...opts });
}

/** GET /v1/courses/{id}/grades/summary → estadísticas por evaluación y estudiantes con promedio bajo `threshold` (por defecto 4,0). */
export function getGradesSummary(token, courseId, { threshold, ...opts } = {}) {
  const query = threshold === undefined ? '' : `?threshold=${encodeURIComponent(threshold)}`;
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/grades/summary${query}`, { token, ...opts });
}

/** GET /v1/courses/{id}/students/{studentId}/grades → { course_id, course, student_id, average, grades: [{ assessment_id, title, score, grade, weight, submitted_at }] }. */
export function getStudentGrades(token, courseId, studentId, opts) {
  return requestJson(`/v1/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(studentId)}/grades`, { token, ...opts });
}

/** PATCH /v1/assessments/{id}/grading → { assessment_id, title, pass_threshold, weight }. `input`: { pass_threshold?, weight? }; las notas se recalculan solas. */
export function updateGrading(token, assessmentId, input, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/grading`, { method: 'PATCH', token, body: input, ...opts });
}

// --- Material del curso y tareas con hora límite (contrato v1.8).

/** Tamaño máximo del archivo de una tarea o de una entrega (igual que el backend). */
export const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;
/** Extensiones que aceptan las tareas y las entregas (el servidor revisa además el contenido). */
export const ARCHIVO_EXTENSIONES = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.txt', '.md', '.jpg', '.jpeg', '.png', '.zip'];

const seg = encodeURIComponent;

/** PUT de un archivo como cuerpo binario (el nombre va en la URL). Devuelve el JSON de la respuesta. */
async function subirArchivo(token, path, file, { signal, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${API_URL}${path}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': file.type || 'application/octet-stream', accept: 'application/json' },
      body: file,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', 0);
  }
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/** GET de un archivo → { blob, name } (el nombre sale de Content-Disposition; si no viene, `nombre`). */
async function bajarArchivo(token, path, nombre, { signal, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${API_URL}${path}`, { headers: { authorization: `Bearer ${token}` }, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.', 0);
  }
  if (!res.ok) throw await toApiError(res);
  return { blob: await res.blob(), name: nombreDeDescarga(res.headers.get('content-disposition')) ?? nombre };
}

/** filename*=UTF-8''... (o filename="...") de un Content-Disposition. */
export function nombreDeDescarga(header) {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* sigue con filename= */
    }
  }
  return header.match(/filename="([^"]*)"/i)?.[1] ?? null;
}

/** GET /v1/courses/{id}/materials → { data: [{ name, content_type, size_bytes, original, uploaded_at }] } */
export function getCourseMaterials(token, courseId, opts) {
  return requestJson(`/v1/courses/${seg(courseId)}/materials`, { token, ...opts });
}

/** Descarga un material del curso → { blob, name }. */
export function downloadCourseMaterial(token, courseId, name, opts) {
  return bajarArchivo(token, `/v1/courses/${seg(courseId)}/materials/${seg(name)}/file`, name, opts);
}

/** GET /v1/courses/{id}/tasks → { data: [Task] } (el estudiante recibe my_submission; el docente, los conteos). */
export function getTasks(token, courseId, opts) {
  return requestJson(`/v1/courses/${seg(courseId)}/tasks`, { token, ...opts });
}

/** GET /v1/tasks/{id} → la tarea (el docente recibe además `students`, con o sin entrega). */
export function getTask(token, taskId, opts) {
  return requestJson(`/v1/tasks/${seg(taskId)}`, { token, ...opts });
}

/** POST /v1/courses/{id}/tasks → la tarea creada. `input`: { title, instructions?, due_at } (ISO con zona). */
export function createTask(token, courseId, input, idempotencyKey, opts) {
  return requestJson(`/v1/courses/${seg(courseId)}/tasks`, { method: 'POST', token, body: input, idempotencyKey, ...opts });
}

/** PATCH /v1/tasks/{id} → la tarea. `input`: { title?, instructions?, due_at? }. */
export function updateTask(token, taskId, input, opts) {
  return requestJson(`/v1/tasks/${seg(taskId)}`, { method: 'PATCH', token, body: input, ...opts });
}

/** DELETE /v1/tasks/{id} → null (204). Borra también las entregas. */
export function deleteTask(token, taskId, opts) {
  return requestJson(`/v1/tasks/${seg(taskId)}`, { method: 'DELETE', token, ...opts });
}

/** PUT /v1/tasks/{id}/attachment/{nombre} → la tarea con su archivo. */
export function uploadTaskAttachment(token, taskId, file, opts) {
  return subirArchivo(token, `/v1/tasks/${seg(taskId)}/attachment/${seg(file.name)}`, file, opts);
}

/** DELETE /v1/tasks/{id}/attachment → null (204). */
export function deleteTaskAttachment(token, taskId, opts) {
  return requestJson(`/v1/tasks/${seg(taskId)}/attachment`, { method: 'DELETE', token, ...opts });
}

/** Descarga el archivo de la tarea → { blob, name }. */
export function downloadTaskAttachment(token, taskId, name, opts) {
  return bajarArchivo(token, `/v1/tasks/${seg(taskId)}/attachment`, name, opts);
}

/** PUT /v1/tasks/{id}/submission/{nombre} → { file_name, size_bytes, submitted_at }. 409 si la tarea ya cerró. */
export function uploadSubmission(token, taskId, file, opts) {
  return subirArchivo(token, `/v1/tasks/${seg(taskId)}/submission/${seg(file.name)}`, file, opts);
}

/** Descarga mi entrega → { blob, name }. */
export function downloadMySubmission(token, taskId, name, opts) {
  return bajarArchivo(token, `/v1/tasks/${seg(taskId)}/submission`, name, opts);
}

/** Descarga la entrega de un estudiante (docente/admin) → { blob, name }. */
export function downloadStudentSubmission(token, taskId, studentId, name, opts) {
  return bajarArchivo(token, `/v1/tasks/${seg(taskId)}/submissions/${seg(studentId)}/file`, name, opts);
}

// --- Revisión docente de respuestas escritas (contrato v1.11).

/** GET /v1/assessments/{id}/text-answers → { pending, data: [{ id, question_order, question, student_name, text_answer, correct, pending_review, … }] } */
export function getTextAnswers(token, assessmentId, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/text-answers`, { token, ...opts });
}

/** PATCH /v1/assessments/{id}/text-answers/{answerId} → { id, correct, reviewed_at, student_percentage, student_grade } */
export function reviewTextAnswer(token, assessmentId, answerId, correct, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/text-answers/${encodeURIComponent(answerId)}`, { method: 'PATCH', token, body: { correct }, ...opts });
}
