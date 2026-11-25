// Nociones básicas: lo mínimo que el tutor sabe SIN apuntes.
//
// Problema que resuelve: con la regla "responde solo con los apuntes", un estudiante que preguntaba
// "¿cuánto es 1+1?" o "¿qué es una fracción?" recibía "No encuentro eso en los apuntes", aunque sea lo más
// básico del colegio. Ahora el tutor tiene dos fuentes SEGURAS y acotadas, que no dependen de lo que el
// modelo "recuerde":
//
//   1. calculadora exacta (arithmetic.js): "1+1", "10x10", "3/4 + 1/2" los calcula el código;
//   2. glosario curado (basics-glossary.json): definiciones cortas de conceptos de enseñanza básica,
//      escritas por el equipo (no por el modelo).
//
// Los apuntes del docente siguen mandando: estas nociones se usan solo cuando los apuntes no responden
// (o el curso aún no tiene apuntes), y siempre se aclara que son ideas generales (ver withBasics).
//
// Cada curso solo ve el glosario de SU asignatura: en un curso de Lenguaje no tiene sentido explicar qué es un átomo.
// La asignatura sale del curso (cursos.asignatura, o su nombre) y se compara con la `materia` de cada entrada usando las
// mismas claves que el resto del RAG (doc-kinds.js). Si no se sabe la asignatura del curso (no se reconoce, o no hay
// base), no se filtra nada: es el comportamiento anterior y evita dejar sin nociones a un "Taller de robótica".
// La calculadora no depende de la asignatura: "2+2" se responde en cualquier curso.
//
// La regla es conservadora a propósito: solo se responde si TODAS las palabras importantes de la pregunta
// están en el glosario. "¿Qué es una fracción?" sí; "¿cómo se suman fracciones con distinto denominador?"
// no (eso es contenido del curso y va a los apuntes). Ante la duda, el camino de siempre.

import { readFileSync } from 'node:fs';
import { fold, isStopword } from './relevance.js';
import { solveArithmetic } from './arithmetic.js';
import { subjectKey } from './doc-kinds.js';

const GLOSSARY = JSON.parse(readFileSync(new URL('./basics-glossary.json', import.meta.url), 'utf8'));

const MAX_CONCEPTS = 3;
// Palabras de relleno propias de preguntas de definición (no dicen de qué trata la pregunta).
const FILLER = new Set(['sirve', 'sirven', 'llama', 'llaman', 'trata', 'existe', 'existen', 'importante', 'acerca', 'significado', 'define', 'defina', 'definir']);
// Varias nociones en una pregunta solo se juntan si el estudiante las enumera ("el área y el perímetro"): "la suma de
// fracciones" o "el área del círculo" son una sola idea compuesta, que es contenido del curso y no una definición suelta.
const ENUMERATION = /(?:\s(?:y|e|o|u|ni)\s|,)/i;
// Preguntas de procedimiento o de razón ("¿cómo se…?", "¿por qué…?"): son contenido del curso, no una noción básica.
const PROCEDURAL = /^(como|por que|porque|cuando|donde|cuanto|cuantos|cuanta|cuantas|en que|cual es la diferencia)\b/;

/**
 * Llave de una palabra para comparar singular y plural: sin tildes, sin plural ni -e final
 * ("fracciones" = "fracción", "continentes" = "continente").
 */
function key(word) {
  let w = fold(word);
  if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  else if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Llaves de las palabras importantes de un texto (3+ letras, sin palabras vacías ni de relleno, sin números). */
function keysOf(text) {
  const out = new Set();
  for (const token of fold(text).split(' ')) {
    if (token.length < 3 || /\d/.test(token) || isStopword(token) || FILLER.has(token)) continue;
    out.add(key(token));
  }
  return out;
}

// `subject` = clave de asignatura de la entrada ("Lenguaje" → "lengua"), la misma que usa doc-kinds.js para los cursos.
const INDEX = GLOSSARY.map((entry) => ({ entry, subject: subjectKey(entry.materia), keys: keysOf([entry.termino, ...entry.alias].join(' ')) }));

/** Claves de asignatura que tienen entradas en el glosario (para documentación y pruebas). */
export const GLOSSARY_SUBJECTS = [...new Set(INDEX.map((item) => item.subject))];

/**
 * Clave de asignatura de un curso ("Matemáticas 7° Básico A" → "matematica"), o null si no se reconoce.
 * Primero la asignatura declarada del curso; si no se reconoce, su nombre.
 * @param {{asignatura?: string | null, nombre?: string | null} | null | undefined} info  `courseInfo` del RAG
 */
export function courseSubjectKey(info) {
  return subjectKey(info?.asignatura) ?? subjectKey(info?.nombre);
}

/**
 * Entradas del glosario que, juntas, cubren TODAS las palabras importantes del texto. null si falta alguna.
 * @param {string} text
 * @param {{subject?: string | null}} [opts]  `subject`: solo se consideran las entradas de esa asignatura (clave de doc-kinds.js);
 *   sin ella, todo el glosario.
 * @returns {{materia: string, termino: string, definicion: string, ejemplo: string}[] | null}
 */
export function matchConcepts(text, { subject = null } = {}) {
  const wanted = keysOf(text);
  if (wanted.size === 0) return null;
  const remaining = new Set(wanted);
  const chosen = [];
  const maxConcepts = ENUMERATION.test(text ?? '') ? MAX_CONCEPTS : 1;
  while (remaining.size > 0 && chosen.length < maxConcepts) {
    // La entrada que cubre más palabras pendientes; si empatan, la más específica (con menos palabras propias).
    let best = null;
    let bestCovered = 0;
    for (const item of INDEX) {
      if (chosen.includes(item)) continue;
      if (subject && item.subject !== subject) continue;
      let covered = 0;
      for (const k of remaining) if (item.keys.has(k)) covered++;
      if (covered > bestCovered || (covered === bestCovered && covered > 0 && item.keys.size < best.keys.size)) {
        best = item;
        bestCovered = covered;
      }
    }
    if (!best) return null;
    chosen.push(best);
    for (const k of best.keys) remaining.delete(k);
  }
  return remaining.size === 0 ? chosen.map(({ entry }) => entry) : null;
}

/**
 * ¿Hay una noción básica que responda esta pregunta?
 *   - `lastUser`: el último mensaje del estudiante;
 *   - `query`: el mismo mensaje con el contexto de la pregunta anterior si era un seguimiento ("dame un ejemplo");
 *   - `subject`: clave de asignatura del curso (ver courseSubjectKey). Limita los CONCEPTOS a esa asignatura; el cálculo no.
 * @returns {null | {calc: ReturnType<typeof solveArithmetic>, concepts: null}
 *   | {calc: null, concepts: {materia: string, termino: string, definicion: string, ejemplo: string}[]}}
 */
export function findBasics({ lastUser, query, subject = null }) {
  const calc = solveArithmetic(lastUser);
  if (calc) return { calc, concepts: null };

  if (PROCEDURAL.test(fold(lastUser))) return null;
  for (const text of new Set([lastUser, query])) {
    const concepts = matchConcepts(text, { subject });
    if (concepts) return { calc: null, concepts };
  }
  return null;
}

/** Cuántas nociones tiene el glosario (para documentación y pruebas). */
export const GLOSSARY_SIZE = GLOSSARY.length;
