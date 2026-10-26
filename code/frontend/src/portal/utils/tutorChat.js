// Estado del Tutor IA del portal (puro, sin React): conversación, curso elegido y avisos de error.
// Las conversaciones se guardan en el servidor, solo visibles para el propio estudiante (ADR 0008);
// nunca en el navegador (localStorage), porque son textos de menores y hay equipos compartidos.

/** @typedef {{id: string, role: 'user' | 'ai' | 'error', text: string, sources?: {doc_id: string, score: number}[], turn?: string | null}} TutorMsg */

export const initialTutorState = {
  /** @type {TutorMsg[]} */
  messages: [],
  /** id del mensaje del tutor que se está escribiendo, o null */
  pendingId: null,
  /** conversación cuyos mensajes están en pantalla (cargada o recién creada), o null */
  shownId: null,
};

export function tutorReducer(state, action) {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        shownId: action.conversationId ?? state.shownId,
        messages: [...state.messages, { id: action.userId, role: 'user', text: action.text }],
        pendingId: action.aiId,
      };
    case 'meta':
    case 'chunk': {
      // Ignora lo que llegue de una respuesta cancelada.
      if (state.pendingId !== action.aiId) return state;
      const last = state.messages.at(-1);
      const current = last?.id === action.aiId ? last : { id: action.aiId, role: 'ai', text: '', sources: [], turn: null };
      const next =
        action.type === 'meta'
          ? { ...current, sources: action.sources, turn: action.turn }
          : { ...current, text: current.text + action.text };
      const rest = last?.id === action.aiId ? state.messages.slice(0, -1) : state.messages;
      return { ...state, messages: [...rest, next] };
    }
    case 'done':
      return state.pendingId === action.aiId ? { ...state, pendingId: null } : state;
    case 'error':
      if (state.pendingId !== action.aiId) return state;
      return {
        ...state,
        messages: [...state.messages, { id: `${action.aiId}-error`, role: 'error', text: action.text }],
        pendingId: null,
      };
    case 'load':
      return { messages: action.messages, pendingId: null, shownId: action.conversationId ?? null };
    case 'reset':
      return initialTutorState;
    default:
      throw new Error(`Acción desconocida: ${action.type}`);
  }
}

/**
 * Mensajes guardados (GET /v1/tutor-conversations/{id}) → mensajes de la pantalla.
 * @param {{role: 'user' | 'assistant', content: string, sources: {doc_id: string, score: number}[]}[]} saved
 * @returns {TutorMsg[]}
 */
export function fromSavedMessages(saved) {
  return saved.map((m, i) =>
    m.role === 'user'
      ? { id: `saved-${i}`, role: 'user', text: m.content }
      : { id: `saved-${i}`, role: 'ai', text: m.content, sources: m.sources ?? [], turn: null },
  );
}

/** ¿El mensaje del tutor ya empezó a llegar? (para mostrar los puntos de "escribiendo…" mientras no) */
export function isWaitingFirstChunk(state) {
  return state.pendingId !== null && !state.messages.some((m) => m.id === state.pendingId && m.text);
}

/**
 * Curso que muestra el tutor: el de la URL si es tuyo; si no hay, el primero con apuntes; si no, el primero.
 * @param {{course_id: string, tutor_available?: boolean}[]} ramos
 * @param {string | null} param  id del curso en la URL (#/portal/est-tutor/<id>)
 * @returns {{ramo: object | null, unknown: boolean}}  `unknown`: la URL pedía un curso que no es tuyo
 */
export function pickCourse(ramos, param) {
  if (param) {
    const ramo = ramos.find((r) => r.course_id === param);
    if (ramo) return { ramo, unknown: false };
  }
  const ramo = ramos.find((r) => r.tutor_available) ?? ramos[0] ?? null;
  return { ramo, unknown: Boolean(param) };
}

/** Texto para el estudiante según el error de la API (RFC 7807) o de red. */
export function tutorErrorText(error) {
  switch (error?.status) {
    case 404:
      return 'No encontré este curso o esta conversación entre los tuyos. Elige otro curso con la flecha junto a tu pregunta.';
    case 503:
      return 'El tutor no está disponible en este momento. Inténtalo de nuevo en unos minutos.';
    case 400:
    case 413:
    case 415:
      return error.message;
    default:
      return 'No pude responder. Revisa tu conexión e inténtalo de nuevo.';
  }
}

/**
 * Conversación elegida (abierta desde el historial o recién creada), atada al ramo y al modo en que se eligió.
 * @returns {{id: string, key: string}}
 */
export const chooseConversation = (id, courseId, mode) => ({ id, key: `${courseId}|${mode}` });

/**
 * Conversación abierta: la elegida, mientras sigan el mismo ramo y el mismo modo. Si el estudiante cambia
 * de ramo o de modo, se empieza una nueva (null); al volver al ramo y modo de antes, se reabre la elegida.
 * @param {{id: string, key: string} | null} chosen
 * @returns {string | null}
 */
export function activeConversationId(chosen, courseId, mode) {
  return chosen && chosen.key === `${courseId}|${mode}` ? chosen.id : null;
}

const HORA = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' });
const DIA = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' });

/** Fecha del historial: la hora si es de hoy ("14:05"); si no, el día ("19 oct"). En la zona horaria del navegador. */
export function shortDate(iso, now = new Date()) {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? HORA.format(d) : DIA.format(d);
}
