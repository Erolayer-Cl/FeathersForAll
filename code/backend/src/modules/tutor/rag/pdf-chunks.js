// Prepara el texto de un PDF (una cadena por página) para el RAG.
//
// Un PDF no trae párrafos: trae líneas cortadas a mitad de frase, guiones de fin de línea,
// encabezados y números de página repetidos en cada hoja. Si eso se indexa tal cual, los
// fragmentos salen sucios y el buscador pierde precisión. Este módulo:
//   1. quita encabezados/pies repetidos y números de página,
//   2. une las líneas en párrafos (y reconstruye las palabras partidas con guion),
//   3. detecta títulos de sección,
//   4. parte en fragmentos que no cruzan secciones y llevan una cabecera de contexto
//      "[Documento · Sección · p. N]", así el buscador y el LLM saben de dónde viene cada uno.
import { chunkText } from './chunker.js';

const PAGE_NUMBER = /^(p[aá]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?$/i;
const BULLET = /^([•·▪●○◦■\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+/;
const SENTENCE_END = /[.!?:;…)»"”]$/;
const HEADING_WORDS = /^(OA\s*\d+|objetivos?\b|unidad\b|eje\b|cap[ií]tulo\b|m[oó]dulo\b|presentaci[oó]n\b|anexo\b|bibliograf[ií]a\b)/iu;
// "1. Introducción", "3. La Independencia de Chile". Sin la bandera i: con ella \p{Lu} acepta minúsculas y
// "4 x 8 = 32" pasaba por título (y la operación desaparecía del texto); además isHeading descarta las líneas con "=".
const NUMBERED_HEADING = /^\d+(\.\d+)*\.?\s+\p{Lu}/u;

const letters = (s) => s.replace(/[^\p{L}]/gu, '');
// Encabezados y pies con número de página solo se buscan en las primeras o últimas líneas de la página.
const EDGE_LINES = 2;
const exactKey = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
// Una línea sirve para comparar entre páginas si tiene texto: "7 x 8 = 56" (menos de 3 letras) nunca es encabezado.
const useful = (key) => key.length > 2 && key.length < 140 && letters(key).length >= 3;

/**
 * Línea de borde con un número que podría ser el de la página: "Página 3 de 10", "45 Bases Curriculares",
 * "Guía de fracciones 7". Devuelve la línea sin ese número (`key`) y el número (`n`), o n = null si no tiene.
 */
function numberedKey(line) {
  let n = null;
  let key = exactKey(line).replace(/p[aá]g(ina)?\.?\s*(\d{1,4})(\s*(de|\/)\s*\d{1,4})?/i, (_m, _ina, num) => {
    n = Number(num);
    return '#';
  });
  if (n === null) {
    key = key.replace(/^(\d{1,4})\b|\b(\d{1,4})$/, (_m, lead, trail) => {
      n = Number(lead ?? trail);
      return '#';
    });
  }
  return { key, n };
}

/** Posiciones de las primeras y últimas líneas con texto de una página (candidatas a encabezado o pie). */
function edgeIndexes(lines) {
  const filled = lines.flatMap((l, i) => (l ? [i] : []));
  return new Set([...filled.slice(0, EDGE_LINES), ...filled.slice(-EDGE_LINES)]);
}

// Una línea que termina en artículo o preposición es una frase cortada por el ancho de la página, no un título.
const DANGLING = /\s(de|del|la|el|los|las|y|e|o|u|en|a|al|que|con|por|para|un|una|su|sus|se|lo)$/i;

function isHeading(line) {
  if (line.length < 4 || line.length > 90 || /[.;]$/.test(line)) return false;
  const l = letters(line);
  if (l.length >= 4 && l === l.toUpperCase()) return true; // TODO EN MAYÚSCULAS (aunque el título siga en la línea siguiente)
  return (HEADING_WORDS.test(line) || NUMBERED_HEADING.test(line)) && !line.includes('=') && /^[\p{Lu}\d]/u.test(line) && !line.includes(',') && line.split(/\s+/).length <= 10 && !DANGLING.test(line);
}

/**
 * Encabezados y pies que se repiten en muchas páginas:
 *   - `exact`: la misma línea, idéntica, en cualquier posición (un encabezado de 3 líneas, el nombre del colegio);
 *   - `numbered`: línea de borde cuyo número avanza con la página (mismo desfase número − página en la mayoría):
 *     "Página 3 de 10", "Bases Curriculares 45". Un número que no avanza ("Respuesta: 18", "Respuesta: 25") es
 *     contenido y se conserva. Devuelve, para cada línea, el desfase con que se reconoce el número de página.
 * @returns {{exact: Set<string>, numbered: Map<string, number>}}
 */
function repeatedLines(pageLines) {
  const total = pageLines.length;
  const none = { exact: new Set(), numbered: new Map() };
  if (total < 4) return none;
  const threshold = Math.max(3, Math.ceil(total * 0.3));
  const exact = new Map();
  const numbered = new Map(); // key -> Map(desfase -> páginas)
  pageLines.forEach((lines, pageIdx) => {
    for (const key of new Set(lines.filter(Boolean).map(exactKey))) {
      if (useful(key)) exact.set(key, (exact.get(key) ?? 0) + 1);
    }
    const seenHere = new Set();
    for (const i of edgeIndexes(lines)) {
      const { key, n } = numberedKey(lines[i]);
      if (n === null || !useful(key) || seenHere.has(key)) continue;
      seenHere.add(key);
      const offsets = numbered.get(key) ?? new Map();
      offsets.set(n - pageIdx, (offsets.get(n - pageIdx) ?? 0) + 1);
      numbered.set(key, offsets);
    }
  });
  const pageNumbered = new Map();
  for (const [key, offsets] of numbered) {
    const [offset, count] = [...offsets].sort((a, b) => b[1] - a[1])[0];
    if (count >= threshold) pageNumbered.set(key, offset);
  }
  return { exact: new Set([...exact].filter(([, c]) => c >= threshold).map(([k]) => k)), numbered: pageNumbered };
}

/**
 * @param {string[]} pages  texto de cada página, en orden
 * @returns {{page: number, section: string, text: string}[]}  párrafos con su página y sección
 */
export function pagesToParagraphs(pages, { pageOffset = 0 } = {}) {
  const pageLines = pages.map((p) => (p ?? '').replace(/\r\n/g, '\n').replace(/\u00ad/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()));
  const noise = repeatedLines(pageLines);

  const paragraphs = [];
  let section = '';
  let current = null; // { page, section, text }
  let afterHeading = false; // la línea anterior fue un título: un título en dos líneas se une

  const flush = () => {
    if (current && current.text.trim()) paragraphs.push({ ...current, text: current.text.trim() });
    current = null;
  };

  pageLines.forEach((lines, pageIdx) => {
    const page = pageIdx + 1 + pageOffset;
    const edge = edgeIndexes(lines);
    lines.forEach((line, lineIdx) => {
      if (!line) { flush(); return; }
      if (PAGE_NUMBER.test(line) || noise.exact.has(exactKey(line))) return;
      if (edge.has(lineIdx)) {
        const { key, n } = numberedKey(line);
        if (n !== null && noise.numbered.get(key) === n - pageIdx) return; // número de página en el encabezado o pie
      }

      if (isHeading(line)) {
        flush();
        section = (afterHeading ? `${section} ${line}` : line).slice(0, 110);
        afterHeading = true;
        return; // el título viaja en la cabecera de cada fragmento, no en el cuerpo
      }
      afterHeading = false;
      const startsNew = BULLET.test(line) || (current && SENTENCE_END.test(current.text) && /^[\p{Lu}¿¡]/u.test(line) && current.text.length > 200);
      if (current && startsNew) flush();

      if (!current) {
        current = { page, section, text: line };
      } else if (/\p{L}-$/u.test(current.text) && /^\p{Ll}/u.test(line)) {
        current.text = current.text.slice(0, -1) + line; // "curricu-" + "lar" → "curricular"
      } else {
        current.text += ` ${line}`;
      }
    });
    // Una frase que sigue en la página siguiente se mantiene unida; solo se corta si terminó.
    if (current && SENTENCE_END.test(current.text)) flush();
  });
  flush();
  return paragraphs;
}

/** Cabecera de contexto de un fragmento. `pages` = [primera, última] página que abarca. */
export function chunkHeader({ title, section, pages }) {
  const label = !pages ? '' : pages[0] === pages[1] ? ` · p. ${pages[0]}` : ` · pp. ${pages[0]}–${pages[1]}`;
  return [title, section].filter(Boolean).join(' · ') + label;
}

/**
 * Fragmentos de un documento por páginas. Cada fragmento empieza con "[Documento · Sección · p. N]".
 * @param {string[]} pages
 * @param {{title?: string, maxChars?: number, overlapChars?: number, pageOffset?: number}} [options]
 *   `pageOffset`: páginas que hay antes de la primera de `pages` (para un tramo de un PDF más grande: las citas "p. N" siguen siendo las del PDF)
 * @returns {string[]}
 */
export function chunkPages(pages, { title = '', maxChars = 800, overlapChars = 120, pageOffset = 0 } = {}) {
  const paragraphs = pagesToParagraphs(pages, { pageOffset });
  const out = [];

  // Agrupa párrafos consecutivos de la misma sección y los parte con el chunker de siempre.
  let i = 0;
  while (i < paragraphs.length) {
    const section = paragraphs[i].section;
    const group = [];
    while (i < paragraphs.length && paragraphs[i].section === section) group.push(paragraphs[i++]);

    // Posición de cada párrafo dentro del texto de la sección, para saber en qué página cae cada fragmento.
    const starts = [];
    let text = '';
    for (const p of group) {
      starts.push(text.length);
      text += (text ? '\n\n' : '') + p.text;
    }
    const pageAt = (pos) => {
      let k = 0;
      while (k + 1 < starts.length && starts[k + 1] <= pos) k++;
      return group[k].page;
    };

    // Deja espacio para la cabecera dentro del máximo.
    const headerBudget = chunkHeader({ title, section, pages: [9999, 9999] }).length + 4;
    const body = Math.max(300, maxChars - headerBudget);
    let cursor = 0;
    for (const piece of chunkText(text, { maxChars: body, overlapChars: Math.min(overlapChars, Math.floor(body / 4)) })) {
      // Primera y última página del fragmento: se ubican por su inicio y su final dentro del texto de la sección.
      const start = text.indexOf(piece.slice(0, 60), cursor);
      const end = text.indexOf(piece.slice(-60), Math.max(cursor, start));
      if (start >= 0) cursor = start;
      const first = pageAt(Math.max(0, start));
      const last = end >= 0 ? pageAt(end + Math.min(60, piece.length) - 1) : first;
      const header = chunkHeader({ title, section, pages: [first, Math.max(first, last)] });
      out.push(header ? `[${header}]\n${piece}` : piece);
    }
  }
  return out;
}
