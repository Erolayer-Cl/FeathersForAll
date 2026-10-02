import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamChat } from '../../api/chatApi.js';
import { ERROR_REPLY } from '../../config/modes.js';
import { activeChatKey, chatReducer, initialState, toApiMessages } from './chatReducer.js';

/** Estado del chat + acciones. Encapsula el streaming y su cancelación. */
export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const abortRef = useRef(null);
  const chatKey = activeChatKey(state);

  const cancelPending = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Corta la respuesta en curso si el componente se desmonta.
  useEffect(() => cancelPending, [cancelPending]);

  const send = useCallback(
    async (rawText) => {
      const text = rawText.trim();
      if (!text || state.pending) return;

      const userId = crypto.randomUUID();
      const aiId = crypto.randomUUID();
      const messages = toApiMessages([...state.chats[chatKey], { role: 'user', text }]);
      dispatch({ type: 'send/start', chatKey, userId, aiId, text });

      const controller = new AbortController();
      abortRef.current = controller;
      let received = false;
      try {
        for await (const chunk of streamChat({ mode: chatKey, messages, signal: controller.signal })) {
          received = true;
          dispatch({ type: 'send/chunk', aiId, text: chunk });
        }
        if (!received) throw new Error('Respuesta vacía');
        dispatch({ type: 'send/done', aiId });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn('[chat] no se pudo obtener respuesta:', err.message);
        dispatch({ type: 'send/error', aiId, text: ERROR_REPLY });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [state.pending, state.chats, chatKey],
  );

  const actions = {
    send,
    openMenu: () => dispatch({ type: 'menu/open' }),
    closeMenu: () => dispatch({ type: 'menu/close' }),
    setMode: (mode) => dispatch({ type: 'mode/set', mode }),
    toggleMode: () => dispatch({ type: 'mode/toggle' }),
    openPruebas: () => dispatch({ type: 'view/pruebas' }),
    setAulaNav: (nav) => dispatch({ type: 'aulaNav/set', nav }),
    newChat: () => {
      cancelPending();
      dispatch({ type: 'chat/new', now: Date.now() });
    },
    openEntry: (id) => {
      cancelPending();
      dispatch({ type: 'history/open', id, now: Date.now() });
    },
  };

  const messages = state.chats[chatKey];
  const isPendingHere = state.pending?.chatKey === chatKey;

  return {
    state,
    chatKey,
    messages,
    history: state.history,
    isLoading: state.pending !== null,
    // Puntos de "escribiendo…" hasta que llega el primer fragmento de este chat.
    showTyping: isPendingHere && messages.at(-1)?.id !== state.pending.aiId,
    actions,
  };
}
