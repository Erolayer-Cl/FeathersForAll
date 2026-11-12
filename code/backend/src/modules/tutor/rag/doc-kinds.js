// Qué es cada documento del curso y a qué nivel aplica.
//
// Un curso mezcla dos tipos de documentos:
//   - apuntes del docente  -> la fuente principal: lo que se enseñó en clase.
//   - referencias oficiales -> las Bases Curriculares del Mineduc ("MINEDUC · …"): dicen QUÉ se espera que
//     aprenda cada nivel (objetivos, ejes, habilidades), pero no son un texto de estudio ni explican cómo se
//     resuelve un ejercicio. Si compiten con los apuntes en cada pregunta, el tutor termina citando
//     objetivos de aprendizaje en vez de enseñar (ver el caso "1+1" → "Sumar números hasta 20…").
//
// La convención que ya usa el proyecto es el prefijo "MINEDUC" en el nombre del documento
// (scripts/mineduc-catalogo.json), así que no hace falta cambiar el esquema de la base.

/** minúsculas, sin tildes ni signos, espacios simples */
function fold(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Es un documento oficial de referencia (Bases Curriculares del Mineduc) y no un apunte del docente? */
export const isReferenceDoc = (docId) => /^MINEDUC\b/i.test(docId ?? '');

/**
 * Nivel de un curso a partir del campo `nivel` de la base ("7B", "2M", "7° Básico", "3° medio", "NT1"…).
 * @returns {{stage: 'basico' | 'medio' | 'parvularia', grade: number | null} | null}  null si no se reconoce
 */
export function parseLevel(nivel) {
  const t = fold(nivel);
  if (!t) return null;
  if (/parvul|^nt ?[12]$|prekinder|kinder|sala cuna|medio (menor|mayor)|transicion/.test(t)) return { stage: 'parvularia', grade: null };
  const m = /(\d{1,2})\s*(?:ro|do|to|mo|vo|no|er|\u00ba|\u00b0)?\s*(b|m)(?:asico|edio)?\b/.exec(t) ?? /(\d{1,2})\s*(?:ro|do|to|mo|vo|no|er)?\s*(basico|medio)/.exec(t);
  if (!m) return null;
  const grade = Number(m[1]);
  const stage = m[2].startsWith('b') ? 'basico' : 'medio';
  if ((stage === 'basico' && (grade < 1 || grade > 8)) || (stage === 'medio' && (grade < 1 || grade > 4))) return null;
  return { stage, grade };
}

/**
 * ¿Las Bases Curriculares de este documento sirven para el nivel del curso?
 * Se lee el nivel del título ("1° a 6° básico", "7° básico a 2° medio", "3° y 4° medio", "Educación Parvularia").
 * Si el curso no tiene nivel reconocible o el título no dice nivel, no se excluye (mejor mostrar de más que de menos).
 */
export function referenceAppliesToLevel(docId, nivel) {
  const level = parseLevel(nivel);
  if (!level) return true;
  const t = fold(docId);

  if (/parvularia/.test(t)) return level.stage === 'parvularia';
  if (level.stage === 'parvularia') return false;
  if (/formacion diferenciada|tecnico profesional/.test(t)) return level.stage === 'medio' && level.grade >= 3;

  // "7° básico a 2° medio": desde 7° básico en adelante, y hasta 2° medio
  const across = /(\d)\s*basico\s+a\s+(\d)\s*medio/.exec(t);
  if (across) return level.stage === 'basico' ? level.grade >= Number(across[1]) : level.grade <= Number(across[2]);

  // "1° a 6° básico", "3° y 4° medio"
  const range = /(\d)\s*(?:a|y|al)\s*(\d)\s*(basico|medio)/.exec(t);
  if (range) return level.stage === range[3] && level.grade >= Number(range[1]) && level.grade <= Number(range[2]);

  return true;
}

// ---------------------------------------------------------------- asignatura

// Cada asignatura con las formas en que aparece en el nombre de un curso ("Matemáticas 7° Básico A", "Lenguaje") o
// en el nombre de un documento ("MINEDUC · Lengua y Literatura · 7° básico a 2° medio"). El ORDEN importa: se toma
// la primera que calza, así "Educación Física" no se confunde con "Física" ni "Lengua y Cultura de los Pueblos
// Originarios" con "Lengua".
const SUBJECTS = [
  ['pueblos-originarios', ['pueblos originarios', 'mapudungun', 'aymara', 'quechua', 'rapa nui', 'kawesqar', 'lengua y cultura']],
  ['educacion-fisica', ['educacion fisica', 'ed fisica', 'deporte', 'salud']],
  ['educacion-ciudadana', ['educacion ciudadana', 'ciudadania', 'civica']],
  ['artes-visuales', ['artes visuales', 'arte', 'artes']],
  ['ciclo-exploratorio', ['ciclo exploratorio']],
  ['tecnico-profesional', ['formacion diferenciada', 'tecnico profesional']],
  ['historia', ['historia', 'geografia', 'ciencias sociales', 'sociales']],
  ['matematica', ['matematica', 'matematicas', 'algebra', 'geometria', 'calculo']],
  ['lengua', ['lengua y literatura', 'lenguaje', 'lengua', 'literatura', 'comunicacion', 'castellano', 'espanol']],
  ['ciencias', ['ciencias naturales', 'ciencias', 'naturales', 'biologia', 'quimica', 'fisica']],
  ['ingles', ['ingles', 'idioma extranjero', 'english']],
  ['musica', ['musica']],
  ['tecnologia', ['tecnologia', 'computacion', 'informatica']],
  ['orientacion', ['orientacion']],
  ['filosofia', ['filosofia']],
  ['teatro', ['teatro', 'artes escenicas']],
  ['danza', ['danza']],
];

/** Clave de asignatura de un texto ("Matemáticas 7° Básico A" → "matematica"), o null si no se reconoce. */
export function subjectKey(text) {
  const t = ` ${fold(text)} `;
  if (t.trim() === '') return null;
  for (const [key, aliases] of SUBJECTS) {
    if (aliases.some((a) => t.includes(` ${a} `))) return key;
  }
  return null;
}

/**
 * Asignatura de un documento de las Bases, a partir de su nombre "MINEDUC · Matemática · 7° básico a 2° medio".
 * null = documento general (introducciones, decretos, o las Bases antiguas "MINEDUC · Bases Curriculares 1° a 6° básico").
 */
export function referenceSubject(docId) {
  const parts = (docId ?? '').split(' · ');
  if (parts.length < 2 || !isReferenceDoc(docId)) return null;
  if (/^(bases curriculares|objetivos fundamentales|introducciones)/.test(fold(parts[1]))) return null;
  return subjectKey(parts[1]);
}

/**
 * ¿Las Bases de este documento son de la asignatura del curso? Los documentos generales aplican a todos.
 * Si no se sabe la asignatura del curso (o no se reconoce), no se excluye nada.
 * @param {string} docId
 * @param {string | null | undefined} courseSubject  asignatura o nombre del curso
 */
export function referenceAppliesToSubject(docId, courseSubject) {
  const docKey = referenceSubject(docId);
  if (!docKey) return true;
  const courseKey = subjectKey(courseSubject);
  return courseKey === null || courseKey === docKey;
}
