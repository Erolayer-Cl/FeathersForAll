// Trabajos pesados (CPU) que se corren fuera del hilo principal. Lo importan el worker (offload-worker.js) y, cuando los
// workers están apagados (PDF_WORKERS=0), el propio offloader. NO importa offload.js: así no hay ciclos.
import { extractPdfPagesInThread } from './pdf-extract.js';
import { chunkPages } from './pdf-chunks.js';

export const JOBS = {
  /** { data: Uint8Array } -> string[] (texto de cada página) */
  'extract-pdf': ({ data }) => extractPdfPagesInThread(data),
  /** { pages: string[], options: object } -> string[] (fragmentos con su cabecera de contexto) */
  'chunk-pages': ({ pages, options }) => chunkPages(pages, options),
};
