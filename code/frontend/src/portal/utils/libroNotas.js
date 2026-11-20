// Libro de notas del docente (H3): armado de la tabla, validación de exigencia y ponderación, y
// estudiantes de varios cursos. Todo puro, sin React.

/**
 * Tabla del libro: una columna por evaluación (en el orden de la API) y una fila por estudiante.
 * Una celda es null si el estudiante no la ha rendido.
 * @param {{assessments: object[], students: {student_id: string, name: string, average: number|null, grades: Record<string, number>}[]}} libro
 */
export function tablaLibro(libro) {
  const columnas = libro?.assessments ?? [];
  const filas = (libro?.students ?? []).map((s) => ({
    id: s.student_id,
    nombre: s.name,
    notas: columnas.map((c) => s.grades?.[c.id] ?? null),
    promedio: s.average ?? null,
    rendidas: columnas.filter((c) => s.grades?.[c.id] !== undefined && s.grades?.[c.id] !== null).length,
  }));
  return { columnas, filas };
}

/** "60" -> 60, "1,5" -> 1.5, "" -> null, "abc" -> NaN. Acepta coma decimal (es-CL). */
export function leerNumero(texto) {
  const limpio = String(texto ?? '').trim().replace(',', '.');
  if (limpio === '') return null;
  return /^\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : NaN;
}

/**
 * Valida el formulario de calificación con las mismas reglas que el backend (PATCH .../grading):
 * exigencia entre 1 y 99 (% de logro para el 4,0) y ponderación mayor que 0 (hasta 999).
 * Solo envía lo que cambió respecto de `actual`.
 * @returns {{input: {pass_threshold?: number, weight?: number}} | {error: string}}
 */
export function validarCalificacion({ exigencia, ponderacion }, actual = {}) {
  const e = leerNumero(exigencia);
  const p = leerNumero(ponderacion);
  if (e === null || Number.isNaN(e) || e < 1 || e > 99) return { error: 'La exigencia debe ser un número entre 1 y 99 (% de logro para el 4,0).' };
  if (p === null || Number.isNaN(p) || p <= 0 || p > 999) return { error: 'La ponderación debe ser un número mayor que 0.' };
  const input = {};
  if (e !== actual.pass_threshold) input.pass_threshold = e;
  if (p !== actual.weight) input.weight = p;
  if (Object.keys(input).length === 0) return { error: 'No cambiaste nada.' };
  return { input };
}

/**
 * Estudiantes de varios cursos, sin repetir: cada uno con la lista de sus cursos (del docente).
 * @param {{curso: {id: string, name: string, subject?: string}, matriculas: {student_id: string, name: string, email: string}[]}[]} cursos
 * @returns {{id: string, nombre: string, email: string, cursos: {id: string, nombre: string}[]}[]} ordenados por nombre
 */
export function estudiantesDeCursos(cursos) {
  const porId = new Map();
  for (const { curso, matriculas } of cursos) {
    for (const m of matriculas) {
      if (!porId.has(m.student_id)) porId.set(m.student_id, { id: m.student_id, nombre: m.name, email: m.email, cursos: [] });
      porId.get(m.student_id).cursos.push({ id: curso.id, nombre: curso.subject ?? curso.name });
    }
  }
  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Busca por nombre o correo, sin distinguir mayúsculas ni tildes. */
export function filtrarEstudiantes(lista, texto) {
  const normalizar = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = normalizar(texto).trim();
  if (!q) return lista;
  return lista.filter((e) => normalizar(e.nombre).includes(q) || normalizar(e.email).includes(q));
}

/** Parámetro de la ruta doc-estudiante: "<curso>/<estudiante>" (routeHref lo codifica como un solo segmento). */
export const paramEstudiante = (courseId, studentId) => `${courseId}/${studentId}`;

/** "<curso>/<estudiante>" -> { courseId, studentId }; null si no trae los dos. */
export function leerParamEstudiante(param) {
  const [courseId, studentId, ...resto] = String(param ?? '').split('/');
  return courseId && studentId && resto.length === 0 ? { courseId, studentId } : null;
}
