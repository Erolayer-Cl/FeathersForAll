// Genera PDFs de texto válidos (con tabla xref) para las pruebas, sin dependencias. Una sola fuente (Helvetica).
// Cada página es una lista de líneas; las tildes y la ñ se escriben en WinAnsi (octal) para que el texto se lea igual.

const WIN_ANSI = { 'á': 0xe1, 'é': 0xe9, 'í': 0xed, 'ó': 0xf3, 'ú': 0xfa, 'ñ': 0xf1, 'Á': 0xc1, 'É': 0xc9, 'Í': 0xcd, 'Ó': 0xd3, 'Ú': 0xda, 'Ñ': 0xd1, 'ü': 0xfc, '¿': 0xbf, '¡': 0xa1, '°': 0xb0 };

function pdfString(text) {
  let out = '';
  for (const ch of text) {
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (WIN_ANSI[ch]) out += `\\${WIN_ANSI[ch].toString(8).padStart(3, '0')}`;
    else if (ch.charCodeAt(0) < 128) out += ch;
    else out += '?';
  }
  return out;
}

/**
 * @param {string[][]} pages  líneas de texto de cada página
 * @returns {Buffer}
 */
export function buildPdf(pages) {
  const objects = []; // índice = número de objeto - 1
  const add = (body) => { objects.push(body); return objects.length; };

  const catalogId = add(null); // se completa al final
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  const pageIds = pages.map((lines) => {
    const stream = `BT /F1 11 Tf 14 TL 40 800 Td ${lines.map((l) => `(${pdfString(l)}) Tj T*`).join(' ')} ET`;
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const PALABRAS = ['fracción', 'numerador', 'denominador', 'suma', 'resta', 'multiplicación', 'división', 'ecuación', 'triángulo', 'ángulo', 'perímetro', 'área', 'célula', 'átomo', 'energía', 'sustantivo', 'adjetivo', 'verbo', 'oración', 'texto'];

/** Un PDF "de verdad grande": `pages` páginas de ~45 líneas de texto variado (el texto de cada página es distinto). */
export function buildBigPdf(pages, linesPerPage = 45) {
  const doc = [];
  for (let p = 0; p < pages; p++) {
    const lines = [`Capítulo ${p + 1}`];
    for (let l = 1; l < linesPerPage; l++) {
      const words = [];
      for (let w = 0; w < 11; w++) words.push(PALABRAS[(p * 7 + l * 3 + w * 5) % PALABRAS.length]);
      lines.push(`${words.join(' ')} ${p * linesPerPage + l}.`);
    }
    doc.push(lines);
  }
  return buildPdf(doc);
}
