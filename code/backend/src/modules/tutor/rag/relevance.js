// Señales de relevancia que NO dependen del modelo de embeddings.
//
// Los embeddings miden "se parece en significado", y con consultas muy cortas ("1+1", "10x10", "dame un
// ejemplo") dan puntajes parecidos para casi cualquier texto del mismo tema general. Para decidir si un
// fragmento realmente responde la pregunta se suman tres señales baratas y deterministas:
//   1. cobertura: qué parte de las palabras importantes de la pregunta aparece en el fragmento;
//   2. expansión de consultas matemáticas: "10x10" no contiene la palabra "multiplicación", pero los apuntes sí;
//   3. intención curricular: solo si preguntan por objetivos/currículum se consultan las Bases del Mineduc.

/** minúsculas, sin tildes ni signos, espacios simples */
export function fold(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras que no dicen de qué trata la pregunta: artículos, preposiciones, pronombres, interrogativos y
// verbos de "pedir ayuda". Si contaran, "dame un ejemplo" calzaría con cualquier apunte que diga "por ejemplo".
const STOPWORDS = new Set(`
  que como cual cuales cuanto cuanta cuantos cuantas quien quienes donde cuando cuyo por porque para pero sino
  aunque sobre entre desde hasta hacia con sin segun ante bajo tras durante mediante
  los las del una uno unos unas este esta estos estas ese esa esos esas eso esto aquel aquella
  mis tus sus nuestro nuestra mio mia tuyo suyo
  muy mas menos tambien tampoco ademas solo solamente todo toda todos todas algo alguno alguna algun
  hay ser soy eres somos son era fue sera esta estan estoy estas estamos estaba tiene tienen tengo tienes
  puedo puedes puede pueden podria podrias podemos hacer hace haces hago
  quiero quieres quiere quisiera necesito necesita saber entender entiendo entendi aprender conocer
  explica explicame explicar explicas explicarme dime decir digo dame dar darme muestra muestrame mostrar
  ayuda ayudame ayudas ayudar favor porfa gracias hola
  ejemplo ejemplos significa significan concepto conceptos definicion definir tema temas materia clase
  pregunta respuesta resultado resultados cosa cosas vez veces
  the and`.split(/\s+/).filter(Boolean));

/** Raíz aproximada de una palabra: sin plural y recortada, para que "fracciones" calce con "fracción". */
export function stem(word) {
  let w = word;
  if (w.length > 5 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1);
  return w.slice(0, 6);
}

/** Raíces de las palabras importantes de un texto (3+ caracteres, sin palabras vacías). */
export function significantStems(text) {
  const out = new Set();
  for (const token of fold(text).split(' ')) {
    if (token.length < 3 || STOPWORDS.has(token)) continue;
    out.add(stem(token));
  }
  return out;
}

/**
 * Fracción (0–1) de las palabras importantes de la pregunta que aparecen en el fragmento.
 * Si la pregunta no tiene palabras importantes ("1+1", "¿y eso?") devuelve 0: no hay evidencia léxica posible.
 * @param {Set<string>} queryStems  de significantStems(pregunta)
 */
export function coverage(queryStems, chunkText) {
  if (queryStems.size === 0) return 0;
  const chunkStems = significantStems(chunkText);
  let hit = 0;
  for (const s of queryStems) if (chunkStems.has(s)) hit++;
  return hit / queryStems.size;
}

/**
 * Agrega a una consulta casi solo numérica las palabras que usan los apuntes para esa operación.
 * "10x10" → "10x10 multiplicación multiplicar producto"; "1+1" → "1+1 suma sumar adición".
 * Se ignora si la pregunta ya tiene palabras suficientes (ahí el embedding trabaja bien solo).
 */
export function expandMathQuery(query) {
  const q = query ?? '';
  if ((q.match(/\p{L}{3,}/gu) ?? []).length > 3) return q;
  const extra = [];
  if (/\d\s*[x×*·]\s*\d/i.test(q) || /[×·]/.test(q)) extra.push('multiplicación multiplicar producto tablas');
  if (/\d\s*\+\s*\d/.test(q)) extra.push('suma sumar adición');
  if (/\d\s*[-–−]\s*\d/.test(q)) extra.push('resta restar sustracción');
  if (/\d\s*[÷:]\s*\d/.test(q)) extra.push('división dividir cociente');
  if (/\d\s*\/\s*\d/.test(q)) extra.push('fracción fracciones división');
  if (/\^|\*\*/.test(q)) extra.push('potencia potencias exponente');
  if (/√/.test(q)) extra.push('raíz cuadrada');
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

/**
 * ¿La pregunta es solo una operación numérica ("1+1", "10x10", "cuánto es 3/4 + 1/2")? No tiene palabras que digan
 * de qué trata: sus números no sirven para buscar, y la expansión (`expandMathQuery`) agrega palabras como "suma"
 * que calzan con cualquier apunte que las mencione de pasada (p. ej. "suma de fracciones" para "1+1").
 * Para estas preguntas se exige que los apuntes traten de verdad esa operación.
 */
export function isMathExpression(query) {
  const t = fold(query);
  if (!/\d/.test(query ?? '')) return false;
  return t.split(' ').every((token) => token.length < 3 || STOPWORDS.has(token) || /\d/.test(token));
}

// "¿Qué objetivos tiene 7° básico?", "OA 3", "qué voy a aprender este año", "según el currículum".
const CURRICULAR = [
  /\boa ?\d+\b/,
  /\bobjetivos? (de aprendizaje|fundamentales?|transversales?)\b/,
  /\b(curriculo|curricular|curriculares|curriculum)\b/,
  /\bbases? curriculares?\b/,
  /\b(mineduc|ministerio de educacion|programa de estudio|plan de estudio|marco curricular)\b/,
  /\bque (se )?(debo|tengo que|voy a|vamos a|se espera que|deberia|debemos) (aprender|estudiar|saber|ver|lograr)\b/,
  /\bque (objetivos|contenidos|unidades|ejes|habilidades|aprendizajes) (se )?(ven|tiene|tienen|hay|incluye|incluyen|corresponden|se espera)\b/,
  /\b(ejes?|habilidades|indicadores de evaluacion|aprendizajes esperados) (de|del|en) (la )?(asignatura|materia|curso|nivel|ano|matematica|lenguaje|historia|ciencias)\b/,
];

/** ¿La pregunta es sobre el currículum (qué se espera aprender) y no sobre un contenido concreto? */
export function isCurricularQuestion(text) {
  const t = fold(text);
  return t.length > 0 && CURRICULAR.some((re) => re.test(t));
}
