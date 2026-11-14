// Cómo se presentan al LLM los fragmentos recuperados.
//
// Dos problemas del formato anterior ("[1] (documento)\n[Documento · Sección · p. 3]\ntexto"):
//   - tenía DOS encabezados por fragmento. Un modelo chico (3B) los copiaba tal cual en la respuesta
//     ("[1] (MINEDUC · Bases…) [1] Sumar números hasta 20…");
//   - si la respuesta estaba repartida en fragmentos consecutivos, llegaban como piezas separadas y repetidas
//     por el solapamiento entre ellos (el chunker repite el final de un fragmento al inicio del siguiente).
// Aquí se une lo contiguo en un solo bloque y cada bloque lleva UNA línea de fuente breve.
import { isReferenceDoc } from './doc-kinds.js';

// Cabecera que agregan chunkPages / chunkMarkdown: "[Documento · Sección · p. 3]" en la primera línea.
const HEADER = /^\[([^\]\n]{1,300})\]\n/;
const MIN_OVERLAP = 20;
const MAX_OVERLAP = 400;

/** Separa la cabecera de contexto del cuerpo de un fragmento. */
export function splitHeader(text) {
  const m = HEADER.exec(text ?? '');
  return m ? { header: m[1], body: text.slice(m[0].length) } : { header: '', body: text ?? '' };
}

// "… · p. 3" o "… · pp. 3–4": la página va al final de la cabecera de los PDF.
const PAGES = /\s·\spp?\.\s(\d+)(?:[–-](\d+))?$/;

const baseOf = (header) => header.replace(PAGES, '');

/** Cabecera de dos fragmentos de la misma sección: conserva el título y abarca las páginas de ambos. */
function mergeHeaders(a, b) {
  const pa = PAGES.exec(a);
  const pb = PAGES.exec(b);
  if (!pa || !pb) return a;
  const nums = [pa[1], pa[2] ?? pa[1], pb[1], pb[2] ?? pb[1]].map(Number);
  const [from, to] = [Math.min(...nums), Math.max(...nums)];
  return `${baseOf(a)} · ${from === to ? `p. ${from}` : `pp. ${from}–${to}`}`;
}

/** Une dos fragmentos consecutivos quitando el solapamiento que el chunker repite al inicio del segundo. */
export function joinChunks(first, second) {
  const max = Math.min(MAX_OVERLAP, first.length, second.length);
  for (let k = max; k >= MIN_OVERLAP; k--) {
    if (first.endsWith(second.slice(0, k))) return first + second.slice(k);
  }
  return `${first}\n\n${second}`;
}

/**
 * Agrupa los fragmentos que son vecinos en el mismo documento y la misma sección (chunk_index consecutivo) en un solo bloque.
 * Conserva el orden de relevancia: cada bloque queda donde estaba su fragmento mejor posicionado.
 * @param {{doc_id: string, chunk_index?: number, text: string, score: number}[]} hits  ordenados por relevancia
 * @returns {{doc_id: string, header: string, body: string, score: number, reference: boolean, chunks: number[]}[]}
 */
export function stitchHits(hits) {
  const byDoc = new Map();
  hits.forEach((hit, rank) => {
    if (!byDoc.has(hit.doc_id)) byDoc.set(hit.doc_id, []);
    byDoc.get(hit.doc_id).push({ hit, rank });
  });

  const blocks = [];
  for (const [doc_id, items] of byDoc) {
    // Sin chunk_index (otro almacén) no se puede saber quién es vecino de quién: cada fragmento queda solo.
    const sortable = items.every(({ hit }) => Number.isInteger(hit.chunk_index));
    const ordered = sortable ? [...items].sort((a, b) => a.hit.chunk_index - b.hit.chunk_index) : items;

    let current = null;
    for (const { hit, rank } of ordered) {
      const { header, body } = splitHeader(hit.text);
      // Solo se unen fragmentos de la MISMA sección: si cambia el título, un solo bloque diría el tema equivocado.
      if (current && sortable && hit.chunk_index === current.last + 1 && baseOf(header) === baseOf(current.header)) {
        current.header = mergeHeaders(current.header, header);
        current.body = joinChunks(current.body, body);
        current.last = hit.chunk_index;
        current.chunks.push(hit.chunk_index);
        current.score = Math.max(current.score, hit.score);
        current.rank = Math.min(current.rank, rank);
      } else {
        current = { doc_id, header, body, score: hit.score, reference: isReferenceDoc(doc_id), chunks: [hit.chunk_index], last: hit.chunk_index, rank };
        blocks.push(current);
      }
    }
  }

  return blocks
    .sort((a, b) => a.rank - b.rank)
    .map((b) => ({ doc_id: b.doc_id, header: b.header, body: b.body, score: b.score, reference: b.reference, chunks: b.chunks }));
}

/** Una línea de fuente corta: la cabecera del fragmento si la tiene ("Fracciones · Suma · p. 3"), si no el nombre del documento. */
export function sourceLabel(block) {
  const label = block.header || block.doc_id;
  return block.reference ? `${label} (documento oficial)` : label;
}

/** Bloques ya numerados, listos para ponerlos dentro de <apuntes>. */
export function formatBlocks(blocks) {
  return blocks.map((b, i) => `[${i + 1}] Fuente: ${sourceLabel(b)}\n${b.body.trim()}`).join('\n\n');
}
