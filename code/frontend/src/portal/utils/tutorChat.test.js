import { describe, expect, test } from 'vitest';
import {
  activeConversationId,
  chooseConversation,
  fromSavedMessages,
  initialTutorState,
  isWaitingFirstChunk,
  pickCourse,
  shortDate,
  tutorErrorText,
  tutorReducer,
} from './tutorChat.js';

const reduce = (actions, state = initialTutorState) => actions.reduce(tutorReducer, state);
const start = { type: 'start', userId: 'u1', aiId: 'a1', text: '¿Qué es el numerador?' };

describe('tutorReducer', () => {
  test('arma la respuesta por fragmentos y le agrega las fuentes', () => {
    const state = reduce([
      start,
      { type: 'meta', aiId: 'a1', turn: 'grounded', sources: [{ doc_id: 'fracciones.md', score: 0.7 }] },
      { type: 'chunk', aiId: 'a1', text: 'Indica cuántas ' },
      { type: 'chunk', aiId: 'a1', text: 'partes se toman [1].' },
      { type: 'done', aiId: 'a1' },
    ]);
    expect(state.pendingId).toBeNull();
    expect(state.messages).toEqual([
      { id: 'u1', role: 'user', text: '¿Qué es el numerador?' },
      { id: 'a1', role: 'ai', text: 'Indica cuántas partes se toman [1].', turn: 'grounded', sources: [{ doc_id: 'fracciones.md', score: 0.7 }] },
    ]);
  });

  test('mientras no llega texto se muestra "escribiendo…"', () => {
    const waiting = reduce([start, { type: 'meta', aiId: 'a1', turn: 'grounded', sources: [] }]);
    expect(isWaitingFirstChunk(waiting)).toBe(true);
    expect(isWaitingFirstChunk(tutorReducer(waiting, { type: 'chunk', aiId: 'a1', text: 'Hola' }))).toBe(false);
  });

  test('un error cierra la espera y queda como aviso (no se envía a la API)', () => {
    const state = reduce([start, { type: 'error', aiId: 'a1', text: 'El tutor no está disponible' }]);
    expect(state.pendingId).toBeNull();
    expect(state.messages.at(-1)).toMatchObject({ role: 'error', text: 'El tutor no está disponible' });
  });

  test('ignora fragmentos de una respuesta cancelada (nueva conversación)', () => {
    const state = reduce([start, { type: 'reset' }, { type: 'chunk', aiId: 'a1', text: 'tarde' }]);
    expect(state).toEqual(initialTutorState);
  });
});

describe('pickCourse', () => {
  const ramos = [
    { course_id: 'historia', tutor_available: false },
    { course_id: 'mate', tutor_available: true },
  ];

  test('usa el curso de la URL si es tuyo', () => {
    expect(pickCourse(ramos, 'historia')).toEqual({ ramo: ramos[0], unknown: false });
  });

  test('sin curso en la URL elige el primero con apuntes', () => {
    expect(pickCourse(ramos, null)).toEqual({ ramo: ramos[1], unknown: false });
  });

  test('un curso ajeno en la URL se avisa y se usa el de por defecto', () => {
    expect(pickCourse(ramos, 'de-otro-colegio')).toEqual({ ramo: ramos[1], unknown: true });
  });

  test('sin cursos no hay nada que elegir', () => {
    expect(pickCourse([], null)).toEqual({ ramo: null, unknown: false });
  });
});

describe('tutorErrorText', () => {
  test('explica los errores esperables y no muestra detalles técnicos del resto', () => {
    expect(tutorErrorText({ status: 503 })).toMatch(/no está disponible/);
    expect(tutorErrorText({ status: 404 })).toMatch(/flecha/);
    expect(tutorErrorText({ status: 400, message: '"messages" debe ser un arreglo' })).toBe('"messages" debe ser un arreglo');
    expect(tutorErrorText(new TypeError('Failed to fetch'))).toMatch(/conexión/);
    expect(tutorErrorText({ status: 500, message: 'stack…' })).not.toMatch(/stack/);
  });
});

describe('conversaciones guardadas', () => {
  const saved = [
    { role: 'user', content: '¿Qué es el numerador?', sources: [], created_at: '2026-10-19T12:00:00Z' },
    { role: 'assistant', content: 'Indica cuántas partes se toman [1].', sources: [{ doc_id: 'fracciones.md', score: 0.7 }], created_at: '2026-10-19T12:00:01Z' },
  ];

  test('fromSavedMessages convierte los mensajes de la API en mensajes de la pantalla', () => {
    expect(fromSavedMessages(saved)).toEqual([
      { id: 'saved-0', role: 'user', text: '¿Qué es el numerador?' },
      { id: 'saved-1', role: 'ai', text: 'Indica cuántas partes se toman [1].', sources: [{ doc_id: 'fracciones.md', score: 0.7 }], turn: null },
    ]);
  });

  test('"load" reemplaza la conversación en pantalla y corta cualquier espera', () => {
    const state = reduce([start, { type: 'load', conversationId: 'k1', messages: fromSavedMessages(saved) }]);
    expect(state.pendingId).toBeNull();
    expect(state.shownId).toBe('k1');
    expect(state.messages.map((m) => m.text)).toEqual(['¿Qué es el numerador?', 'Indica cuántas partes se toman [1].']);
  });

  test('el primer mensaje deja la conversación nueva en pantalla, y "reset" la quita', () => {
    const state = reduce([{ ...start, conversationId: 'k2' }]);
    expect(state.shownId).toBe('k2');
    expect(tutorReducer(state, { type: 'reset' }).shownId).toBeNull();
  });

  test('una respuesta que llega después de cargar otra conversación se ignora', () => {
    const state = reduce([start, { type: 'load', messages: [] }, { type: 'chunk', aiId: 'a1', text: 'tarde' }]);
    expect(state.messages).toEqual([]);
  });
});

describe('qué conversación está abierta', () => {
  const elegida = chooseConversation('k1', 'mate', 'tutor');

  test('sin elegir ninguna, se empieza una nueva', () => {
    expect(activeConversationId(null, 'mate', 'tutor')).toBeNull();
  });

  test('la elegida sigue abierta mientras no cambien el ramo ni el modo', () => {
    expect(activeConversationId(elegida, 'mate', 'tutor')).toBe('k1');
  });

  test('cambiar de ramo o de modo empieza una nueva (no se mezclan contextos)', () => {
    expect(activeConversationId(elegida, 'historia', 'tutor')).toBeNull();
    expect(activeConversationId(elegida, 'mate', 'pruebas')).toBeNull();
  });

  test('al volver al ramo y modo de antes, se reabre la elegida', () => {
    expect(activeConversationId(elegida, 'historia', 'tutor')).toBeNull();
    expect(activeConversationId(elegida, 'mate', 'tutor')).toBe('k1');
  });

  test('abrir desde el historial una conversación de otro modo la ata a ese modo', () => {
    const prueba = chooseConversation('k2', 'mate', 'pruebas');
    expect(activeConversationId(prueba, 'mate', 'pruebas')).toBe('k2');
    expect(activeConversationId(prueba, 'mate', 'tutor')).toBeNull();
  });
});

describe('shortDate', () => {
  const now = new Date(2026, 9, 19, 18, 30); // 19-10-2026, hora local

  test('si es de hoy muestra la hora', () => {
    const texto = shortDate(new Date(2026, 9, 19, 9, 5).toISOString(), now);
    expect(texto).toMatch(/09:05|9:05/);
  });

  test('si es de otro día muestra día y mes', () => {
    const texto = shortDate(new Date(2026, 9, 18, 23, 59).toISOString(), now);
    expect(texto).toMatch(/^18/);
    expect(texto).toMatch(/oct/i);
  });
});
