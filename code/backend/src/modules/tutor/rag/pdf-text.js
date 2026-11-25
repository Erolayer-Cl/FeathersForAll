// Puerta de entrada para leer un PDF. La lectura de verdad (pdf-extract.js) es CPU pura y deja el hilo parado, así que
// aquí se manda a un worker (offload.js) y el hilo principal sigue atendiendo a los demás mientras tanto.
import { sharedOffloader } from './offload.js';

export { extractPdfPagesInThread } from './pdf-extract.js';

/**
 * @param {Buffer | Uint8Array} data
 * @param {{offloader?: ReturnType<typeof import('./offload.js').createOffloader>}} [opts]  solo para pruebas
 * @returns {Promise<string[]>}  texto de cada página
 */
export async function extractPdfPages(data, { offloader = sharedOffloader() } = {}) {
  // Se copia a un buffer propio y se CEDE al worker (sin segunda copia): el Buffer de la solicitud puede compartir su
  // ArrayBuffer con otros y no se puede transferir tal cual.
  const copy = new Uint8Array(data);
  return offloader.run('extract-pdf', { data: copy }, [copy.buffer]);
}
