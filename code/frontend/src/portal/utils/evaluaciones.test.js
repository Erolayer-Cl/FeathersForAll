import { describe, expect, it } from 'vitest';
import {
  borradorACuerpo, borradorVacio, estadoEvaluacion, periodosDisponibles, preguntaVacia, quitarOpcion, respuestasACuerpo, revisarBorrador, sinResponder,
} from './evaluaciones.js';

const pregunta = (extra = {}) => ({ ...preguntaVacia(), statement: '¿Cuánto es 3/4 + 1/4?', options: ['1/2', '1', '4/8'], correct: 1, feedback: 'Es 1.', ...extra });

describe('estado de una evaluación', () => {
  it('traduce draft, published y closed a etiqueta y tono', () => {
    expect(estadoEvaluacion('draft')).toEqual({ label: 'Borrador', tone: 'neutral' });
    expect(estadoEvaluacion('published')).toEqual({ label: 'Publicada', tone: 'success' });
    expect(estadoEvaluacion('closed')).toEqual({ label: 'Cerrada', tone: 'warning' });
    expect(estadoEvaluacion('otro').tone).toBe('neutral');
  });
});

describe('borrador de la evaluación', () => {
  it('parte con una pregunta de dos alternativas vacías, con claves distintas por pregunta', () => {
    const b = borradorVacio();
    expect(b.questions).toHaveLength(1);
    expect(b.questions[0].options).toEqual(['', '']);
    expect(b.questions[0].correct).toBeNull();
    expect(preguntaVacia().key).not.toBe(preguntaVacia().key);
  });

  it('un borrador completo no tiene errores ni avisos', () => {
    expect(revisarBorrador({ title: 'Prueba de fracciones', questions: [pregunta()] })).toEqual({ errores: [], avisos: [] });
  });

  it('avisa cada problema indicando el número de pregunta', () => {
    const { errores } = revisarBorrador({
      title: 'ab',
      questions: [pregunta({ statement: 'x' }), pregunta({ options: ['a', ''] }), pregunta({ options: ['igual', 'IGUAL'], correct: 0 })],
    });
    expect(errores).toEqual([
      'Escribe un título de al menos 3 caracteres.',
      'Pregunta 1: escribe el enunciado (mínimo 3 caracteres).',
      'Pregunta 2: completa o quita las alternativas vacías.',
      'Pregunta 3: hay alternativas repetidas.',
    ]);
  });

  it('sin alternativa correcta es un AVISO (se guarda como borrador), no un error', () => {
    const r = revisarBorrador({ title: 'Prueba', questions: [pregunta({ correct: null })] });
    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual(['Pregunta 1: aún no marcas la alternativa correcta (la necesitas para publicar).']);
  });

  it('sin preguntas es un error', () => {
    expect(revisarBorrador({ title: 'Prueba', questions: [] }).errores).toContain('Agrega al menos una pregunta.');
  });

  it('arma el cuerpo de la API: textos recortados, índice de la correcta y retroalimentación solo si hay', () => {
    const cuerpo = borradorACuerpo({ title: '  Prueba  ', questions: [pregunta({ statement: ' ¿Cuánto es? ', options: [' 1/2 ', '1'], correct: 1 }), pregunta({ feedback: '  ' , correct: null })] });
    expect(cuerpo).toEqual({
      title: 'Prueba',
      questions: [
        { statement: '¿Cuánto es?', options: ['1/2', '1'], correct_option: 1, feedback: 'Es 1.' },
        { statement: '¿Cuánto es 3/4 + 1/4?', options: ['1/2', '1', '4/8'], correct_option: null },
      ],
    });
  });

  it('quitar una alternativa ajusta el índice de la correcta', () => {
    const q = pregunta({ options: ['a', 'b', 'c', 'd'], correct: 2 });
    expect(quitarOpcion(q, 3)).toMatchObject({ options: ['a', 'b', 'c'], correct: 2 });
    expect(quitarOpcion(q, 0)).toMatchObject({ options: ['b', 'c', 'd'], correct: 1 });
    expect(quitarOpcion(q, 2)).toMatchObject({ options: ['a', 'b', 'd'], correct: null });
  });
});

describe('respuestas del estudiante', () => {
  it('arma el cuerpo con las preguntas respondidas', () => {
    expect(respuestasACuerpo({ q1: 1, q2: 0 })).toEqual([{ question_id: 'q1', selected_option: 1 }, { question_id: 'q2', selected_option: 0 }]);
    expect(respuestasACuerpo({})).toEqual([]);
  });

  it('cuenta las preguntas sin responder (la alternativa 0 SÍ es una respuesta)', () => {
    const preguntas = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
    expect(sinResponder(preguntas, { q1: 0 })).toBe(2);
    expect(sinResponder(preguntas, { q1: 0, q2: 2, q3: 1 })).toBe(0);
  });
});

describe('período del curso', () => {
  it('ofrece los semestres de este año y el siguiente, y propone el actual', () => {
    expect(periodosDisponibles(new Date(2026, 2, 10))).toEqual({ lista: ['2026-S1', '2026-S2', '2027-S1', '2027-S2'], porDefecto: '2026-S1' });
    expect(periodosDisponibles(new Date(2026, 10, 14)).porDefecto).toBe('2026-S2');
  });
});
