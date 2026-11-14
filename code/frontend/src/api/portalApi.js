// Cliente de la API para el portal (contrato: FeathersForAll/api/openapi.yaml v1.4.0).
// Cada función recibe el token de la sesión; `opts` acepta { signal, fetchImpl }.
import { API_URL, ApiError, requestJson, toApiError } from './http.js';

/** POST /v1/auth/login → { access_token, token_type, expires_in, user } */
export function login({ rbd, email, password }, opts) {
  return requestJson('/v1/auth/login', { method: 'POST', body: { rbd, email, password }, ...opts });
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
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}`, { method: 'PATCH', token, body: { status }, ...opts });
}

/** GET /v1/assessments/{id}/results → resumen, acierto por pregunta y entregas (docente y admin). */
export function getAssessmentResults(token, assessmentId, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/results`, { token, ...opts });
}

/** POST /v1/assessments/{id}/submissions → { score, max_score, percentage, grade, answers: [{ question_id, correct, feedback }] }. 409 si ya la rindió. */
export function submitAssessment(token, assessmentId, answers, idempotencyKey, opts) {
  return requestJson(`/v1/assessments/${encodeURIComponent(assessmentId)}/submissions`, {
    method: 'POST', token, body: { answers }, idempotencyKey, ...opts,
  });
}
