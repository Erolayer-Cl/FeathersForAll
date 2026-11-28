import { describe, expect, it } from 'vitest';
import { resumenPupilo } from './apoderado.js';

describe('resumen de un pupilo', () => {
  it('promedia los ramos con nota, cuenta los bajo 4,0 y lo pendiente', () => {
    const r = resumenPupilo({ courses: [
      { average: 5.5, pending: [{}] },
      { average: 3.8, pending: [] },
      { average: null, pending: [{}, {}] },
    ] });
    expect(r).toEqual({ promedio: 4.7, bajoCuatro: 1, pendientes: 3 });
  });
  it('sin ramos ni notas no rompe', () => {
    expect(resumenPupilo({ courses: [] })).toEqual({ promedio: null, bajoCuatro: 0, pendientes: 0 });
    expect(resumenPupilo(undefined)).toEqual({ promedio: null, bajoCuatro: 0, pendientes: 0 });
  });
});
