import { describe, expect, it } from 'vitest';
import {
  estudiantesDeCursos, filtrarEstudiantes, leerNumero, leerParamEstudiante, paramEstudiante, tablaLibro, validarCalificacion,
} from './libroNotas.js';

describe('tablaLibro', () => {
  const libro = {
    assessments: [{ id: 'e1', title: 'Prueba 1' }, { id: 'e2', title: 'Prueba 2' }],
    students: [
      { student_id: 's1', name: 'Ana', average: 5.5, grades: { e1: 5, e2: 6 } },
      { student_id: 's2', name: 'Beto', average: 3.2, grades: { e2: 3.2 } },
      { student_id: 's3', name: 'Carla', average: null, grades: {} },
    ],
  };

  it('una columna por evaluación y null donde no rindió', () => {
    const { columnas, filas } = tablaLibro(libro);
    expect(columnas.map((c) => c.id)).toEqual(['e1', 'e2']);
    expect(filas.map((f) => f.notas)).toEqual([[5, 6], [null, 3.2], [null, null]]);
    expect(filas.map((f) => f.rendidas)).toEqual([2, 1, 0]);
    expect(filas[2].promedio).toBeNull();
  });

  it('sin datos entrega una tabla vacía', () => {
    expect(tablaLibro(undefined)).toEqual({ columnas: [], filas: [] });
  });
});

describe('leerNumero', () => {
  it('acepta coma o punto decimal y rechaza texto', () => {
    expect(leerNumero('60')).toBe(60);
    expect(leerNumero(' 1,5 ')).toBe(1.5);
    expect(leerNumero('2.25')).toBe(2.25);
    expect(leerNumero('')).toBeNull();
    expect(leerNumero('abc')).toBeNaN();
    expect(leerNumero('-3')).toBeNaN();
  });
});

describe('validarCalificacion (mismas reglas que el PATCH)', () => {
  const actual = { pass_threshold: 60, weight: 1 };

  it('solo envía lo que cambió', () => {
    expect(validarCalificacion({ exigencia: '50', ponderacion: '1' }, actual)).toEqual({ input: { pass_threshold: 50 } });
    expect(validarCalificacion({ exigencia: '60', ponderacion: '2,5' }, actual)).toEqual({ input: { weight: 2.5 } });
    expect(validarCalificacion({ exigencia: '70', ponderacion: '2' }, actual)).toEqual({ input: { pass_threshold: 70, weight: 2 } });
  });

  it('sin cambios no envía nada', () => {
    expect(validarCalificacion({ exigencia: '60', ponderacion: '1' }, actual)).toEqual({ error: 'No cambiaste nada.' });
  });

  it('exigencia fuera de 1–99 o ponderación ≤ 0 son errores', () => {
    for (const exigencia of ['0', '100', '', 'x']) {
      expect(validarCalificacion({ exigencia, ponderacion: '1' }, actual).error).toMatch(/exigencia/);
    }
    for (const ponderacion of ['0', '', '1000', 'y']) {
      expect(validarCalificacion({ exigencia: '60', ponderacion }, actual).error).toMatch(/ponderación/);
    }
  });
});

describe('estudiantes de varios cursos', () => {
  const cursos = [
    { curso: { id: 'c1', name: '7°A', subject: 'Matemática' }, matriculas: [{ student_id: 's2', name: 'Íñigo Pérez', email: 'inigo@demo.cl' }, { student_id: 's1', name: 'Ana Soto', email: 'ana@demo.cl' }] },
    { curso: { id: 'c2', name: '7°A Lenguaje' }, matriculas: [{ student_id: 's1', name: 'Ana Soto', email: 'ana@demo.cl' }] },
  ];

  it('no repite estudiantes y junta sus cursos, ordenados por nombre', () => {
    const lista = estudiantesDeCursos(cursos);
    expect(lista.map((e) => e.nombre)).toEqual(['Ana Soto', 'Íñigo Pérez']);
    expect(lista[0].cursos).toEqual([{ id: 'c1', nombre: 'Matemática' }, { id: 'c2', nombre: '7°A Lenguaje' }]);
  });

  it('el filtro ignora mayúsculas y tildes, y busca también por correo', () => {
    const lista = estudiantesDeCursos(cursos);
    expect(filtrarEstudiantes(lista, 'inigo').map((e) => e.id)).toEqual(['s2']);
    expect(filtrarEstudiantes(lista, 'ANA@').map((e) => e.id)).toEqual(['s1']);
    expect(filtrarEstudiantes(lista, '  ')).toHaveLength(2);
  });
});

describe('parámetro de la ruta doc-estudiante', () => {
  it('ida y vuelta con curso y estudiante', () => {
    expect(leerParamEstudiante(paramEstudiante('c1', 's1'))).toEqual({ courseId: 'c1', studentId: 's1' });
  });

  it('incompleto o con más partes es null', () => {
    expect(leerParamEstudiante('c1')).toBeNull();
    expect(leerParamEstudiante('c1/s1/x')).toBeNull();
    expect(leerParamEstudiante(null)).toBeNull();
  });
});
