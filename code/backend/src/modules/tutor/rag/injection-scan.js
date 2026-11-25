import { HttpProblem } from '../../../platform/problem.js';

// Revisa los apuntes AL SUBIRLOS en busca de órdenes dirigidas a la IA ("ignora tus reglas", "actúa como…", etiquetas que
// imitan el prompt del sistema). Threat model T-4 (prompt injection indirecta): un apunte llega al prompt del tutor como
// material; el prompt ya le dice a la IA que no obedezca lo de adentro, y esto es la segunda barrera.
//
// Es una barrera HEURÍSTICA, no una garantía: reconoce frases típicas en español e inglés y quita los trucos de
// escritura más comunes (letras invisibles, tildes, letras de otro alfabeto que se ven iguales). Una frase redactada de
// forma original puede pasar. Por eso no reemplaza a lo demás: el aviso en el prompt, los permisos del docente y el
// registro de quién subió qué.
//
// Reglas de diseño:
//   - Solo DETECTA: nunca modifica el apunte (no se "arregla" en silencio algo que el docente escribió).
//   - Nunca devuelve ni registra el texto sospechoso: solo qué regla saltó y en qué línea o página (los apuntes pueden
//     traer datos de menores y el log no guarda contenidos).
//   - Falsos positivos posibles (p. ej. un apunte de informática que explica qué es un "prompt injection"): se le pide al
//     docente reformular. Es preferible a dejar pasar una orden oculta.
//   - Todas las expresiones tienen cuantificadores acotados: sin retroceso catastrófico aunque el archivo sea hostil.

/** Letras de otros alfabetos que se ven como latinas ("іgnora" con i cirílica) -> la latina. */
const LOOKALIKES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'к': 'k', 'м': 'm', 'т': 't', 'н': 'h', 'в': 'b',
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'κ': 'k', 'υ': 'u', 'χ': 'x',
};
const LOOKALIKES_RE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'g');

/** Texto con la estructura intacta (etiquetas, corchetes), sin invisibles, en minúsculas y con espacios simples. */
function structural(line) {
  return line
    .normalize('NFKC')
    .replace(/[\p{Cf}\p{Cc}]/gu, (c) => (c === '\t' ? ' ' : c === '­' || /\p{Cf}/u.test(c) ? '' : ' '))
    .toLowerCase()
    .replace(LOOKALIKES_RE, (c) => LOOKALIKES[c])
    .replace(/\s+/g, ' ')
    .trim();
}

/** Además, sin tildes ni signos: para reconocer frases. */
function folded(line) {
  return structural(line)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Reglas sobre la estructura (etiquetas y delimitadores que imitan el prompt) ---------------------------------------
const STRUCTURE_RULES = [
  // Cerrar o abrir el bloque <apuntes>/<temas>/<nociones>/<calculo> del prompt para "salirse" del material.
  { id: 'etiqueta-del-prompt', re: /<\s{0,3}\/?\s{0,3}(apuntes|temas|nociones|calculo|cálculo)\s{0,3}>/ },
  // Delimitadores de mensajes de sistema de varios modelos.
  { id: 'delimitador-de-sistema', re: /<\|[a-z_]{1,24}\|>|\[\/?inst\]|<<\/?sys>>|<\/?(system|assistant)>|^\s{0,3}#{1,4}\s{0,3}(system|sistema)\b/ },
  { id: 'rol-de-sistema', re: /^\s{0,3}(role|rol)\s{0,3}[:=]\s{0,3}["']?(system|sistema|assistant|asistente)\b/ },
];

// --- Reglas sobre frases (texto ya sin tildes ni signos) -----------------------------------------------------------------
const VERB_IGNORE = '(?:ignora|ignore|ignorar|ignorando|olvida|olvidate|olvide|olvidar|omite|omitir|descarta|descartar|salta|saltate|desobedece|desobedecer|desatiende|deja de seguir|deja de lado|no sigas|no obedezcas|no hagas caso a|desactiva|anula)';
const DET = '(?:(?:todas?|todos?|cualquier|cualquiera de|ninguna de)\\s{1,2})?(?:(?:las|los|tus|tu|sus|su|mis|mi|estas|esas|aquellas|tales)\\s{1,2})?';
const THING_HARD = '(?:instrucciones|indicaciones|ordenes|directrices|directivas|prompt|mensajes? del sistema|politicas)';
const THING_SOFT = '(?:reglas|restricciones|limites|filtros|normas|guias|salvaguardas|protecciones)';
const PRIOR = '(?:anteriores|previas|de arriba|de antes|originales|del sistema|que te dieron|que te han dado|que tienes|que recibiste|iniciales)';

const PHRASE_RULES = [
  { id: 'ignorar-instrucciones', re: new RegExp(`\\b${VERB_IGNORE}\\s{1,2}${DET}(?:${THING_HARD}|${THING_SOFT}\\s{1,2}${PRIOR}|(?:tus|tu|sus|su)\\s{1,2}${THING_SOFT})\\b`) },
  { id: 'ignorar-instrucciones', re: new RegExp(`\\b${VERB_IGNORE}\\s{1,2}(?:todo|lo)\\s{1,2}(?:lo\\s{1,2})?(?:anterior|de arriba|que te (?:dijeron|dije|dieron))\\b`) },
  { id: 'ignorar-instrucciones', re: /\b(?:ignore|disregard|forget|override|bypass|skip)\s{1,2}(?:all\s{1,2}|any\s{1,2}|every\s{1,2})?(?:of\s{1,2})?(?:the\s{1,2}|your\s{1,2}|these\s{1,2}|those\s{1,2})?(?:previous|prior|above|earlier|original|system|safety)?\s{0,2}(?:instructions?|rules|prompts?|guidelines|directions|restrictions|constraints)\b/ },
  { id: 'nuevas-instrucciones', re: /\b(?:nuevas?|siguientes?|verdaderas?|reales|actualizadas?)\s{1,2}(?:instrucciones|ordenes|reglas)\s{0,2}(?:para (?:ti|la ia|el tutor|el asistente|el modelo)|del sistema|a seguir)?\b.{0,3}$/ },
  { id: 'nuevas-instrucciones', re: /\b(?:new|updated|real|actual)\s{1,2}(?:instructions|rules|orders)\s{0,2}(?:for you)?\s{0,2}$/ },
  { id: 'cambio-de-rol', re: /\b(?:a partir de (?:ahora|este momento|aqui)|desde ahora|de ahora en adelante)\s{1,2}(?:tu\s{1,2})?(?:eres|seras|actuaras|actua|responde|responderas|debes|tienes que|vas a|haras|hazlo)\b/ },
  { id: 'cambio-de-rol', re: /\b(?:actua|actuar|compórtate|comportate|finge|fingir|simula|simular|haz de cuenta|hazte pasar|pretende|interpreta)\s{1,2}(?:como|que eres|ser|por|el papel de)\s{1,2}(?:un|una|el|la)?\s{0,2}(?:\w+\s{1,2}){0,3}?(?:sin\s{1,2}(?:reglas|restricciones|limites|filtros)|malvad[oa]|hacker|dan\b|jailbreak|desarrollador|administrador|sistema)/ },
  { id: 'cambio-de-rol', re: /\byou\s{1,2}are\s{1,2}now\b|\bfrom\s{1,2}now\s{1,2}on\s{1,2}you\b|\bact\s{1,2}as\s{1,2}(?:if|an?\s{1,2}(?:unrestricted|evil|developer|admin))/ },
  { id: 'modo-sin-restricciones', re: /\b(?:modo\s{1,2}(?:desarrollador|dios|sin\s{1,2}(?:restricciones|filtros|limites)|jailbreak|developer)|developer\s{1,2}mode|jailbreak(?:ed)?|do\s{1,2}anything\s{1,2}now|sin\s{1,2}(?:ninguna\s{1,2})?(?:restriccion|restricciones|filtros|limites)\s{1,2}(?:eticas?|de seguridad|de contenido))\b/ },
  { id: 'revelar-el-prompt', re: /\b(?:revela|muestra|muestrame|imprime|repite|dime|escribe|copia|filtra|entrega|reveal|print|repeat|show|output|leak)\s{1,2}(?:me\s{1,2})?(?:tu|tus|el|las|la|your|the|all)\s{1,2}(?:(?:primer|primeras|ultimas?|completo|completas?|exact[oa]s?|propias?|first|full|entire|hidden|secret)\s{1,2})?(?:prompt|instrucciones|reglas|mensaje del sistema|system prompt|system message|instructions)\b/ },
  { id: 'prompt-del-sistema', re: /\b(?:prompt del sistema|mensaje del sistema|instrucciones del sistema|system prompt|system message|system instructions)\b/ },
  { id: 'saltarse-la-materia', re: /\b(?:responde|contesta|usa|utiliza|entrega|da)\s{1,2}(?:siempre\s{1,2})?(?:con\s{1,2})?(?:tu|tus|el|la)?\s{0,2}(?:conocimiento|informacion|datos)\s{1,2}(?:externo|propio|general|de internet)s?\b.{0,40}(?:en vez de|en lugar de|no los apuntes|sin los apuntes)/ },
  { id: 'ocultar-al-docente', re: /\bno\s{1,2}(?:le\s{1,2})?(?:digas|cuentes|menciones|reveles|informes|avises)\s{1,2}(?:a|al|a la)?\s{0,2}(?:estudiante|usuario|docente|profesor|profesora|nadie)\b.{0,40}(?:esto|estas?\s{1,2}(?:instrucciones|ordenes|reglas))/ },
];

const LINE_BREAK = new RegExp('\\r\\n|[\\r\\n\\u2028\\u2029]');

/** Cada cuántas líneas contiguas se juntan para reconocer frases partidas (los PDF cortan las líneas a mitad de frase). */
const WINDOW = 2;
const MAX_FINDINGS = 20;

/**
 * Busca órdenes dirigidas a la IA dentro de un texto.
 * @param {string} text
 * @param {{page?: number}} [opts]  número de página (1-based) si el texto es una página de un PDF
 * @returns {{rule: string, line: number, page?: number}[]}  una entrada por regla y línea (sin el texto encontrado)
 */
export function scanText(text, { page } = {}) {
  const lines = String(text ?? '').split(LINE_BREAK);
  const structured = lines.map(structural);
  const plain = lines.map(folded);
  const findings = [];
  const seen = new Set();
  const add = (rule, line) => {
    const key = `${rule}@${line}`;
    if (seen.has(key) || findings.length >= MAX_FINDINGS) return;
    seen.add(key);
    findings.push({ rule, line: line + 1, ...(page !== undefined && { page }) });
  };

  for (let i = 0; i < lines.length && findings.length < MAX_FINDINGS; i++) {
    if (!structured[i]) continue;
    for (const { id, re } of STRUCTURE_RULES) if (re.test(structured[i])) add(id, i);
    // La línea sola y la línea con las siguientes (frase partida entre renglones).
    for (let span = 1; span <= WINDOW; span++) {
      if (i + span > lines.length) break;
      const joined = plain.slice(i, i + span).filter(Boolean).join(' ');
      if (!joined || joined.length > 600) continue;
      // Si la frase ya está entera en las líneas siguientes, se informa en esa línea y no en la anterior.
      const tail = span > 1 ? plain.slice(i + 1, i + span).filter(Boolean).join(' ') : '';
      for (const { id, re } of PHRASE_RULES) if (re.test(joined) && !(tail && re.test(tail))) add(id, i);
    }
  }
  return findings;
}

/** Igual, para un PDF ya leído (una cadena por página). */
export function scanPages(pages) {
  const findings = [];
  for (const [i, text] of pages.entries()) {
    findings.push(...scanText(text, { page: i + 1 }));
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings.slice(0, MAX_FINDINGS);
}

/** Texto para el docente: dónde mirar y qué hacer. No repite lo encontrado. */
export function describeFindings(findings) {
  const where = [...new Set(findings.map((f) => (f.page !== undefined ? `la página ${f.page}` : `la línea ${f.line}`)))].slice(0, 5);
  return `El archivo contiene frases que parecen órdenes para la IA del tutor (por ejemplo, en ${where.join(', ')}). `
    + 'Por seguridad no se guardó. Revisa esas partes y quita o reformula las frases; si son parte legítima del contenido, escríbelas como una descripción y no como una orden.';
}

/**
 * Rechaza el documento (422, RFC 7807) si trae órdenes para la IA. `input` es `{ text }` o `{ pages }` (como lo usa
 * rag.ingest). Anota en el log SOLO las reglas y cuántas veces: ni el texto, ni el nombre, ni a quién pertenece.
 * @param {{text?: string, pages?: string[]}} input
 * @param {{log?: {warn: Function}}} [req]
 */
export function assertCleanDocument(input, req) {
  const findings = input.pages ? scanPages(input.pages) : scanText(input.text);
  if (findings.length === 0) return;
  req?.log?.warn({ rules: [...new Set(findings.map((f) => f.rule))], count: findings.length }, 'apunte rechazado: parece traer órdenes para la IA');
  throw new HttpProblem(422, 'Documento sospechoso', describeFindings(findings), 'suspicious-document');
}
