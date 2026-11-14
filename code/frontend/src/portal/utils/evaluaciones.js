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

/** Etiqueta y tono del kit ui para el estado de una evaluación. */
export const estadoEvaluacion = (status) => ESTADOS[status] ?? { label: status ?? '—', tone: 'neutral' };

let contador = 0;
/** Clave estable para la lista de preguntas del formulario (el índice cambia al borrar). */
const nuevaClave = () => `q${(contador += 1)}`;

export const preguntaVacia = () => ({ key: nuevaClave(), statement: '', options: ['', ''], correct: null, feedback: '' });
export const borradorVacio = () => ({ title: '', questions: [preguntaVacia()] });

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
