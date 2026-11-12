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
const HEADING_WORDS = /^(OA\s*\d+|objetivos?\b|unidad\b|eje\b|cap[ií]tulo\b|m[oó]dulo\b|presentaci[oó]n\b|anexo\b|bibliograf[ií]a\b|[0-9]+(\.[0-9]+)*\.?\s+\p{Lu})/iu;

const letters = (s) => s.replace(/[^\p{L}]/gu, '');
const normalizeLine = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

// Una línea que termina en artículo o preposición es una frase cortada por el ancho de la página, no un título.
const DANGLING = /\s(de|del|la|el|los|las|y|e|o|u|en|a|al|que|con|por|para|un|una|su|sus|se|lo)$/i;

function isHeading(line) {
  if (line.length < 4 || line.length > 90 || /[.;]$/.test(line)) return false;
  const l = letters(line);
  if (l.length >= 4 && l === l.toUpperCase()) return true; // TODO EN MAYÚSCULAS (aunque el título siga en la línea siguiente)
  return HEADING_WORDS.test(line) && /^[\p{Lu}\d]/u.test(line) && !line.includes(',') && line.split(/\s+/).length <= 10 && !DANGLING.test(line);
}

/** Líneas (normalizadas) que se repiten en muchas páginas: encabezados y pies. */
function repeatedLines(pageLines) {
  const total = pageLines.length;
  if (total < 4) return new Set();
  const seen = new Map();
  for (const lines of pageLines) {
    for (const key of new Set(lines.map(normalizeLine))) {
      if (key.length > 2 && key.length < 140) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(total * 0.3));
  return new Set([...seen].filter(([, n]) => n >= threshold).map(([key]) => key));
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
    for (const line of lines) {
      if (!line) { flush(); continue; }
      if (PAGE_NUMBER.test(line) || noise.has(normalizeLine(line))) continue;

      if (isHeading(line)) {
        flush();
        section = (afterHeading ? `${section} ${line}` : line).slice(0, 110);
        afterHeading = true;
        continue; // el título viaja en la cabecera de cada fragmento, no en el cuerpo
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
    }
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
