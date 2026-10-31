import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamTutorMessage } from '../../api/chatApi.js';
import { getTutorConversation } from '../../api/portalApi.js';
import { useSession } from '../session/useSession.js';
import { fromSavedMessages, initialTutorState, isWaitingFirstChunk, tutorErrorText, tutorReducer } from '../utils/tutorChat.js';

/**
 * Conversación guardada con el Tutor IA sobre UN curso (ADR 0008), con el JWT de la sesión.
 * El servidor guarda pregunta y respuesta y tiene el historial: aquí solo se envía la pregunta nueva.
 *
 * @param {object} params
 * @param {string} params.courseId
 * @param {'tutor' | 'pruebas'} params.mode
 * @param {string | null} params.conversationId  conversación abierta; null = una nueva (el primer mensaje la crea)
 * @param {(conversationId: string) => void} [params.onSaved]  tras cada respuesta guardada (para refrescar la lista)
 */
export function useTutorChat({ courseId, mode, conversationId, onSaved }) {
  const { token, expire } = useSession();
  const [state, dispatch] = useReducer(tutorReducer, initialTutorState);
  // Mientras los mensajes en pantalla no sean los de la conversación abierta, está cargando.
  const loading = Boolean(conversationId) && conversationId !== state.shownId;
  const abortRef = useRef(null);
  // Conversación que está en pantalla. Una nueva recibe su id (UUID) con el primer mensaje.
  const currentIdRef = useRef(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Si se sale de la pantalla, se corta la respuesta en curso (y la generación en el servidor).
  useEffect(() => cancel, [cancel]);

  // Abrir otra conversación (o una nueva al cambiar de ramo o de modo). Si el id es el de la
  // conversación que acabamos de crear con el primer mensaje, no hay nada que cargar.
  useEffect(() => {
    if (conversationId && conversationId === currentIdRef.current) return undefined;
    cancel();
    dispatch({ type: 'reset' });
    currentIdRef.current = conversationId;
    if (!conversationId) return undefined;

    const controller = new AbortController();
    getTutorConversation(token, conversationId, { signal: controller.signal })
      .then(
        (conv) => {
          dispatch({ type: 'load', conversationId, messages: fromSavedMessages(conv.messages) });
        },
        (err) => {
          if (err?.name === 'AbortError') return;
          if (err?.status === 401) {
            expire();
            return;
          }
          const text = err?.status === 404 ? 'Esta conversación ya no existe.' : 'No pudimos abrir esta conversación. Inténtalo de nuevo.';
          dispatch({ type: 'load', conversationId, messages: [{ id: 'load-error', role: 'error', text }] });
        },
      );
    return () => controller.abort();
  }, [conversationId, courseId, mode, token, expire, cancel]);

  const send = useCallback(
    async (rawText) => {
      const text = rawText.trim();
      if (!text || state.pendingId || loading) return;

      currentIdRef.current ??= crypto.randomUUID();
      const id = currentIdRef.current;
      const userId = crypto.randomUUID();
      const aiId = crypto.randomUUID();
      dispatch({ type: 'start', conversationId: id, userId, aiId, text });

      const controller = new AbortController();
      abortRef.current = controller;
      let received = false;
      try {
        const stream = streamTutorMessage({
          courseId,
          conversationId: id,
          mode,
          content: text,
          token,
          signal: controller.signal,
          onMeta: ({ turn, sources }) => dispatch({ type: 'meta', aiId, turn, sources }),
        });
        for await (const chunk of stream) {
          received = true;
          dispatch({ type: 'chunk', aiId, text: chunk });
        }
        if (!received) throw new Error('Respuesta vacía');
        dispatch({ type: 'done', aiId });
        onSaved?.(id);
      } catch (err) {
        if (controller.signal.aborted) return;
        // Token vencido o revocado: la guardia lleva al login con un aviso.
        if (err?.status === 401) {
          expire();
          return;
        }
        dispatch({ type: 'error', aiId, text: tutorErrorText(err) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [state.pendingId, loading, mode, courseId, token, expire, onSaved],
  );

  /** Deja la pantalla lista para una conversación nueva (la anterior queda guardada). */
  const reset = useCallback(() => {
    cancel();
    currentIdRef.current = null;
    dispatch({ type: 'reset' });
  }, [cancel]);

  return {
    messages: state.messages,
    pendingId: state.pendingId,
    busy: state.pendingId !== null || loading,
    loading,
    typing: isWaitingFirstChunk(state),
    send,
    reset,
  };
}
