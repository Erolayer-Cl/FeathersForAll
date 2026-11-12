// Cliente de la API para el portal (contrato: FeathersForAll/api/openapi.yaml v1.2.0).
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

// --- Apuntes del curso para el RAG del tutor (solo docente del curso y administrador).
// Rutas de desarrollo del backend (ENABLE_DEV_ROUTES): fuera del contrato OpenAPI.

/** Tamaño máximo de un archivo de apuntes (igual que el límite del backend). */
export const MAX_APUNTE_BYTES = 40 * 1024 * 1024;
/** Extensiones que acepta la carga de apuntes. */
export const APUNTE_EXTENSIONES = ['.pdf', '.txt', '.md'];

/** GET /v1/dev/courses/{id}/documents → { documents: [{ doc_id, chunks }] } los apuntes indexados del curso. */
export function getCourseDocuments(token, courseId, opts) {
  return requestJson(`/v1/dev/courses/${encodeURIComponent(courseId)}/documents`, { token, ...opts });
}

/**
 * POST /v1/dev/courses/{id}/files?name=… → { doc_id, chunks, pages? }
 * Sube un PDF, .txt o .md (cuerpo binario). Si ya existe uno con ese nombre, lo reemplaza.
 * Un PDF grande tarda: el servidor lo lee y calcula los embeddings antes de responder.
 */
export async function uploadCourseFile(token, courseId, file, { signal, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${API_URL}/v1/dev/courses/${encodeURIComponent(courseId)}/files?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', accept: 'application/json' },
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

/** DELETE /v1/dev/courses/{id}/documents/{docId} → null (204). El tutor deja de usar ese apunte. */
export function deleteCourseDocument(token, courseId, docId, opts) {
  return requestJson(`/v1/dev/courses/${encodeURIComponent(courseId)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE', token, ...opts });
}
