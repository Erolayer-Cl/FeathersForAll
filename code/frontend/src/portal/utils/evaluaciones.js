// Evaluaciones: etiquetas de estado, el borrador que arma el docente y las respuestas que envía el estudiante.
// Todo puro (sin React): se prueba aparte. Las reglas espejan las del servidor (contrato v1.10) para avisar antes
// de enviar; el servidor las vuelve a validar.

export const MAX_OPCIONES = 6;
export const MIN_OPCIONES = 2;
/** Respuestas aceptadas por pregunta de texto (v1.10). */
export const MAX_ACEPTADAS = 10;

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

/**
 * Pregunta del formulario. `type`: 'multiple_choice' (alternativas, con `correct`) o 'text' (respuesta escrita, con
 * `accepted`: las respuestas que se dan por correctas). Se guardan las dos listas para no perder lo escrito si el
 * docente cambia de tipo y vuelve.
 */
export const preguntaVacia = (type = 'multiple_choice') => ({ key: nuevaClave(), type, statement: '', options: ['', ''], correct: null, accepted: [''], feedback: '' });
// durationMin: minutos por intento (v1.12), como texto del <input>; '' = sin límite propio.
export const borradorVacio = () => ({ title: '', closesAt: '', durationMin: '', questions: [preguntaVacia()] });

const preguntaDesdeApi = (q) => {
  const texto = q.type === 'text';
  return {
    key: nuevaClave(),
    type: texto ? 'text' : 'multiple_choice',
    statement: q.statement,
    options: texto ? ['', ''] : [...q.options],
    correct: texto ? null : q.correct_option ?? null,
    accepted: texto && q.accepted_answers?.length ? [...q.accepted_answers] : [''],
    feedback: q.feedback ?? '',
  };
};

/** ISO 8601 -> valor de <input type="datetime-local"> en hora local ("2026-11-20T18:30"). */
export function isoALocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Evaluación de la API (docente) -> borrador editable. */
export const borradorDesdeApi = (ev) => ({ title: ev.title, closesAt: isoALocal(ev.closes_at), durationMin: ev.duration_minutes ? String(ev.duration_minutes) : '', questions: ev.questions.map(preguntaDesdeApi) });

/** Lo que propuso la IA -> borrador editable (sin cierre: eso lo decide el docente). */
export const borradorDesdeIa = (gen) => ({ title: gen.title, closesAt: '', durationMin: '', questions: gen.questions.map(preguntaDesdeApi) });

/** ¿El borrador ya tiene algo escrito? (para avisar antes de que la IA lo reemplace) */
export const borradorTieneTexto = (draft) => draft.title.trim() !== '' || draft.questions.some((q) => q.statement.trim() !== '' || q.options.some((o) => o.trim() !== '') || q.accepted.some((a) => a.trim() !== ''));

/** Respuestas aceptadas con texto (las vacías se ignoran: el último campo suele quedar en blanco). */
const aceptadas = (q) => q.accepted.map((a) => a.trim()).filter(Boolean);

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
  const min = String(draft.durationMin ?? '').trim();
  if (min && !(/^\d+$/.test(min) && Number(min) >= 1 && Number(min) <= 600)) errores.push('El tiempo por estudiante debe ser un número entero de minutos entre 1 y 600.');
  draft.questions.forEach((q, i) => {
    const n = i + 1;
    if (q.statement.trim().length < 3) errores.push(`Pregunta ${n}: escribe el enunciado (mínimo 3 caracteres).`);
    if (q.type === 'text') {
      const lista = aceptadas(q);
      if (new Set(lista.map((a) => a.toLowerCase())).size !== lista.length) errores.push(`Pregunta ${n}: hay respuestas aceptadas repetidas.`);
      // Sin respuestas aceptadas no es un error: el docente revisa cada respuesta a mano (v1.11).
      return;
    }
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
    // PUT reemplaza todo: sin minutos se manda null para quitar el límite que tuviera.
    duration_minutes: String(draft.durationMin ?? '').trim() ? Number(draft.durationMin) : null,
    questions: draft.questions.map((q) => ({
      statement: q.statement.trim(),
      ...(q.type === 'text'
        ? { type: 'text', accepted_answers: aceptadas(q) }
        : { options: conTexto(q), correct_option: q.correct }),
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

/**
 * Respuestas ({ [question_id]: índice | texto }) -> cuerpo de submissions. Un número es la alternativa elegida; un
 * texto, la respuesta escrita. Solo van las respondidas (un texto en blanco no cuenta).
 */
export const respuestasACuerpo = (elegidas) =>
  Object.entries(elegidas)
    .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))
    .map(([question_id, v]) => (typeof v === 'number' ? { question_id, selected_option: v } : { question_id, text_answer: v.trim() }));

/** ¿Esta pregunta ya tiene respuesta? (alternativa elegida o texto no vacío) */
export const respondida = (valor) => typeof valor === 'number' || (typeof valor === 'string' && valor.trim() !== '');

/** Preguntas todavía sin responder, para avisar antes de entregar. */
export const sinResponder = (questions, elegidas) => questions.filter((q) => !respondida(elegidas[q.id])).length;

/** Años de período para el formulario de curso: el actual y los dos siguientes, con semestre. */
export function periodosDisponibles(hoy = new Date()) {
  const anio = hoy.getFullYear();
  const semestreActual = hoy.getMonth() < 6 ? 1 : 2;
  const lista = [];
  for (let a = anio; a <= anio + 1; a += 1) for (const s of [1, 2]) lista.push(`${a}-S${s}`);
  return { lista, porDefecto: `${anio}-S${semestreActual}` };
}
