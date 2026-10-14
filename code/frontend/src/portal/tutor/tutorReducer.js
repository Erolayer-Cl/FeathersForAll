// Estado del chat del Tutor IA como reducer puro (fácil de probar, sin efectos).
// Las llamadas a la API viven en useTutorChat.js.

/** @typedef {'tutor' | 'pruebas'} ChatKey */
/** @typedef {{id: string, role: 'user' | 'ai' | 'error', text: string, forId?: string}} Msg */

export const initialState = {
  /** @type {ChatKey} */
  mode: 'tutor',
  /** @type {Record<ChatKey, Msg[]>} */
  chats: { tutor: [], pruebas: [] },
  /** Respuesta en curso: a qué chat va y el id del mensaje de la IA. */
  /** @type {{chatKey: ChatKey, aiId: string} | null} */
  pending: null,
};

/** Convierte el chat al formato de la API, sin mensajes de error ni respuestas vacías. */
export function toApiMessages(messages) {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'ai') && m.text.trim())
    .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
}

function updateChat(state, key, update) {
  return { ...state, chats: { ...state.chats, [key]: update(state.chats[key]) } };
}

export function tutorReducer(state, action) {
  switch (action.type) {
    case 'mode/set':
      return state.mode === action.mode ? state : { ...state, mode: action.mode };

    case 'chat/clear':
      return { ...updateChat(state, action.chatKey, () => []), pending: state.pending?.chatKey === action.chatKey ? null : state.pending };

    case 'send/start':
      return {
        ...updateChat(state, action.chatKey, (msgs) => [...msgs, { id: action.userId, role: 'user', text: action.text }]),
        pending: { chatKey: action.chatKey, aiId: action.aiId },
      };

    // Reintento: el mensaje del usuario ya está en el chat; solo se vuelve a pedir la respuesta.
    case 'send/retry':
      return { ...state, pending: { chatKey: action.chatKey, aiId: action.aiId } };

    case 'send/chunk': {
      // Ignora fragmentos de una respuesta cancelada (chat nuevo, botón detener…).
      if (state.pending?.aiId !== action.aiId) return state;
      const { chatKey, aiId } = state.pending;
      return updateChat(state, chatKey, (msgs) => {
        const last = msgs.at(-1);
        if (last?.id === aiId) return [...msgs.slice(0, -1), { ...last, text: last.text + action.text }];
        return [...msgs, { id: aiId, role: 'ai', text: action.text }];
      });
    }

    case 'send/done':
      return state.pending?.aiId === action.aiId ? { ...state, pending: null } : state;

    // El usuario pulsó «Detener»: se conserva lo que ya llegó.
    case 'send/stop':
      return { ...state, pending: null };

    case 'send/error': {
      if (state.pending?.aiId !== action.aiId) return state;
      const withError = updateChat(state, state.pending.chatKey, (msgs) => [
        ...msgs,
        { id: `${action.aiId}-error`, role: 'error', text: action.text, forId: action.aiId },
      ]);
      return { ...withError, pending: null };
    }

    // Antes de reintentar: quita el aviso de error y la respuesta a medias que lo precedía.
    case 'error/dismiss':
      return updateChat(state, action.chatKey, (msgs) => {
        const err = msgs.find((m) => m.role === 'error');
        return err ? msgs.filter((m) => m.role !== 'error' && m.id !== err.forId) : msgs;
      });

    default:
      throw new Error(`Acción desconocida: ${action.type}`);
  }
}
