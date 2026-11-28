// Panel del apoderado (MVP 5): cálculos del resumen de un pupilo. Puro, sin React.

/**
 * Resumen de un pupilo: promedio general (simple, de los promedios de sus ramos con nota), cuántos ramos van bajo
 * 4,0 y cuántas evaluaciones tiene por rendir.
 * @param {{courses: {average: number|null, pending: object[]}[]}} pupilo
 */
export function resumenPupilo(pupilo) {
  const conNota = (pupilo?.courses ?? []).filter((c) => typeof c.average === 'number');
  const promedio = conNota.length ? Math.round((conNota.reduce((s, c) => s + c.average, 0) / conNota.length) * 10) / 10 : null;
  return {
    promedio,
    bajoCuatro: conNota.filter((c) => c.average < 4).length,
    pendientes: (pupilo?.courses ?? []).reduce((n, c) => n + (c.pending?.length ?? 0), 0),
  };
}
