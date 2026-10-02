import { describe, expect, test } from 'vitest';
import { activeChatKey, chatReducer, initialState, toApiMessages } from './chatReducer.js';

const reduce = (actions, state = initialState) => actions.reduce(chatReducer, state);

function sendAndReply(state, chatKey, text, reply, n = 1) {
  return reduce(
    [
      { type: 'send/start', chatKey, userId: `u${n}`, aiId: `a${n}`, text },
      { type: 'send/chunk', aiId: `a${n}`, text: reply },
      { type: 'send/done', aiId: `a${n}` },
    ],
    state,
  );
}

describe('chatReducer', () => {
  test('cambiar al Aula virtual sale de Pruebas y vuelve al chat normal', () => {
    const pruebas = reduce([{ type: 'view/pruebas' }]);
    expect(activeChatKey(pruebas)).toBe('pruebas');

    const aula = chatReducer(pruebas, { type: 'mode/toggle' });
    expect(aula.mode).toBe('aula');
    expect(activeChatKey(chatReducer(aula, { type: 'mode/toggle' }))).toBe('tutor');
  });

  test('el Aula virtual no tiene chat: "nueva conversación" no archiva nada ahí', () => {
    const withChat = sendAndReply(initialState, 'tutor', 'hola', 'Hola');
    const inAula = chatReducer(withChat, { type: 'mode/set', mode: 'aula' });
    const state = chatReducer(inAula, { type: 'chat/new', now: 1 });
    expect(state.history).toEqual([]);
    expect(state.chats.tutor).toHaveLength(2);
  });

  test('el streaming arma un solo mensaje de la IA', () => {
    const state = reduce([
      { type: 'send/start', chatKey: 'tutor', userId: 'u1', aiId: 'a1', text: 'hola' },
      { type: 'send/chunk', aiId: 'a1', text: 'Ho' },
      { type: 'send/chunk', aiId: 'a1', text: 'la' },
      { type: 'send/done', aiId: 'a1' },
    ]);
    expect(state.chats.tutor).toEqual([
      { id: 'u1', role: 'user', text: 'hola' },
      { id: 'a1', role: 'ai', text: 'Hola' },
    ]);
    expect(state.pending).toBeNull();
  });

  test('la respuesta llega a su chat aunque se cambie de modo', () => {
    const state = reduce([
      { type: 'send/start', chatKey: 'tutor', userId: 'u1', aiId: 'a1', text: 'hola' },
      { type: 'mode/set', mode: 'aula' },
      { type: 'send/chunk', aiId: 'a1', text: 'respuesta' },
    ]);
    expect(state.chats.tutor.at(-1).text).toBe('respuesta');
  });

  test('un error agrega un aviso y libera el envío', () => {
    const state = reduce([
      { type: 'send/start', chatKey: 'tutor', userId: 'u1', aiId: 'a1', text: 'hola' },
      { type: 'send/error', aiId: 'a1', text: 'No pude responder ahora.' },
    ]);
    expect(state.chats.tutor.at(-1).role).toBe('error');
    expect(state.pending).toBeNull();
  });

  test('nueva conversación archiva el chat con el título de la primera pregunta', () => {
    const withChat = sendAndReply(initialState, 'tutor', 'Explícame las fracciones', 'Claro');
    const state = chatReducer(withChat, { type: 'chat/new', now: 1000 });
    expect(state.chats.tutor).toEqual([]);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ title: 'Explícame las fracciones', chatKey: 'tutor', createdAt: 1000 });
  });

  test('las pruebas archivadas llevan prefijo y se reabren en la vista Pruebas', () => {
    const inPruebas = sendAndReply(reduce([{ type: 'view/pruebas' }]), 'pruebas', 'Fracciones', 'Pregunta 1');
    const archived = chatReducer(inPruebas, { type: 'chat/new', now: 1 });
    expect(archived.history[0].title).toBe('Prueba: Fracciones');

    const backToChat = chatReducer(archived, { type: 'mode/set', mode: 'tutor' });
    const reopened = chatReducer(backToChat, { type: 'history/open', id: archived.history[0].id, now: 2 });
    expect(activeChatKey(reopened)).toBe('pruebas');
    expect(reopened.chats.pruebas).toHaveLength(2);
    expect(reopened.history).toHaveLength(0);
  });

  test('no archiva un chat vacío', () => {
    expect(chatReducer(initialState, { type: 'chat/new', now: 1 }).history).toEqual([]);
  });

  test('ignora fragmentos de una respuesta cancelada', () => {
    const state = reduce([
      { type: 'send/start', chatKey: 'tutor', userId: 'u1', aiId: 'a1', text: 'hola' },
      { type: 'chat/new', now: 1 },
      { type: 'send/chunk', aiId: 'a1', text: 'tarde' },
    ]);
    expect(state.chats.tutor).toEqual([]);
  });
});

describe('toApiMessages', () => {
  test('mapea roles y descarta avisos de error y respuestas vacías', () => {
    expect(
      toApiMessages([
        { id: '1', role: 'user', text: 'hola' },
        { id: '2', role: 'ai', text: 'Hola, ¿en qué te ayudo?' },
        { id: '3', role: 'error', text: 'No pude responder' },
        { id: '4', role: 'ai', text: '' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola, ¿en qué te ayudo?' },
    ]);
  });
});
