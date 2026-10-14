import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamTutor } from '../api/tutorApi.js';
import { TUTOR_TEXTS } from './tutorTexts.js';
import { initialState, toApiMessages, tutorReducer } from './tutorReducer.js';

/** Estado del chat del Tutor + acciones. Encapsula el streaming y su cancelación. */
export function useTutorChat({ stream = streamTutor } = {}) {
  const [state, dispatch] = useReducer(tutorReducer, initialState);
  const abortRef = useRef(null);
  const chatKey = state.mode;

  const cancelPending = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Corta la respuesta en curso si se sale de la pantalla.
  useEffect(() => cancelPending, [cancelPending]);

  /** Pide la respuesta de `messages` (que termina en un mensaje del usuario) y la va escribiendo en `aiId`. */
  const request = useCallback(
    async (key, messages, aiId) => {
      const controller = new AbortController();
      abortRef.current = controller;
      let received = false;
      try {
        for await (const chunk of stream({ mode: key, messages, signal: controller.signal })) {
          received = true;
          dispatch({ type: 'send/chunk', aiId, text: chunk });
        }
        if (!received) throw new Error('Respuesta vacía');
        dispatch({ type: 'send/done', aiId });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn('[tutor] no se pudo obtener respuesta:', err.message);
        dispatch({ type: 'send/error', aiId, text: TUTOR_TEXTS.errorReply });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [stream],
  );

  const send = useCallback(
    (rawText) => {
      const text = rawText.trim();
      if (!text || state.pending) return;
      const userId = crypto.randomUUID();
      const aiId = crypto.randomUUID();
      const messages = toApiMessages([...state.chats[chatKey], { role: 'user', text }]);
      dispatch({ type: 'send/start', chatKey, userId, aiId, text });
      request(chatKey, messages, aiId);
    },
    [state.pending, state.chats, chatKey, request],
  );

  const retry = useCallback(() => {
    if (state.pending) return;
    const current = state.chats[chatKey];
    const err = current.find((m) => m.role === 'error');
    if (!err) return;
    const cleaned = current.filter((m) => m.role !== 'error' && m.id !== err.forId);
    const messages = toApiMessages(cleaned);
    if (messages.at(-1)?.role !== 'user') return;
    const aiId = crypto.randomUUID();
    dispatch({ type: 'error/dismiss', chatKey });
    dispatch({ type: 'send/retry', chatKey, aiId });
    request(chatKey, messages, aiId);
  }, [state.pending, state.chats, chatKey, request]);

  const stop = useCallback(() => {
    cancelPending();
    dispatch({ type: 'send/stop' });
  }, [cancelPending]);

  const clear = useCallback(() => {
    if (state.pending?.chatKey === chatKey) cancelPending();
    dispatch({ type: 'chat/clear', chatKey });
  }, [state.pending, chatKey, cancelPending]);

  const setMode = useCallback((mode) => dispatch({ type: 'mode/set', mode }), []);

  const messages = state.chats[chatKey];
  const isPendingHere = state.pending?.chatKey === chatKey;

  return {
    mode: chatKey,
    messages,
    isLoading: state.pending !== null,
    streamingId: isPendingHere ? state.pending.aiId : null,
    // Puntos de «escribiendo…» hasta que llega el primer fragmento de este chat.
    showTyping: isPendingHere && messages.at(-1)?.id !== state.pending.aiId,
    actions: { send, retry, stop, clear, setMode },
  };
}
