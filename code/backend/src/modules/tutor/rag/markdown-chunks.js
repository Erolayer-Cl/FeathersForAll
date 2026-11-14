// Fragmentos de un apunte en texto plano o Markdown, con su contexto.
//
// Antes, un .md se partía solo por párrafos: un fragmento como "Se suman los numeradores y se conserva el
// denominador" no decía que era de "Suma de fracciones con igual denominador", así que el buscador no podía
// distinguirlo de la resta, y el LLM no sabía de qué tema hablaba. Ahora cada fragmento empieza con
// "[Documento · Título › Subtítulo]" (el mismo formato que los PDF), y esa cabecera también se indexa:
// preguntar por "suma de fracciones" encuentra la sección por su título aunque el cuerpo no repita la frase.
import { chunkText } from './chunker.js';
import { chunkHeader } from './pdf-chunks.js';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Divide en secciones { section, text } según los títulos Markdown (ignora los # dentro de bloques de código). */
export function splitSections(text) {
  const sections = [];
  const path = []; // [{ level, title }]
  let lines = [];
  let inFence = false;

  const label = () => path.map((p) => p.title).join(' › ').slice(0, 110);
  const flush = (section) => {
    const body = lines.join('\n').trim();
    if (body) sections.push({ section, text: body });
    lines = [];
  };

  let currentSection = '';
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (!m) {
      lines.push(line);
      continue;
    }
    flush(currentSection);
    const level = m[1].length;
    while (path.length && path.at(-1).level >= level) path.pop();
    path.push({ level, title: m[2].replace(/[*_`]/g, '').trim() });
    currentSection = label();
  }
  flush(currentSection);
  return sections;
}

/**
 * @param {string} text
 * @param {{title?: string, maxChars?: number, overlapChars?: number}} [options]
 * @returns {string[]}  fragmentos; cada uno con su cabecera "[Documento · Sección]" si hay título o secciones
 */
export function chunkMarkdown(text, { title = '', maxChars = 800, overlapChars = 120 } = {}) {
  const out = [];
  for (const { section, text: body } of splitSections(text)) {
    const header = chunkHeader({ title, section });
    // Deja espacio para la cabecera dentro del máximo, igual que chunkPages.
    const room = Math.max(300, maxChars - header.length - 4);
    const overlap = Math.min(overlapChars, Math.floor(room / 4));
    for (const piece of chunkText(body, { maxChars: room, overlapChars: overlap })) {
      out.push(header ? `[${header}]\n${piece}` : piece);
    }
  }
  return out;
}
