// Evaluaciones: etiquetas de estado, el borrador que arma el docente y las respuestas que envía el estudiante.
// Todo puro (sin React): se prueba aparte. Las reglas espejan las del servidor (contrato v1.4) para avisar antes
// de enviar; el servidor las vuelve a validar.

export const MAX_OPCIONES = 6;
export const MIN_OPCIONES = 2;

const ESTADOS = {
  draft: { label: 'Borrador', tone: 'neutral' },
  published: { label: 'Publicada', tone: 'success' },
  closed: { label: 'Cerrada', tone: 'warning' },
};

// El libro de notas y el resumen (gradebook, grades/summary) entregan el estado en español, como dice su
// contrato; las rutas de evaluaciones, en inglés. Se normaliza aquí para tratarlos igual.
const ALIAS_ESTADO = { borrador: 'draft', publicada: 'published', cerrada: 'closed' };

/** 'publicada' -> 'published'; los valores en inglés quedan igual. */
export const normalizarEstado = (status) => ALIAS_ESTADO[status] ?? status;

/** Etiqueta y tono del kit ui para el estado de una evaluación (acepta el estado en inglés o en español). */
export const estadoEvaluacion = (status) => ESTADOS[normalizarEstado(status)] ?? { label: status ?? '—', tone: 'neutral' };

let contador = 0;
/** Clave estable para la lista de preguntas del formulario (el índice cambia al borrar). */
const nuevaClave = () => `q${(contador += 1)}`;

export const preguntaVacia = () => ({ key: nuevaClave(), statement: '', options: ['', ''], correct: null, feedback: '' });
export const borradorVacio = () => ({ title: '', closesAt: '', questions: [preguntaVacia()] });

const preguntaDesdeApi = (q) => ({ key: nuevaClave(), statement: q.statement, options: [...q.options], correct: q.correct_option ?? null, feedback: q.feedback ?? '' });

/** ISO 8601 -> valor de <input type="datetime-local"> en hora local ("2026-11-20T18:30"). */
export function isoALocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Evaluación de la API (docente) -> borrador editable. */
export const borradorDesdeApi = (ev) => ({ title: ev.title, closesAt: isoALocal(ev.closes_at), questions: ev.questions.map(preguntaDesdeApi) });

/** Lo que propuso la IA -> borrador editable (sin cierre: eso lo decide el docente). */
export const borradorDesdeIa = (gen) => ({ title: gen.title, closesAt: '', questions: gen.questions.map(preguntaDesdeApi) });

/** ¿El borrador ya tiene algo escrito? (para avisar antes de que la IA lo reemplace) */
export const borradorTieneTexto = (draft) => draft.title.trim() !== '' || draft.questions.some((q) => q.statement.trim() !== '' || q.options.some((o) => o.trim() !== ''));

/** Opciones con texto, conservando su posición (la alternativa correcta es un índice). */
const conTexto = (q) => q.options.map((o) => o.trim());

/**
 * Problemas del borrador antes de enviarlo: { errores, avisos }.
 * `errores` impiden guardar; `avisos` no (falta la alternativa correcta: se puede guardar como borrador, no publicar).
 */
export function revisarBorrador(draft) {
  const errores = [];
  const avisos = [];
  if (draft.title.trim().length < 3) errores.push('Escribe un título de al menos 3 caracteres.');
  if (draft.questions.length === 0) errores.push('Agrega al menos una pregunta.');
  if (draft.closesAt && !(new Date(draft.closesAt).getTime() > Date.now())) errores.push('La fecha de cierre debe ser futura.');
  draft.questions.forEach((q, i) => {
    const n = i + 1;
    if (q.statement.trim().length < 3) errores.push(`Pregunta ${n}: escribe el enunciado (mínimo 3 caracteres).`);
    const opciones = conTexto(q);
    if (opciones.some((o) => o === '')) errores.push(`Pregunta ${n}: completa o quita las alternativas vacías.`);
    else if (new Set(opciones.map((o) => o.toLowerCase())).size !== opciones.length) errores.push(`Pregunta ${n}: hay alternativas repetidas.`);
    if (q.correct === null) avisos.push(`Pregunta ${n}: aún no marcas la alternativa correcta (la necesitas para publicar).`);
  });
  return { errores, avisos };
}

/** Borrador -> cuerpo de POST /v1/courses/{id}/assessments. */
export function borradorACuerpo(draft) {
  return {
    title: draft.title.trim(),
    ...(draft.closesAt && { closes_at: new Date(draft.closesAt).toISOString() }),
    questions: draft.questions.map((q) => ({
      statement: q.statement.trim(),
      options: conTexto(q),
      correct_option: q.correct,
      ...(q.feedback.trim() && { feedback: q.feedback.trim() }),
    })),
  };
}

/** Quita una alternativa y ajusta el índice de la correcta (si era esa, queda sin marcar; si estaba después, baja uno). */
export function quitarOpcion(question, index) {
  const options = question.options.filter((_, i) => i !== index);
  let correct = question.correct;
  if (correct === index) correct = null;
  else if (correct !== null && correct > index) correct -= 1;
  return { ...question, options, correct };
}

/** Respuestas elegidas ({ [question_id]: índice }) -> cuerpo de submissions. Solo las respondidas. */
export const respuestasACuerpo = (elegidas) =>
  Object.entries(elegidas).map(([question_id, selected_option]) => ({ question_id, selected_option }));

/** Preguntas todavía sin responder, para avisar antes de entregar. */
export const sinResponder = (questions, elegidas) => questions.filter((q) => elegidas[q.id] === undefined).length;

/** Años de período para el formulario de curso: el actual y los dos siguientes, con semestre. */
export function periodosDisponibles(hoy = new Date()) {
  const anio = hoy.getFullYear();
  const semestreActual = hoy.getMonth() < 6 ? 1 : 2;
  const lista = [];
  for (let a = anio; a <= anio + 1; a += 1) for (const s of [1, 2]) lista.push(`${a}-S${s}`);
  return { lista, porDefecto: `${anio}-S${semestreActual}` };
}
