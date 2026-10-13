// Divide un apunte en fragmentos (chunks) para indexarlo.
// Respeta párrafos: junta párrafos hasta `maxChars` y deja un solapamiento
// (`overlapChars`) entre fragmentos consecutivos para no cortar ideas por la mitad.

/** Parte un párrafo largo por oraciones; si una oración sola excede el máximo, la corta a la fuerza. */
function splitLong(paragraph, maxChars) {
  const sentences = paragraph.split(/(?<=[.!?…])\s+/);
  const out = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) out.push(current);
      current = '';
      for (let i = 0; i < sentence.length; i += maxChars) out.push(sentence.slice(i, i + maxChars));
      continue;
    }
    if (current && current.length + sentence.length + 1 > maxChars) {
      out.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Últimos ~n caracteres de `text`, empezando en un límite de palabra. */
function tail(text, n) {
  if (n <= 0 || text.length <= n) return n <= 0 ? '' : text;
  const cut = text.slice(-n);
  const space = cut.indexOf(' ');
  return space >= 0 ? cut.slice(space + 1) : cut;
}

/**
 * @param {string} text
 * @param {{maxChars?: number, overlapChars?: number}} [options]
 * @returns {string[]}
 */
export function chunkText(text, { maxChars = 800, overlapChars = 120 } = {}) {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > maxChars ? splitLong(paragraph, maxChars) : [paragraph];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > maxChars) {
        chunks.push(current);
        const overlap = tail(current, overlapChars);
        current = overlap ? `${overlap}\n\n${piece}` : piece;
      } else {
        current = current ? `${current}\n\n${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
