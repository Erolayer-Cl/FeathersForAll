import { chunkPages } from './pdf-chunks.js';
import { chunkMarkdown } from './markdown-chunks.js';
import { isReferenceDoc, referenceAppliesToLevel, referenceAppliesToSubject, referenceSubject, subjectKey } from './doc-kinds.js';
import { coverage, expandMathQuery, isMathExpression, significantStems } from './relevance.js';

const EMBED_BATCH = 16;
// Se pide al almacén más candidatos de los que se usan y luego se eligen con variedad de documentos.
const POOL_FACTOR = 3;
// Un fragmento que además calza por palabras exactas (búsqueda por texto) puede pasar con algo menos de similitud.
const LEXICAL_LENIENCY = 0.1;
// Un fragmento tan parecido en significado que no necesita compartir palabras con la pregunta (paráfrasis).
const STRONG_MARGIN = 0.12;
// Se descartan los fragmentos que quedan muy por debajo del mejor: son la "cola" de lo que apenas se parece.
const RELATIVE_MARGIN = 0.15;
// Con esta cobertura de palabras de la pregunta, un fragmento se conserva aunque esté lejos del mejor.
const KEEP_COVERAGE = 0.5;
// Una operación numérica ("10x10") solo se responde si los apuntes hablan de esa operación: al menos esta parte de sus palabras.
const MATH_COVERAGE = 0.5;
// Los apuntes del docente pesan algo más que las Bases oficiales al ordenar.
const NOTES_BONUS = 0.05;
// Las Bases de la asignatura del curso pesan más; las generales (introducciones, decretos) usan palabras como "objetivos de
// aprendizaje" que calzan con cualquier pregunta curricular, así que solo rellenan lo que la asignatura no cubre.
const SUBJECT_BONUS = 0.03;
const GENERAL_PENALTY = 0.1;
const COVERAGE_WEIGHT = 0.2;
const LEXICAL_BONUS = 0.03;

/**
 * Orquesta ingesta y recuperación. No conoce a Ollama ni al almacén concreto:
 * recibe un `embedder` ({ embed(texts) }) y un `store` (ver vector-store.js).
 *
 * @param {object} deps
 * @param {{embed: (texts: string[]) => Promise<number[][]>}} deps.embedder
 * @param {object} deps.store  vector-store.js (archivo) o pg-vector-store.js (PostgreSQL); sus métodos pueden ser sync o async
 * @param {number} [deps.topK]      fragmentos a recuperar
 * @param {number} [deps.minScore]  similitud mínima (0–1); bajo ese valor se considera "sin información"
 * @param {number} [deps.strongScore]  similitud a partir de la cual un fragmento sirve aunque no comparta palabras con la
 *   pregunta (por defecto minScore + 0,12)
 * @param {'curricular' | 'always' | 'off'} [deps.referenceMode]  cuándo se consultan las Bases del Mineduc además de los
 *   apuntes: solo si preguntan por el currículum (por defecto), siempre, o nunca
 * @param {{maxChars?: number, overlapChars?: number}} [deps.chunk]
 */
export function createRagService({
  embedder,
  store,
  topK = 4,
  minScore = 0.5,
  strongScore = minScore + STRONG_MARGIN,
  referenceMode = 'curricular',
  chunk = {},
}) {
  async function embedAll(texts, onProgress) {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      out.push(...(await embedder.embed(texts.slice(i, i + EMBED_BATCH))));
      onProgress?.(out.length, texts.length);
    }
    return out;
  }

  /**
   * Elige hasta `k` fragmentos sin que un solo documento los copie todos: con varios documentos en el curso
   * (apuntes del docente + bases del Mineduc) cada uno aporta como máximo `ceil(k/2)`; si sobran cupos se rellenan
   * con los mejores restantes. Conserva el orden de relevancia.
   */
  function diversify(hits, k) {
    if (hits.length <= k) return hits;
    const cap = Math.max(2, Math.ceil(k / 2));
    const perDoc = new Map();
    const chosen = new Set();
    // Los documentos generales (introducciones, decretos) no entran en la primera vuelta: solo rellenan lo que sobra.
    const isGeneral = (h) => isReferenceDoc(h.doc_id) && referenceSubject(h.doc_id) === null;
    for (const h of hits) {
      if (chosen.size >= k) break;
      if (isGeneral(h)) continue;
      const n = perDoc.get(h.doc_id) ?? 0;
      if (n < cap) { chosen.add(h); perDoc.set(h.doc_id, n + 1); }
    }
    for (const h of hits) {
      if (chosen.size >= k) break;
      chosen.add(h);
    }
    return hits.filter((h) => chosen.has(h));
  }

  /** Nombres de los documentos del curso (sin contar fragmentos). null si el almacén no sabe listarlos. */
  async function titlesOf(ref) {
    if (store.listTitles) return store.listTitles(ref);
    if (store.listDocuments) return (await store.listDocuments(ref)).map((d) => d.doc_id);
    return null;
  }

  /**
   * ¿Cuándo sirven las Bases del Mineduc? Dicen QUÉ se espera aprender, no cómo se resuelve un ejercicio:
   * con "1+1" o "cuánto es 10x10" solo aportan un objetivo de aprendizaje que no responde nada.
   */
  const useReference = (curricular) => referenceMode === 'always' || (referenceMode === 'curricular' && curricular);

  /**
   * Parte el documento en fragmentos y calcula sus embeddings, sin guardar nada. Sirve para indexar el mismo
   * documento en varios cursos calculando los embeddings una sola vez (ver `save`).
   * `pages` (texto por página, de un PDF) activa la limpieza y las cabeceras de contexto; `text` es texto plano
   * o Markdown (cada fragmento lleva el título del documento y de su sección).
   * @param {{text?: string, pages?: string[], title?: string, pageOffset?: number, onProgress?: (done: number, total: number) => void}} doc
   */
  async function prepare({ text, pages, title, pageOffset, onProgress }) {
    const pieces = pages ? chunkPages(pages, { title, ...chunk, ...(pageOffset && { pageOffset }) }) : chunkMarkdown(text ?? '', { title, ...chunk });
    if (pieces.length === 0) throw new RangeError('El documento no tiene texto');
    const embeddings = await embedAll(pieces, onProgress);
    return {
      text: text ?? pages.join('\n\n'),
      chunks: pieces.map((piece, i) => ({ text: piece, embedding: embeddings[i] })),
    };
  }

  /** Guarda un documento ya preparado (`prepare`) en un curso. Reemplaza el de igual nombre. */
  async function save({ tenantId, courseId, docId, prepared, actor }) {
    await store.replaceDocument({ tenantId, courseId, docId, text: prepared.text, actor, chunks: prepared.chunks });
    return { doc_id: docId, chunks: prepared.chunks.length };
  }

  return {
    prepare,
    save,
    referenceMode,
    hasCourse: async (ref) => store.hasCourse(ref),
    listDocuments: async (ref) => store.listDocuments(ref),
    /** `ref.actor` = quien borra ({ id, rol }); en PostgreSQL la base decide si puede. */
    deleteDocument: async (ref) => store.deleteDocument(ref),
    /** El almacén en archivo (solo desarrollo) no tiene usuarios: todo curso es usable. */
    canUseCourse: async (ref) => (store.canUseCourse ? store.canUseCourse(ref) : true),
    courseOwner: async (ref) => (store.courseOwner ? store.courseOwner(ref) : null),
    /** Nivel, asignatura y nombre del curso ({ nivel, asignatura, nombre }); null si el almacén no los conoce (archivo). */
    courseInfo: async (ref) => (store.courseInfo ? store.courseInfo(ref) : null),

    /**
     * Qué hay indexado en el curso: `hasAny` (algún documento), `hasNotes` (algún apunte del docente; las Bases del
     * Mineduc no cuentan) y `titles`. Un curso con solo las Bases cargadas NO es un curso con apuntes: el tutor debe
     * decir "tu docente todavía no ha subido apuntes" en vez de responder con objetivos de aprendizaje.
     * @returns {Promise<{hasAny: boolean, hasNotes: boolean, titles: string[] | null}>}
     */
    async courseState(ref) {
      const titles = await titlesOf(ref);
      if (titles === null) return { hasAny: Boolean(await store.hasCourse(ref)), hasNotes: true, titles: null };
      return { hasAny: titles.length > 0, hasNotes: titles.some((t) => !isReferenceDoc(t)), titles };
    },

    /** ¿Conviene consultar también las Bases del Mineduc para esta pregunta? */
    usesReference: useReference,

    /**
     * Indexa (o reemplaza) un documento del curso: texto plano (`text`) o un PDF ya leído (`pages` + `title`).
     * `actor` ({ id, rol }) es quien lo sube; en PostgreSQL solo el docente del curso o el admin pueden.
     */
    async ingest({ tenantId, courseId, docId, text, pages, title, actor, onProgress }) {
      const prepared = await prepare({ text, pages, title: title ?? docId.replace(/\.(txt|md|markdown|pdf)$/i, ''), onProgress });
      return save({ tenantId, courseId, docId, prepared, actor });
    },

    /**
     * Busca en el curso. Primero en los apuntes del docente; las Bases del Mineduc (de su nivel) solo si
     * `curricular` y la configuración lo permite. Un fragmento se acepta si:
     *   - se parece MUCHO en significado (`strongScore`), o
     *   - se parece lo suficiente (`minScore`) Y comparte palabras con la pregunta (o calzó en la búsqueda por texto).
     * Con una pregunta corta como "1+1" los embeddings dan puntajes medianos para casi cualquier texto del tema;
     * exigir palabras en común evita responder con un fragmento que solo "suena parecido".
     * Luego se descarta la cola muy por debajo del mejor y se ordena mezclando similitud, cobertura y tipo de documento.
     *
     * @param {{tenantId: string, courseId: string, query: string, curricular?: boolean, titles?: string[] | null}} p
     *   `titles`: los documentos del curso, si ya se listaron (`courseState`), para no consultarlos de nuevo.
     * @returns {Promise<{hits: {doc_id: string, chunk_index: number, text: string, score: number, reference: boolean}[], best: number | null,
     *   candidates: object[], timings: {embed_ms: number, search_ms: number}}>}
     *   `hits` ya filtrados; `best` es la mejor similitud encontrada (útil para ajustar el umbral);
     *   `candidates` = todo lo que se evaluó, con su veredicto (para `npm run rag:search`);
     *   `timings`: cuánto tardó el embedding de la pregunta y la búsqueda en el almacén.
     */
    async retrieve({ tenantId, courseId, query, curricular = false, titles }) {
      const ref = { tenantId, courseId };
      const text = expandMathQuery(query);
      const queryStems = significantStems(text);
      const mathOnly = isMathExpression(query);

      const t0 = performance.now();
      const [embedding] = await embedder.embed([text]);
      const t1 = performance.now();

      const known = titles === undefined ? await titlesOf(ref) : titles;
      const wantReference = useReference(curricular);
      let found;
      let subjectOfCourse = null;
      if (known === null) {
        // Almacén que no sabe listar documentos: una sola búsqueda, y las Bases se separan por su nombre.
        found = await store.search({ ...ref, embedding, topK: topK * POOL_FACTOR, queryText: text });
        if (!wantReference) found = found.filter((h) => !isReferenceDoc(h.doc_id));
      } else {
        const info = wantReference && store.courseInfo ? await store.courseInfo(ref) : null;
        const notesDocs = known.filter((t) => !isReferenceDoc(t));
        // Solo las Bases de la asignatura y el nivel del curso (las generales aplican a todos).
        const courseSubject = info?.asignatura || info?.nombre;
        const refDocs = wantReference
          ? known.filter((t) => isReferenceDoc(t) && referenceAppliesToLevel(t, info?.nivel) && referenceAppliesToSubject(t, courseSubject))
          : [];
        subjectOfCourse = subjectKey(courseSubject);
        const search = (docIds) => (docIds.length
          ? store.search({ ...ref, embedding, topK: topK * POOL_FACTOR, queryText: text, docIds })
          : []);
        // Cada grupo por separado: unos pocos apuntes del docente no pueden quedar tapados por miles de fragmentos de las Bases.
        const [fromNotes, fromReference] = await Promise.all([search(notesDocs), search(refDocs)]);
        found = [...fromNotes, ...fromReference];
      }
      const timings = { embed_ms: Math.round(t1 - t0), search_ms: Math.round(performance.now() - t1) };

      const candidates = found.map((h) => {
        const cov = coverage(queryStems, h.text);
        const reference = isReferenceDoc(h.doc_id);
        const evidence = Boolean(h.lexical) || cov > 0;
        let verdict = null;
        if (mathOnly) {
          // Los números no tienen significado para el embedding: se mira que los apuntes traten esa operación.
          if (h.score >= minScore && cov >= MATH_COVERAGE) verdict = 'los apuntes tratan esa operación';
        } else if (h.score >= strongScore) verdict = 'similitud alta';
        else if (h.score >= minScore && evidence) verdict = 'similitud y palabras en común';
        else if (h.lexical && h.score >= minScore - LEXICAL_LENIENCY) verdict = 'palabras exactas';
        const reason = verdict ?? (h.score < minScore ? 'similitud baja' : mathOnly ? 'los apuntes no tratan esa operación' : 'sin palabras en común con la pregunta');
        const rank = h.score + COVERAGE_WEIGHT * cov + (h.lexical ? LEXICAL_BONUS : 0) + (reference
          ? (referenceSubject(h.doc_id) === null ? -GENERAL_PENALTY : subjectOfCourse && referenceSubject(h.doc_id) === subjectOfCourse ? SUBJECT_BONUS : 0)
          : NOTES_BONUS);
        return { ...h, reference, coverage: cov, rank, accepted: verdict !== null, reason };
      });

      const best = found.length ? Math.max(...found.map((h) => h.score)) : null;
      const accepted = candidates.filter((c) => c.accepted).sort((a, b) => b.rank - a.rank);
      const top = accepted.length ? Math.max(...accepted.map((c) => c.score)) : 0;
      const relevant = accepted.filter((c) => {
        const keep = c.score >= top - RELATIVE_MARGIN || c.coverage >= KEEP_COVERAGE;
        if (!keep) { c.accepted = false; c.reason = 'muy por debajo del mejor'; }
        return keep;
      });

      const hits = diversify(relevant, topK).map((c) => ({
        doc_id: c.doc_id, chunk_index: c.chunk_index, text: c.text, score: c.score, reference: c.reference, ...(c.lexical !== undefined && { lexical: c.lexical }),
      }));
      return { hits, best, candidates, timings };
    },
  };
}
