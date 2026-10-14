import { describe, expect, it } from 'vitest';
import { initialState, toApiMessages, tutorReducer as reduce } from './tutorReducer.js';

const start = (s = initialState, over = {}) =>
  reduce(s, { type: 'send/start', chatKey: 'tutor', userId: 'u1', aiId: 'a1', text: 'Hola', ...over });

describe('tutorReducer', () => {
  it('agrega el mensaje del usuario y marca la respuesta en curso', () => {
    const s = start();
    expect(s.chats.tutor).toEqual([{ id: 'u1', role: 'user', text: 'Hola' }]);
    expect(s.pending).toEqual({ chatKey: 'tutor', aiId: 'a1' });
  });

  it('arma la respuesta con los fragmentos y termina', () => {
    let s = start();
    s = reduce(s, { type: 'send/chunk', aiId: 'a1', text: 'Ho' });
    s = reduce(s, { type: 'send/chunk', aiId: 'a1', text: 'la' });
    s = reduce(s, { type: 'send/done', aiId: 'a1' });
    expect(s.chats.tutor.at(-1)).toEqual({ id: 'a1', role: 'ai', text: 'Hola' });
    expect(s.pending).toBeNull();
  });

  it('ignora fragmentos de una respuesta cancelada', () => {
    let s = start();
    s = reduce(s, { type: 'send/stop' });
    s = reduce(s, { type: 'send/chunk', aiId: 'a1', text: 'tarde' });
    expect(s.chats.tutor).toHaveLength(1);
  });

  it('«Detener» conserva lo que ya llegó', () => {
    let s = start();
    s = reduce(s, { type: 'send/chunk', aiId: 'a1', text: 'Parcial' });
    s = reduce(s, { type: 'send/stop' });
    expect(s.chats.tutor.at(-1).text).toBe('Parcial');
    expect(s.pending).toBeNull();
  });

  it('un error agrega el aviso y reintentar quita aviso y respuesta a medias', () => {
    let s = start();
    s = reduce(s, { type: 'send/chunk', aiId: 'a1', text: 'Med' });
    s = reduce(s, { type: 'send/error', aiId: 'a1', text: 'Falló' });
    expect(s.chats.tutor.at(-1)).toMatchObject({ role: 'error', forId: 'a1' });
    s = reduce(s, { type: 'error/dismiss', chatKey: 'tutor' });
    expect(s.chats.tutor).toEqual([{ id: 'u1', role: 'user', text: 'Hola' }]);
  });

  it('los dos chats son independientes y «nueva conversación» solo vacía el activo', () => {
    let s = start();
    s = reduce(s, { type: 'send/done', aiId: 'a1' });
    s = reduce(s, { type: 'mode/set', mode: 'pruebas' });
    expect(s.chats.pruebas).toHaveLength(0);
    s = reduce(s, { type: 'chat/clear', chatKey: 'tutor' });
    expect(s.chats.tutor).toHaveLength(0);
  });

  it('toApiMessages usa el formato del backend y omite errores y vacíos', () => {
    expect(
      toApiMessages([
        { id: '1', role: 'user', text: 'Hola' },
        { id: '2', role: 'ai', text: 'Qué tal' },
        { id: '3', role: 'error', text: 'x' },
        { id: '4', role: 'ai', text: '  ' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: 'Qué tal' },
    ]);
  });
});
