// Extrae el texto de un PDF, página por página, con `unpdf` (pdf.js sin dependencias nativas).
// Esto es CPU pura y SÍNCRONA en la práctica (pdf.js no cede el hilo): un PDF de 300 páginas deja el proceso parado ~1 s
// y uno de 1000 páginas ~3 s. Por eso NO se llama desde el hilo principal de la API: lo corre un worker (offload.js) y
// `pdf-text.js` es la puerta de entrada. Este módulo es lo que ejecuta el worker.
//
// `unpdf` se importa al usarlo: si falta el paquete (npm install), el servidor igual arranca y solo falla la carga de PDFs.
import { UnreadableDocumentError } from './errors.js';

const MIN_CHARS = 200; // menos que esto en todo el PDF = escaneo (imágenes sin texto)

/**
 * @param {Buffer | Uint8Array} data
 * @returns {Promise<string[]>}  texto de cada página
 */
export async function extractPdfPagesInThread(data) {
  let unpdf;
  try {
    unpdf = await import('unpdf');
  } catch {
    throw new Error('Falta la dependencia "unpdf" para leer PDFs: ejecuta "npm install" en code/backend.');
  }

  let pages;
  try {
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(data));
    ({ text: pages } = await unpdf.extractText(pdf, { mergePages: false }));
    pages = pages.map((p) => p.replaceAll('\u0000', '')); // PostgreSQL no acepta NUL en un TEXT
  } catch (err) {
    throw new UnreadableDocumentError(`No se pudo leer el PDF (${err.message}). ¿Está dañado o protegido con contraseña?`);
  }

  const chars = pages.reduce((n, p) => n + p.trim().length, 0);
  if (chars < MIN_CHARS) {
    throw new UnreadableDocumentError('El PDF no tiene texto seleccionable (parece un escaneo). Súbelo como texto o aplica OCR antes.');
  }
  return pages;
}
