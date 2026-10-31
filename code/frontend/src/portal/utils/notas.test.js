import { describe, expect, it } from 'vitest';
import {
  contarNotas, formatNota, formatNumero, nombrePeriodo, periodosDe, primerNombre, promedioGeneral, tablaNotas, tonoNota,
} from './notas.js';

// Forma de GET /v1/me/grades (Camila en los datos demo).
const ramos = [
  { course_id: 'h', course: 'Historia 7° Básico A', subject: 'Historia', period: '2026-S2', average: 3.5,
    grades: [{ assessment_id: 'd4', title: 'Pueblos originarios', grade: 3.5, weight: 1 }] },
  { course_id: 'm', course: 'Matemáticas 7° Básico A', subject: 'Matemática', period: '2026-S2', average: 5.7,
    grades: [{ assessment_id: 'd1', title: 'Fracciones', grade: 7, weight: 1 }, { assessment_id: 'd2', title: 'Números decimales', grade: 5.1, weight: 2 }] },
  { course_id: 'c', course: 'Ciencias 7° Básico A', subject: 'Ciencias', period: '2026-S1', average: null, grades: [] },
];

describe('notas (escala 1,0–7,0, formato es-CL)', () => {
  it('formatea con coma decimal y un decimal; sin nota, guion', () => {
    expect(formatNota(5.7)).toBe('5,7');
    expect(formatNota(7)).toBe('7,0');
    expect(formatNota(null)).toBe('—');
    expect(formatNumero(2)).toBe('2');
    expect(formatNumero(1.5)).toBe('1,5');
  });

  it('bajo 4,0 es reprobatoria', () => {
    expect(tonoNota(3.9)).toBe('danger');
    expect(tonoNota(4)).toBe('success');
    expect(tonoNota(null)).toBe('neutral');
  });

  it('promedio general: promedio simple de los ramos con notas', () => {
    expect(promedioGeneral(ramos)).toBe(4.6); // (3,5 + 5,7) / 2
    expect(promedioGeneral([ramos[2]])).toBeNull();
    expect(contarNotas(ramos)).toBe(3);
  });

  it('tabla N1…Nk: tantas columnas como el ramo con más notas, celdas vacías en null', () => {
    const { columnas, filas } = tablaNotas(ramos);
    expect(columnas).toBe(2);
    expect(filas.map((f) => [f.asignatura, f.notas.map((n) => n?.grade ?? null), f.promedio])).toEqual([
      ['Historia', [3.5, null], 3.5],
      ['Matemática', [7, 5.1], 5.7],
      ['Ciencias', [null, null], null],
    ]);
    expect(tablaNotas([]).columnas).toBe(0);
  });

  it('períodos del más reciente al más antiguo, con nombre legible', () => {
    expect(periodosDe(ramos)).toEqual(['2026-S2', '2026-S1']);
    expect(nombrePeriodo('2026-S2')).toBe('2° semestre 2026');
  });

  it('primer nombre para el saludo', () => {
    expect(primerNombre('Camila Díaz')).toBe('Camila');
    expect(primerNombre(undefined)).toBe('');
  });
});
