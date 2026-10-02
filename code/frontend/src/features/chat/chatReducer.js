// Estado del chat como reducer puro: fácil de testear y sin efectos.
// Las llamadas a la API viven en useChat.js.

/** @typedef {'tutor' | 'aula'} Mode */
/** @typedef {'tutor' | 'pruebas'} ChatKey  el Aula virtual no tiene chat */
/** @typedef {{id: string, role: 'user' | 'ai' | 'error', text: string}} Msg */
/** @typedef {{id: string, chatKey: ChatKey, title: string, createdAt: number, messages: Msg[]}} Entry */

export const initialState = {
  /** @type {Mode} */
  mode: 'tutor',
  /** @type {'chat' | 'pruebas'} solo aplica en modo tutor */
  view: 'chat',
  aulaNav: 'inicio',
  menuOpen: false,
  /** @type {Record<ChatKey, Msg[]>} */
  chats: { tutor: [], pruebas: [] },
  /** @type {Entry[]} conversaciones archivadas del modo Tutor */
  history: [],
  /** Respuesta en curso: a qué chat va y el id del mensaje de la IA. */
  /** @type {{chatKey: ChatKey, aiId: string} | null} */
  pending: null,
};

/** Chat activo del modo Tutor según la vista. */
export function activeChatKey(state) {
  return state.view === 'pruebas' ? 'pruebas' : 'tutor';
}

/** Convierte el chat al formato de la API, sin mensajes de error ni respuestas vacías. */
export function toApiMessages(messages) {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'ai') && m.text.trim())
    .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
}

/** Guarda el chat activo en el historial (si tiene mensajes) y lo deja vacío. */
function archiveActive(state, now) {
  if (state.mode !== 'tutor') return state;
  const key = activeChatKey(state);
  const messages = state.chats[key];
  if (!messages.length) return state;

  const firstUser = messages.find((m) => m.role === 'user');
  const entry = {
    id: `h-${now}`,
    chatKey: key,
    title: (key === 'pruebas' ? 'Prueba: ' : '') + (firstUser?.text ?? 'Conversación'),
    createdAt: now,
    messages,
  };
  return {
    ...state,
    chats: { ...state.chats, [key]: [] },
    history: [entry, ...state.history],
  };
}

function updateChat(state, key, update) {
  return { ...state, chats: { ...state.chats, [key]: update(state.chats[key]) } };
}

export function chatReducer(state, action) {
  switch (action.type) {
    case 'menu/open':
      return { ...state, menuOpen: true };
    case 'menu/close':
      return { ...state, menuOpen: false };

    case 'mode/set':
      return { ...state, mode: action.mode, view: 'chat' };
    case 'mode/toggle':
      return { ...state, mode: state.mode === 'aula' ? 'tutor' : 'aula', view: 'chat' };

    case 'view/pruebas':
      return { ...state, view: 'pruebas', menuOpen: false };
    case 'aulaNav/set':
      return { ...state, aulaNav: action.nav, menuOpen: false };

    case 'chat/new':
      return { ...archiveActive(state, action.now), pending: null, menuOpen: false };

    case 'history/open': {
      const entry = state.history.find((h) => h.id === action.id);
      if (!entry) return state;
      const archived = archiveActive(state, action.now);
      return {
        ...archived,
        pending: null,
        menuOpen: false,
        view: entry.chatKey === 'pruebas' ? 'pruebas' : 'chat',
        chats: { ...archived.chats, [entry.chatKey]: entry.messages },
        history: archived.history.filter((h) => h.id !== entry.id),
      };
    }

    case 'send/start':
      return {
        ...updateChat(state, action.chatKey, (msgs) => [
          ...msgs,
          { id: action.userId, role: 'user', text: action.text },
        ]),
        pending: { chatKey: action.chatKey, aiId: action.aiId },
      };

    case 'send/chunk': {
      // Ignora fragmentos de una respuesta cancelada (nueva conversación, historial…).
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

    case 'send/error': {
      if (state.pending?.aiId !== action.aiId) return state;
      const withError = updateChat(state, state.pending.chatKey, (msgs) => [
        ...msgs,
        { id: `${action.aiId}-error`, role: 'error', text: action.text },
      ]);
      return { ...withError, pending: null };
    }

    default:
      throw new Error(`Acción desconocida: ${action.type}`);
  }
}
