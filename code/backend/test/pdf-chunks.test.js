import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, pagesToParagraphs } from '../src/modules/tutor/rag/pdf-chunks.js';
import { toTsQuery } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { createVectorStore } from '../src/modules/tutor/rag/vector-store.js';
import { withContext } from '../src/modules/tutor/rag/rag-prompt.js';
import { fakeEmbedder } from './fake-embedder.js';

// Tres páginas como las entrega un PDF: líneas cortadas, guion de fin de línea, pie de página y número.
const PAGES = [
  `Bases Curriculares 2021
EJE DE TERRITORIO
El territorio es el espacio cultural construido a través del tiempo y porta un profundo sentido espiri-
tual para los pueblos originarios de Chile.
1`,
  `Bases Curriculares 2021
La memoria histórica constituye una fuente de saberes sobre la vida social. Permite
comprender el pasado y el presente de cada pueblo.

EJE DE COSMOVISIÓN
La cosmovisión es la forma de ver y entender el mundo propio.
2`,
  `Bases Curriculares 2021
Todo está unido y relacionado en el cosmos.
3`,
  `Bases Curriculares 2021
Cuarta página de relleno para superar el mínimo de páginas.
4`,
];

describe('pagesToParagraphs', () => {
  const paragraphs = pagesToParagraphs(PAGES);
  const all = paragraphs.map((p) => p.text).join('\n');

  test('quita encabezados repetidos y números de página', () => {
    assert.ok(!all.includes('Bases Curriculares 2021'));
    assert.ok(!/^\d$/m.test(all));
  });

  test('reconstruye palabras partidas con guion y une las líneas', () => {
    assert.ok(all.includes('espiritual para los pueblos'));
    assert.ok(all.includes('Permite comprender el pasado'));
  });

  test('detecta los títulos y los asocia a sus párrafos (con su página)', () => {
    const territorio = paragraphs.find((p) => p.text.includes('espiritual'));
    assert.equal(territorio.section, 'EJE DE TERRITORIO');
    assert.equal(territorio.page, 1);
    const cosmo = paragraphs.find((p) => p.text.startsWith('La cosmovisión'));
    assert.equal(cosmo.section, 'EJE DE COSMOVISIÓN');
    assert.equal(cosmo.page, 2);
  });

  test('un título partido en dos líneas se une', () => {
    const [p] = pagesToParagraphs(['EJE DE LENGUA, TRADICIÓN ORAL,\nICONOGRAFÍA Y ESCRITURA\nTexto del eje de lengua.', 'x', 'y', 'z']);
    assert.equal(p.section, 'EJE DE LENGUA, TRADICIÓN ORAL, ICONOGRAFÍA Y ESCRITURA');
  });

  test('una frase cortada por el ancho de la página no se confunde con un título', () => {
    const [p] = pagesToParagraphs(['1. Las Bases Curriculares constituyen el documento principal del\nCurrículum Nacional de Chile.', 'x', 'y', 'z']);
    assert.equal(p.section, '');
    assert.ok(p.text.includes('principal del Currículum'));
  });
});

describe('chunkPages', () => {
  test('cada fragmento lleva cabecera con documento, sección y página', () => {
    const chunks = chunkPages(PAGES, { title: 'MINEDUC · Bases' });
    assert.ok(chunks.length >= 2);
    assert.match(chunks[0], /^\[MINEDUC · Bases · EJE DE TERRITORIO · pp\. 1–2\]\n/); // el fragmento abarca las páginas 1 y 2
    assert.ok(chunks.some((c) => c.startsWith('[MINEDUC · Bases · EJE DE COSMOVISIÓN · pp. 2–4]')));
  });

  test('no supera el máximo (más el solapamiento)', () => {
    const long = Array.from({ length: 4 }, (_, i) => `Página ${i}\n${'Una oración larga de prueba sobre el currículum nacional. '.repeat(60)}`);
    for (const c of chunkPages(long, { title: 'T', maxChars: 800, overlapChars: 100 })) assert.ok(c.length <= 800 + 100 + 10, `fragmento de ${c.length}`);
  });

  test('páginas vacías no generan fragmentos', () => {
    assert.deepEqual(chunkPages(['', '  ', '\n']), []);
  });
});

describe('toTsQuery', () => {
  test('arma "a | b" con palabras de 3+ letras, sin repetidas', () => {
    assert.equal(toTsQuery('¿Qué dice el OA 3 de lengua? lengua'), 'qué | dice | lengua');
  });

  test('descarta cualquier sintaxis de consulta que escriba el usuario', () => {
    assert.equal(toTsQuery("fracción'); DROP TABLE x; -- & | !"), 'fracción | drop | table');
  });

  test('sin palabras útiles devuelve null', () => {
    assert.equal(toTsQuery('?? ab'), null);
    assert.equal(toTsQuery(undefined), null);
  });
});

describe('RAG con PDF y varios documentos', () => {
  const A = { tenantId: 'colegio-a', courseId: 'mate-7' };
  const makeRag = (opts = {}) => createRagService({ embedder: fakeEmbedder(), store: createVectorStore(), minScore: 0.2, ...opts });

  test('ingest con pages indexa con cabecera y el tutor puede recuperarlo', async () => {
    const rag = makeRag();
    const res = await rag.ingest({ ...A, docId: 'bases.pdf', title: 'MINEDUC · Bases', pages: PAGES });
    assert.ok(res.chunks >= 2);
    const { hits } = await rag.retrieve({ ...A, query: 'territorio espacio cultural espiritual pueblos originarios' });
    assert.ok(hits.length > 0);
    assert.match(hits[0].text, /^\[MINEDUC · Bases · EJE DE TERRITORIO/);
  });

  test('prepare + save: los embeddings se calculan una vez y se guardan en varios cursos', async () => {
    const embedder = fakeEmbedder();
    const rag = createRagService({ embedder, store: createVectorStore(), minScore: 0.2 });
    const prepared = await rag.prepare({ pages: PAGES, title: 'MINEDUC · Bases' });
    const calls = embedder.calls.length;
    await rag.save({ ...A, docId: 'bases', prepared });
    await rag.save({ tenantId: 'colegio-a', courseId: 'historia-7', docId: 'bases', prepared });
    assert.equal(embedder.calls.length, calls);
    assert.equal((await rag.listDocuments(A))[0].chunks, prepared.chunks.length);
    assert.equal((await rag.listDocuments({ tenantId: 'colegio-a', courseId: 'historia-7' }))[0].chunks, prepared.chunks.length);
  });

  test('un documento no copia todos los cupos si hay otros relevantes', async () => {
    const rag = makeRag({ topK: 4 });
    const many = Array.from({ length: 10 }, (_, i) => `Parte ${i}: la fotosíntesis transforma luz solar en energía química dentro del cloroplasto de la planta.`).join('\n\n');
    await rag.ingest({ ...A, docId: 'a.md', text: many });
    await rag.ingest({ ...A, docId: 'b.md', text: 'La fotosíntesis ocurre en el cloroplasto y produce glucosa y oxígeno para la planta.' });
    const { hits } = await rag.retrieve({ ...A, query: 'fotosíntesis luz solar cloroplasto planta' });
    assert.ok(hits.length <= 4);
    assert.ok(hits.some((h) => h.doc_id === 'b.md'), 'debe incluir el otro documento');
  });

  test('con un solo documento llena todos los cupos', async () => {
    const rag = makeRag({ topK: 3, chunk: { maxChars: 120, overlapChars: 0 } });
    const text = Array.from({ length: 8 }, (_, i) => `Fragmento ${i}: la fotosíntesis transforma luz solar en energía química en el cloroplasto.`).join('\n\n');
    await rag.ingest({ ...A, docId: 'solo.md', text });
    const { hits } = await rag.retrieve({ ...A, query: 'fotosíntesis luz solar cloroplasto' });
    assert.equal(hits.length, 3);
  });

  test('un fragmento hallado también por palabras exactas pasa con un umbral algo menor', async () => {
    const store = {
      search: async () => [
        { doc_id: 'a', chunk_index: 0, text: 'x', score: 0.44, lexical: true },
        { doc_id: 'a', chunk_index: 1, text: 'y', score: 0.44, lexical: false },
        { doc_id: 'a', chunk_index: 2, text: 'z', score: 0.3, lexical: true },
      ],
    };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.5 });
    const { hits, best } = await rag.retrieve({ ...A, query: 'pregunta' });
    assert.deepEqual(hits.map((h) => h.chunk_index), [0]);
    assert.equal(best, 0.44);
  });
});

describe('withContext y bases del Mineduc', () => {
  test('agrega la regla sobre las Bases solo si hay fragmentos MINEDUC', () => {
    const plain = withContext('BASE', [{ doc_id: 'fracciones.md', text: 'x', score: 1 }]);
    const mineduc = withContext('BASE', [{ doc_id: 'MINEDUC · Bases Curriculares 7° básico a 2° medio', text: 'x', score: 1 }]);
    assert.ok(!plain.includes('Bases Curriculares del Mineduc'));
    assert.ok(mineduc.includes('Bases Curriculares del Mineduc'));
  });
});
