// Cliente de la API para el portal (contrato: FeathersForAll/api/openapi.yaml v1.2.0).
// Cada función recibe el token de la sesión; `opts` acepta { signal, fetchImpl }.
import { requestJson } from './http.js';

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
