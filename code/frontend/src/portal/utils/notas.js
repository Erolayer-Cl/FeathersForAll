// Notas en escala chilena 1,0–7,0: formato es-CL y armado de la tabla "Mis notas". Todo puro.

export const NOTA_APROBACION = 4;

const UN_DECIMAL = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const FECHA = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });

const NUMERO = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });

/** 2 -> "2", 1.5 -> "1,5" (ponderaciones y otros números en formato es-CL). */
export const formatNumero = (n) => (n === null || n === undefined ? '—' : NUMERO.format(n));

/** 5.7 -> "5,7". Sin nota -> "—". */
export const formatNota = (nota) => (nota === null || nota === undefined ? '—' : UN_DECIMAL.format(nota));

/** Tono del kit ui para una nota: bajo 4,0 es reprobatoria. */
export const tonoNota = (nota) => {
  if (nota === null || nota === undefined) return 'neutral';
  return nota < NOTA_APROBACION ? 'danger' : 'success';
};

/** "2026-09-26T…" -> "26 sept 2026". */
export const formatFecha = (iso) => (iso ? FECHA.format(new Date(iso)) : '—');

/** "Camila Díaz" -> "Camila". */
export const primerNombre = (nombre) => (nombre ?? '').trim().split(/\s+/)[0] ?? '';

/** Promedio general: promedio simple de los promedios de cada ramo con notas, a un decimal. */
export function promedioGeneral(ramos) {
  const promedios = ramos.map((r) => r.average).filter((a) => a !== null && a !== undefined);
  if (promedios.length === 0) return null;
  return Math.round((promedios.reduce((a, b) => a + b, 0) / promedios.length) * 10) / 10;
}

/** Cantidad de notas registradas en todos los ramos. */
export const contarNotas = (ramos) => ramos.reduce((n, r) => n + r.grades.length, 0);

/** Períodos presentes en los ramos, del más reciente al más antiguo ("2026-S2", "2026-S1"…). */
export const periodosDe = (ramos) => [...new Set(ramos.map((r) => r.period).filter(Boolean))].sort().reverse();

/** "2026-S2" -> "2° semestre 2026". */
export function nombrePeriodo(periodo) {
  const m = /^(\d{4})-S([12])$/.exec(periodo ?? '');
  return m ? `${m[2]}° semestre ${m[1]}` : periodo;
}

/**
 * Tabla de "Mis notas": una fila por ramo y columnas N1…Nk, donde k es la mayor cantidad de notas
 * de un ramo. Los ramos con menos notas dejan celdas vacías (null).
 * @returns {{columnas: number, filas: {id: string, asignatura: string, curso: string, notas: (object|null)[], promedio: number|null}[]}}
 */
export function tablaNotas(ramos) {
  const columnas = Math.max(0, ...ramos.map((r) => r.grades.length));
  const filas = ramos.map((r) => ({
    id: r.course_id,
    asignatura: r.subject ?? r.course,
    curso: r.course,
    notas: Array.from({ length: columnas }, (_, i) => r.grades[i] ?? null),
    promedio: r.average,
  }));
  return { columnas, filas };
}
