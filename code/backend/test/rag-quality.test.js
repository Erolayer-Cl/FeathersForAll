// Calidad del RAG: que el tutor responda con los apuntes del docente y no con lo que "suena parecido".
// Casos de partida: las capturas en que "1+1" y "10x10" devolvían objetivos de aprendizaje de las Bases del Mineduc.
// Sin base ni Ollama: embedder de prueba (bolsa de palabras) y almacén en memoria.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunkText } from '../src/modules/tutor/rag/chunker.js';
import { chunkMarkdown, splitSections } from '../src/modules/tutor/rag/markdown-chunks.js';
import { isReferenceDoc, parseLevel, referenceAppliesToLevel, referenceAppliesToSubject, referenceSubject, subjectKey } from '../src/modules/tutor/rag/doc-kinds.js';
import { pageLevel, segmentPagesByLevel } from '../src/modules/tutor/rag/mineduc-segments.js';
import { coverage, expandMathQuery, isCurricularQuestion, isMathExpression, significantStems, stem } from '../src/modules/tutor/rag/relevance.js';
import { formatBlocks, joinChunks, splitHeader, stitchHits } from '../src/modules/tutor/rag/context.js';
import { createVectorStore } from '../src/modules/tutor/rag/vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { buildQuery, GROUNDED_TEMPERATURE, NO_INFO_REPLY, NO_NOTES_REPLY, prepareTurn, withContext } from '../src/modules/tutor/rag/rag-prompt.js';
import { createOllamaClient } from '../src/modules/tutor/llm-client.js';
import { fakeEmbedder } from './fake-embedder.js';

const A = { tenantId: 'colegio-a', courseId: 'mate-7' };
const catalog = JSON.parse(readFileSync(new URL('../scripts/mineduc-catalogo.json', import.meta.url), 'utf8'));
const TITLES = Object.values(catalog);
const subjectsCatalog = JSON.parse(readFileSync(new URL('../scripts/mineduc-asignaturas.json', import.meta.url), 'utf8'));
const MAT_7 = 'MINEDUC · Matemática · 7° básico a 2° medio';
const MAT_1 = 'MINEDUC · Matemática · 1° a 6° básico';
const HIST_7 = 'MINEDUC · Historia, Geografía y Ciencias Sociales · 7° básico a 2° medio';
const GENERAL_7 = 'MINEDUC · Introducciones generales y decretos · 7° básico a 2° medio';
const B1_6 = 'MINEDUC · Bases Curriculares 1° a 6° básico';
const B7_2M = 'MINEDUC · Bases Curriculares 7° básico a 2° medio';

const FRACCIONES = `# Fracciones

Una fracción representa una parte de un todo. El numerador indica cuántas partes se toman y el denominador en cuántas partes iguales se divide el todo.

## Suma de fracciones con igual denominador

Cuando las fracciones tienen el mismo denominador, se suman los numeradores y se conserva el denominador. Por ejemplo, 2/7 + 3/7 = 5/7.

## Simplificar una fracción

Simplificar es dividir numerador y denominador por su máximo común divisor.`;

const MULTIPLICACION = `# Multiplicación

La multiplicación es una suma repetida. El producto es el resultado de multiplicar dos factores. Para multiplicar por 10 se agrega un cero: 10 x 10 = 100.

## Tablas de multiplicar

Las tablas de multiplicar ayudan a calcular productos rápido.`;

const OBJETIVOS = `# Matemática

OA 3: Sumar números hasta 20, utilizando estrategias personales como el doble del doble, la descomposición de números, estimación, resolución de problemas y aplicación de algoritmos.

OA 9: Demostrar que comprendes la multiplicación de números naturales y las fracciones.`;

/** RAG con embedder de prueba y un almacén que además informa el nivel del curso. */
function makeRag({ nivel = '7B', ...overrides } = {}) {
  const store = createVectorStore();
  return createRagService({ embedder: fakeEmbedder(), store: { ...store, courseInfo: async () => ({ nivel }) }, minScore: 0.2, ...overrides });
}
const ask = (rag, content, extra = {}) => prepareTurn({ rag, ...A, messages: [{ role: 'user', content }], systemPrompt: 'BASE', ...extra });

describe('doc-kinds', () => {
  test('las Bases del Mineduc son referencias; los apuntes del docente, no', () => {
    assert.equal(isReferenceDoc(B1_6), true);
    assert.equal(isReferenceDoc('mineduc bases'), true);
    assert.equal(isReferenceDoc('fracciones.md'), false);
    assert.equal(isReferenceDoc('Guía del MINEDUC.pdf'), false);
    assert.equal(isReferenceDoc(undefined), false);
  });

  test('parseLevel entiende el nivel del curso', () => {
    assert.deepEqual(parseLevel('7B'), { stage: 'basico', grade: 7 });
    assert.deepEqual(parseLevel('7° Básico'), { stage: 'basico', grade: 7 });
    assert.deepEqual(parseLevel('2M'), { stage: 'medio', grade: 2 });
    assert.deepEqual(parseLevel('3° medio'), { stage: 'medio', grade: 3 });
    assert.deepEqual(parseLevel('NT1'), { stage: 'parvularia', grade: null });
    for (const bad of ['', null, undefined, 'abc', '9B', '5M']) assert.equal(parseLevel(bad), null, String(bad));
  });

  test('un curso de 7° básico recibe solo las Bases de 7° básico a 2° medio', () => {
    const applies = TITLES.filter((t) => referenceAppliesToLevel(t, '7B'));
    assert.deepEqual(applies, [B7_2M]);
  });

  test('cada nivel recibe las Bases que le corresponden', () => {
    const at = (nivel) => TITLES.filter((t) => referenceAppliesToLevel(t, nivel));
    assert.ok(at('2M').includes(B7_2M));
    assert.ok(!at('2M').some((t) => /1° a 6°/.test(t)));
    assert.ok(at('3M').some((t) => /3° y 4° medio \(Formación General\)/.test(t)));
    assert.ok(at('3M').some((t) => /Técnico-Profesional/.test(t)));
    assert.ok(!at('3M').includes(B7_2M));
    assert.ok(at('1B').includes(B1_6));
    assert.ok(!at('1B').includes(B7_2M));
    assert.deepEqual(at('NT1'), TITLES.filter((t) => /Parvularia/.test(t)));
  });

  test('sin nivel reconocible no se excluye nada', () => {
    assert.equal(TITLES.filter((t) => referenceAppliesToLevel(t, null)).length, TITLES.length);
    assert.equal(referenceAppliesToLevel(B1_6, 'taller libre'), true);
  });
});

describe('relevance', () => {
  test('las raíces ignoran plurales y tildes', () => {
    assert.equal(stem('fracciones'), stem('fraccion'));
    assert.equal(stem('numeradores'), stem('numerador'));
    assert.deepEqual([...significantStems('¿Qué es el denominador?')], ['denomi']);
  });

  test('las palabras de ayuda ("dame un ejemplo") no cuentan como contenido', () => {
    assert.equal(significantStems('dame un ejemplo').size, 0);
    assert.equal(significantStems('explícame esto por favor').size, 0);
  });

  test('cobertura: parte de las palabras importantes de la pregunta que aparece en el fragmento', () => {
    const q = significantStems('suma de fracciones');
    assert.equal(coverage(q, 'Para sumar fracciones con igual denominador'), 1 / 2); // "fracciones" sí; "suma" no (dice "sumar")
    assert.equal(coverage(q, 'La suma de dos fracciones'), 1);
    assert.equal(coverage(q, 'Los volcanes de Chile'), 0);
    assert.equal(coverage(new Set(), 'cualquier texto'), 0, 'sin palabras importantes no hay evidencia');
  });

  test('expandMathQuery agrega las palabras de la operación', () => {
    assert.match(expandMathQuery('10x10'), /multiplicación/);
    assert.match(expandMathQuery('1+1'), /suma/);
    assert.match(expandMathQuery('9-4'), /resta/);
    assert.match(expandMathQuery('8 ÷ 2'), /división/);
    assert.match(expandMathQuery('3/4'), /fracción/);
    assert.match(expandMathQuery('2^3'), /potencia/);
  });

  test('expandMathQuery no toca preguntas con palabras suficientes', () => {
    const q = 'cómo se multiplican dos fracciones con distinto denominador 3/4';
    assert.equal(expandMathQuery(q), q);
    assert.equal(expandMathQuery('¿qué es una fracción?'), '¿qué es una fracción?');
  });

  test('isMathExpression: solo operaciones, sin palabras que digan el tema', () => {
    for (const q of ['1+1', '10x10', 'cuanto es 10x10', 'cuánto es 3/4 + 1/2', '2 + 2 =']) assert.equal(isMathExpression(q), true, q);
    for (const q of ['qué es una fracción', 'cómo sumo 2/7 + 3/7', 'calcula 25 por 4', 'hola', '¿y eso?']) assert.equal(isMathExpression(q), false, q);
  });

  test('isCurricularQuestion distingue "qué se espera aprender" de una duda de contenido', () => {
    for (const q of ['¿Qué objetivos de aprendizaje hay en matemática?', 'explícame el OA 3', 'qué voy a aprender este año', 'según el currículum nacional', 'qué dicen las bases curriculares']) {
      assert.equal(isCurricularQuestion(q), true, q);
    }
    for (const q of ['1+1', '¿qué es una fracción?', 'cómo se suman fracciones', 'cuánto es 10x10', 'hola', '']) {
      assert.equal(isCurricularQuestion(q), false, q);
    }
  });
});

describe('context: fragmentos contiguos y encabezados', () => {
  test('splitHeader separa la cabecera de contexto del cuerpo', () => {
    assert.deepEqual(splitHeader('[Doc · Sección · p. 3]\ntexto'), { header: 'Doc · Sección · p. 3', body: 'texto' });
    assert.deepEqual(splitHeader('sin cabecera'), { header: '', body: 'sin cabecera' });
    assert.deepEqual(splitHeader('[no es cabecera] sigue en la misma línea'), { header: '', body: '[no es cabecera] sigue en la misma línea' });
  });

  test('joinChunks quita el solapamiento que repite el chunker', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Oración número ${i} sobre fracciones y denominadores.`).join(' ');
    const [first, second] = chunkText(text, { maxChars: 300, overlapChars: 80 });
    const joined = joinChunks(first, second);
    assert.ok(joined.length < first.length + second.length, 'el solapamiento no se repite');
    assert.equal(joined.split('Oración número 3 ').length, 2, 'cada oración aparece una vez');
    assert.ok(joined.startsWith(first) && joined.endsWith(second.slice(-40)));
  });

  test('joinChunks sin solapamiento los separa con una línea en blanco', () => {
    assert.equal(joinChunks('Primero.', 'Segundo.'), 'Primero.\n\nSegundo.');
  });

  test('stitchHits une los vecinos del mismo documento en un bloque y respeta el orden de relevancia', () => {
    const hits = [
      { doc_id: 'b.md', chunk_index: 4, text: 'B cuatro', score: 0.9 },
      { doc_id: 'a.md', chunk_index: 2, text: '[A · Tema]\nA dos', score: 0.8 },
      { doc_id: 'a.md', chunk_index: 3, text: '[A · Tema]\nA tres', score: 0.7 },
      { doc_id: 'a.md', chunk_index: 7, text: 'A siete', score: 0.6 },
    ];
    const blocks = stitchHits(hits);
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks.map((b) => b.doc_id), ['b.md', 'a.md', 'a.md']);
    assert.deepEqual(blocks[1].chunks, [2, 3]);
    assert.equal(blocks[1].header, 'A · Tema');
    assert.ok(blocks[1].body.includes('A dos') && blocks[1].body.includes('A tres'));
    assert.ok(!blocks[1].body.includes('[A · Tema]'), 'la cabecera del segundo fragmento no se repite');
    assert.deepEqual(blocks[2].chunks, [7]);
  });

  test('formatBlocks: una sola línea de fuente por bloque, numerada, con las oficiales marcadas', () => {
    const out = formatBlocks(stitchHits([
      { doc_id: 'fracciones.md', chunk_index: 0, text: '[fracciones · Suma]\nSe suman los numeradores.', score: 0.9 },
      { doc_id: B7_2M, chunk_index: 0, text: `[${B7_2M} · OA 1]\nMostrar que comprenden…`, score: 0.7 },
    ]));
    assert.match(out, /^\[1\] Fuente: fracciones · Suma\nSe suman los numeradores\./);
    assert.match(out, /\[2\] Fuente: MINEDUC .* \(documento oficial\)/);
    assert.equal(out.match(/Fuente:/g).length, 2);
  });
});

describe('chunkMarkdown', () => {
  test('cada fragmento lleva el documento y la ruta de títulos', () => {
    const chunks = chunkMarkdown(FRACCIONES, { title: 'fracciones' });
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((c) => c.startsWith('[fracciones · Fracciones')));
    const suma = chunks.find((c) => c.includes('se suman los numeradores'));
    assert.match(suma, /^\[fracciones · Fracciones › Suma de fracciones con igual denominador\]\n/);
  });

  test('un subtítulo reemplaza al subtítulo anterior del mismo nivel', () => {
    const sections = splitSections('# A\n\nuno\n\n## B\n\ndos\n\n## C\n\ntres\n\n# D\n\ncuatro');
    assert.deepEqual(sections.map((s) => s.section), ['A', 'A › B', 'A › C', 'D']);
  });

  test('un # dentro de un bloque de código no es un título', () => {
    const sections = splitSections('# Python\n\n```\n# esto es un comentario\nprint(1)\n```');
    assert.equal(sections.length, 1);
    assert.match(sections[0].text, /# esto es un comentario/);
  });

  test('sin títulos ni nombre queda igual que antes; con nombre lo lleva en la cabecera', () => {
    assert.deepEqual(chunkMarkdown('Solo un párrafo.'), ['Solo un párrafo.']);
    assert.deepEqual(chunkMarkdown('Solo un párrafo.', { title: 'clase1' }), ['[clase1]\nSolo un párrafo.']);
    assert.deepEqual(chunkMarkdown('  \n\n '), []);
  });

  test('con la cabecera, ningún fragmento pasa del máximo (más el solapamiento)', () => {
    const long = `# Tema\n\n${'Una oración de relleno sobre el tema del apunte. '.repeat(60)}`;
    for (const c of chunkMarkdown(long, { title: 'apunte', maxChars: 500, overlapChars: 80 })) assert.ok(c.length <= 500 + 80 + 2, `${c.length}`);
  });
});

describe('retrieve: relevancia real, no solo parecido', () => {
  test('un fragmento parecido pero sin palabras en común con la pregunta se descarta', async () => {
    const store = { search: async () => [{ doc_id: 'a', chunk_index: 0, text: 'Los volcanes de Chile', score: 0.55 }] };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.5 });
    const { hits, candidates } = await rag.retrieve({ ...A, query: 'cómo se suman fracciones' });
    assert.equal(hits.length, 0);
    assert.equal(candidates[0].reason, 'sin palabras en común con la pregunta');
  });

  test('con similitud alta sirve aunque la pregunta use otras palabras (paráfrasis)', async () => {
    const store = { search: async () => [{ doc_id: 'a', chunk_index: 0, text: 'Los volcanes de Chile', score: 0.7 }] };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.5 });
    assert.equal((await rag.retrieve({ ...A, query: 'cómo se suman fracciones' })).hits.length, 1);
  });

  test('strongScore es configurable', async () => {
    const store = { search: async () => [{ doc_id: 'a', chunk_index: 0, text: 'Los volcanes de Chile', score: 0.7 }] };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.5, strongScore: 0.8 });
    assert.equal((await rag.retrieve({ ...A, query: 'cómo se suman fracciones' })).hits.length, 0);
  });

  test('se descarta la cola que queda muy por debajo del mejor, salvo que comparta muchas palabras', async () => {
    const store = {
      search: async () => [
        { doc_id: 'a', chunk_index: 0, text: 'Las fracciones y el denominador', score: 0.9 },
        { doc_id: 'a', chunk_index: 1, text: 'Las fracciones se escriben con barra', score: 0.6 }, // cubre 1 de 3 palabras
        { doc_id: 'b', chunk_index: 0, text: 'Fracciones: el denominador indica partes iguales', score: 0.55 }, // cubre 2 de 3 → se queda
      ],
    };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.5 });
    const { hits, candidates } = await rag.retrieve({ ...A, query: 'fracciones denominador partes' });
    assert.deepEqual(hits.map((h) => `${h.doc_id}${h.chunk_index}`).sort(), ['a0', 'b0']);
    assert.equal(candidates.find((c) => c.doc_id === 'a' && c.chunk_index === 1).reason, 'muy por debajo del mejor');
  });

  test('ordena por similitud + cobertura: el que responde la pregunta pasa al que solo se parece', async () => {
    const store = {
      search: async () => [
        { doc_id: 'a', chunk_index: 0, text: 'Texto general sobre matemática y números', score: 0.66 },
        { doc_id: 'b', chunk_index: 0, text: 'El denominador indica en cuántas partes se divide el todo', score: 0.62 },
      ],
    };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.5 });
    const { hits } = await rag.retrieve({ ...A, query: '¿qué indica el denominador?' });
    assert.equal(hits[0].doc_id, 'b');
  });

  test('los apuntes del docente van antes que las Bases en igualdad de condiciones', async () => {
    const rag = makeRag();
    const text = 'La multiplicación de fracciones: se multiplican numeradores y denominadores entre sí.';
    await rag.ingest({ ...A, docId: B7_2M, text });
    await rag.ingest({ ...A, docId: 'mis-apuntes.md', text });
    const { hits } = await rag.retrieve({ ...A, query: 'multiplicación de fracciones numeradores denominadores', curricular: true });
    assert.equal(hits[0].doc_id, 'mis-apuntes.md');
    assert.equal(hits[0].reference, false);
    assert.equal(hits[1].reference, true);
  });
});

describe('retrieve: las Bases del Mineduc solo cuentan para preguntas curriculares', () => {
  async function courseWith(docs, opts) {
    const rag = makeRag(opts);
    for (const [docId, text] of docs) await rag.ingest({ ...A, docId, text });
    return rag;
  }

  test('una pregunta de contenido no consulta las Bases, aunque calcen', async () => {
    const rag = await courseWith([['fracciones.md', FRACCIONES], [B7_2M, OBJETIVOS]]);
    const { hits } = await rag.retrieve({ ...A, query: 'multiplicación de números naturales y fracciones' });
    assert.ok(!hits.some((h) => h.reference));
  });

  test('una pregunta curricular sí las consulta', async () => {
    const rag = await courseWith([['fracciones.md', FRACCIONES], [B7_2M, OBJETIVOS]]);
    const { hits } = await rag.retrieve({ ...A, query: 'OA 9 multiplicación de números naturales y fracciones', curricular: true });
    assert.ok(hits.some((h) => h.doc_id === B7_2M));
  });

  test('solo se consultan las Bases del nivel del curso', async () => {
    const rag = await courseWith([[B1_6, OBJETIVOS], [B7_2M, OBJETIVOS]], { nivel: '7B' });
    const { hits } = await rag.retrieve({ ...A, query: 'OA 3 sumar números hasta 20 estrategias personales', curricular: true });
    assert.deepEqual([...new Set(hits.map((h) => h.doc_id))], [B7_2M]);
  });

  test('referenceMode "always" las consulta siempre y "off" nunca', async () => {
    const docs = [['fracciones.md', FRACCIONES], [B7_2M, OBJETIVOS]];
    const always = await courseWith(docs, { referenceMode: 'always' });
    assert.ok((await always.retrieve({ ...A, query: 'sumar números hasta 20 estrategias personales' })).hits.some((h) => h.reference));
    const off = await courseWith(docs, { referenceMode: 'off' });
    assert.ok(!(await off.retrieve({ ...A, query: 'OA 3 sumar números hasta 20', curricular: true })).hits.some((h) => h.reference));
    assert.equal(off.usesReference(true), false);
  });

  test('los apuntes se buscan aparte: no los tapan miles de fragmentos de las Bases', async () => {
    const seen = [];
    const store = {
      listTitles: async () => ['mis-apuntes.md', B7_2M],
      courseInfo: async () => ({ nivel: '7B' }),
      search: async (q) => { seen.push(q.docIds); return []; },
    };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.2 });
    await rag.retrieve({ ...A, query: 'qué objetivos de aprendizaje hay', curricular: true });
    assert.deepEqual(seen.sort(), [['MINEDUC · Bases Curriculares 7° básico a 2° medio'], ['mis-apuntes.md']].sort());
  });

  test('courseState: las Bases no cuentan como apuntes del docente', async () => {
    const rag = await courseWith([[B7_2M, OBJETIVOS]]);
    assert.deepEqual(await rag.courseState(A), { hasAny: true, hasNotes: false, titles: [B7_2M] });
    await rag.ingest({ ...A, docId: 'fracciones.md', text: FRACCIONES });
    assert.equal((await rag.courseState(A)).hasNotes, true);
    assert.deepEqual(await rag.courseState({ ...A, courseId: 'otro' }), { hasAny: false, hasNotes: false, titles: [] });
  });
});

describe('prepareTurn: los casos de las capturas', () => {
  test('"1+1" con apuntes de fracciones y las Bases cargadas → "no encuentro eso", no un objetivo de aprendizaje', async () => {
    const rag = makeRag();
    await rag.ingest({ ...A, docId: 'fracciones.md', text: FRACCIONES });
    await rag.ingest({ ...A, docId: B1_6, text: OBJETIVOS });
    for (const q of ['1+1', '10x10', 'cuanto es 10x10']) {
      const turn = await ask(rag, q);
      assert.equal(turn.kind, 'no-info', q);
      assert.equal(turn.reply, NO_INFO_REPLY);
    }
  });

  test('"cuánto es 10x10" con apuntes de multiplicación → responde con ellos', async () => {
    const rag = makeRag();
    await rag.ingest({ ...A, docId: 'multiplicacion.md', text: MULTIPLICACION });
    await rag.ingest({ ...A, docId: B1_6, text: OBJETIVOS });
    const turn = await ask(rag, 'cuanto es 10x10');
    assert.equal(turn.kind, 'grounded');
    assert.deepEqual(turn.sources.map((s) => s.doc_id), ['multiplicacion.md']);
    assert.match(turn.system, /10 x 10 = 100/);
    assert.ok(!turn.system.includes('Sumar números hasta 20'));
  });

  test('solo las Bases cargadas y una pregunta de contenido → "tu docente aún no ha subido apuntes"', async () => {
    const rag = makeRag();
    await rag.ingest({ ...A, docId: B7_2M, text: OBJETIVOS });
    for (const q of ['1+1', 'cómo se suman fracciones']) {
      const turn = await ask(rag, q);
      assert.equal(turn.kind, 'no-notes', q);
      assert.equal(turn.reply, NO_NOTES_REPLY);
    }
  });

  test('solo las Bases cargadas y una pregunta curricular → responde con las Bases, marcadas como oficiales', async () => {
    const rag = makeRag();
    await rag.ingest({ ...A, docId: B7_2M, text: OBJETIVOS });
    const turn = await ask(rag, '¿Qué objetivos de aprendizaje OA 9 multiplicación de números naturales hay?');
    assert.equal(turn.kind, 'grounded');
    assert.match(turn.system, /\(documento oficial\)/);
    assert.match(turn.system, /Bases Curriculares del Mineduc/);
  });

  test('con apuntes relevantes responde con ellos, a baja temperatura', async () => {
    const rag = makeRag();
    await rag.ingest({ ...A, docId: 'fracciones.md', text: FRACCIONES });
    await rag.ingest({ ...A, docId: B7_2M, text: OBJETIVOS });
    const turn = await ask(rag, '¿Cómo se suman fracciones con igual denominador?');
    assert.equal(turn.kind, 'grounded');
    assert.equal(turn.temperature, GROUNDED_TEMPERATURE);
    assert.deepEqual(turn.sources.map((s) => s.doc_id), ['fracciones.md']);
    assert.match(turn.system, /\[1\] Fuente: fracciones · Fracciones › Suma de fracciones con igual denominador\n/);
  });

  test('la charla y los mensajes fijos no fuerzan temperatura', async () => {
    const rag = makeRag();
    await rag.ingest({ ...A, docId: 'fracciones.md', text: FRACCIONES });
    assert.equal((await ask(rag, 'hola')).temperature, undefined);
    assert.equal((await ask(rag, 'capital de Francia')).temperature, undefined);
  });

  test('un RAG sin courseState (otra implementación) sigue funcionando', async () => {
    const rag = {
      hasCourse: async () => true,
      retrieve: async () => ({ hits: [{ doc_id: 'x.md', chunk_index: 0, text: 'El denominador…', score: 0.9 }], best: 0.9 }),
    };
    const turn = await ask(rag, '¿Qué es el denominador?');
    assert.equal(turn.kind, 'grounded');
  });
});

describe('withContext: lo que ve el modelo', () => {
  const hits = [
    { doc_id: 'fracciones.md', chunk_index: 1, text: '[fracciones · Suma]\nSe suman los numeradores.', score: 0.9 },
    { doc_id: 'fracciones.md', chunk_index: 2, text: '[fracciones · Suma]\nEjemplo: 2/7 + 3/7 = 5/7.', score: 0.8 },
  ];

  test('fragmentos contiguos llegan como un solo bloque con una sola línea de fuente', () => {
    const prompt = withContext('BASE', hits);
    assert.equal(prompt.match(/^\[\d+\] Fuente:/gm).length, 1);
    assert.match(prompt, /\[1\] Fuente: fracciones · Suma\nSe suman los numeradores\.[\s\S]*Ejemplo: 2\/7/);
    assert.ok(!prompt.includes('[2] Fuente'));
  });

  test('fragmentos contiguos de SECCIONES distintas no se mezclan: cada bloque dice su tema', () => {
    const prompt = withContext('BASE', [
      { doc_id: 'f.md', chunk_index: 0, text: '[f · Suma]\nSe suman los numeradores.', score: 0.9 },
      { doc_id: 'f.md', chunk_index: 1, text: '[f · Resta]\nSe restan los numeradores.', score: 0.8 },
    ]);
    assert.match(prompt, /\[1\] Fuente: f · Suma\nSe suman[\s\S]*\[2\] Fuente: f · Resta\nSe restan/);
  });

  test('las páginas de fragmentos contiguos de una misma sección se unen en un rango', () => {
    const [block] = stitchHits([
      { doc_id: 'x.pdf', chunk_index: 0, text: '[x · Eje · p. 3]\nuno', score: 0.9 },
      { doc_id: 'x.pdf', chunk_index: 1, text: '[x · Eje · pp. 3–4]\ndos', score: 0.8 },
    ]);
    assert.equal(block.header, 'x · Eje · pp. 3–4');
  });

  test('el prompt pide explicar con palabras propias, citar solo el número y responder directo', () => {
    const prompt = withContext('BASE', hits);
    assert.match(prompt, /propias palabras/);
    assert.match(prompt, /No copies párrafos completos/);
    assert.match(prompt, /Solo el número: sin paréntesis ni nombres/);
    assert.match(prompt, /Empieza respondiendo directamente/);
    assert.match(prompt, /SOLO la información de los apuntes/);
  });
});

describe('buildQuery: seguimientos', () => {
  const convo = (last) => [
    { role: 'user', content: '¿Cómo se suman fracciones con distinto denominador?' },
    { role: 'assistant', content: 'Primero se busca el m.c.m. [1]' },
    { role: 'user', content: last },
  ];

  test('un seguimiento aunque no sea tan corto ("¿y si el denominador es 5?") se completa con la pregunta anterior', () => {
    assert.match(buildQuery(convo('¿y si uno de los denominadores es 5?')), /Cómo se suman fracciones[\s\S]*denominadores es 5/);
    assert.match(buildQuery(convo('no entendí lo del mínimo común múltiplo')), /Cómo se suman fracciones/);
  });

  test('una pregunta nueva con contenido propio no arrastra la anterior', () => {
    assert.equal(buildQuery(convo('¿Qué es el máximo común divisor de dos números?')), '¿Qué es el máximo común divisor de dos números?');
  });
});

describe('llm-client: temperatura por respuesta', () => {
  async function bodyOf({ configured, requested }) {
    let sent;
    const fetchImpl = async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response('{"message":{"content":"ok"},"done":true}\n', { status: 200 });
    };
    const llm = createOllamaClient({ endpoint: 'http://x', model: 'm', timeoutMs: 1000, temperature: configured, fetchImpl });
    for await (const chunk of llm.chat([{ role: 'user', content: 'hola' }], requested === undefined ? {} : { temperature: requested })) void chunk;
    return sent;
  }

  test('se usa la menor entre la pedida y la configurada', async () => {
    assert.equal((await bodyOf({ configured: 0.6, requested: 0.2 })).options.temperature, 0.2);
    assert.equal((await bodyOf({ configured: 0.1, requested: 0.2 })).options.temperature, 0.1);
  });

  test('sin temperatura configurada se usa la pedida; sin pedir nada, la configurada', async () => {
    assert.equal((await bodyOf({ configured: undefined, requested: 0.2 })).options.temperature, 0.2);
    assert.equal((await bodyOf({ configured: 0.6, requested: undefined })).options.temperature, 0.6);
    assert.equal((await bodyOf({ configured: undefined, requested: undefined })).options, undefined);
  });
});

describe('almacén en archivo: documentos', () => {
  test('listTitles y search con docIds', async () => {
    const store = createVectorStore();
    const embedder = fakeEmbedder();
    const rag = createRagService({ embedder, store, minScore: 0.2 });
    await rag.ingest({ ...A, docId: 'a.md', text: 'fotosíntesis y cloroplasto' });
    await rag.ingest({ ...A, docId: 'b.md', text: 'fotosíntesis y glucosa' });
    assert.deepEqual(store.listTitles(A).sort(), ['a.md', 'b.md']);
    const [embedding] = await embedder.embed(['fotosíntesis']);
    assert.deepEqual(store.search({ ...A, embedding, topK: 5, docIds: ['b.md'] }).map((h) => h.doc_id), ['b.md']);
    assert.equal(store.search({ ...A, embedding, topK: 5 }).length, 2);
  });
});

describe('asignaturas', () => {
  test('subjectKey reconoce la asignatura por el nombre del curso', () => {
    const cases = {
      'Matemáticas 7° Básico A': 'matematica', Matemática: 'matematica', Lenguaje: 'lengua', 'Lengua y Literatura 2° Medio': 'lengua',
      'Historia 7° Básico A': 'historia', 'Ciencias Sociales': 'historia', 'Ciencias Naturales': 'ciencias', Física: 'ciencias',
      'Educación Física y Salud': 'educacion-fisica', 'Inglés': 'ingles', 'Artes Visuales': 'artes-visuales', Música: 'musica',
      'Lengua y Cultura de los Pueblos Originarios': 'pueblos-originarios', 'Educación Ciudadana': 'educacion-ciudadana',
    };
    for (const [text, key] of Object.entries(cases)) assert.equal(subjectKey(text), key, text);
    for (const unknown of ['Taller de robótica', '', null, undefined]) assert.equal(subjectKey(unknown), null, String(unknown));
  });

  test('todas las asignaturas del catálogo se reconocen (menos las introducciones generales)', () => {
    for (const { subject } of Object.values(subjectsCatalog)) {
      if (/^Introducciones/.test(subject)) assert.equal(referenceSubject(`MINEDUC · ${subject}`), null);
      else assert.notEqual(referenceSubject(`MINEDUC · ${subject} · 7° básico a 2° medio`), null, subject);
    }
  });

  test('referenceSubject: las Bases antiguas y las introducciones son generales', () => {
    assert.equal(referenceSubject(MAT_7), 'matematica');
    assert.equal(referenceSubject(HIST_7), 'historia');
    assert.equal(referenceSubject(GENERAL_7), null);
    assert.equal(referenceSubject(B7_2M), null);
    assert.equal(referenceSubject('fracciones.md'), null);
  });

  test('un curso recibe las Bases de su asignatura y las generales, no las de otras', () => {
    assert.equal(referenceAppliesToSubject(MAT_7, 'Matemática'), true);
    assert.equal(referenceAppliesToSubject(HIST_7, 'Matemática'), false);
    assert.equal(referenceAppliesToSubject(GENERAL_7, 'Matemática'), true);
    assert.equal(referenceAppliesToSubject(B7_2M, 'Matemática'), true);
    assert.equal(referenceAppliesToSubject(HIST_7, 'Matemáticas 7° Básico A'), false);
    assert.equal(referenceAppliesToSubject(HIST_7, 'Taller libre'), true, 'sin asignatura reconocible no se excluye');
    assert.equal(referenceAppliesToSubject(HIST_7, null), true);
  });

  test('los nombres por asignatura y nivel funcionan con el filtro de nivel', () => {
    assert.equal(referenceAppliesToLevel(MAT_7, '7B'), true);
    assert.equal(referenceAppliesToLevel(MAT_1, '7B'), false);
    assert.equal(referenceAppliesToLevel('MINEDUC · Matemática · 3° y 4° medio', '3M'), true);
    assert.equal(referenceAppliesToLevel('MINEDUC · Lengua y Literatura · 1° a 6° básico', '3B'), true);
    assert.equal(referenceAppliesToLevel('MINEDUC · Lengua y Literatura · 1° a 6° básico', '8B'), false);
  });
});

describe('segmentación de los PDF por nivel', () => {
  const page = (level, extra = '') => `Matemática ${extra}\nBases Curriculares Ú ${level}\ntexto`;

  test('pageLevel entiende los encabezados reales de las Bases', () => {
    assert.equal(pageLevel('Bases Curriculares Ú 1º a 6º Básico'), 0);
    assert.equal(pageLevel('Matemática   Bases Curriculares 2015 | 7° básico a 2° medio | Matemática'), 1);
    assert.equal(pageLevel('Bases Curriculares Ú 3º y 4º medio'), 2);
    assert.equal(pageLevel('texto cualquiera sobre las bases'), -1);
  });

  test('cada página hereda el nivel del último encabezado; la portada pasa al primer nivel', () => {
    const pages = ['portada', page('1º a 6º Básico'), 'sin encabezado', page('1º a 6º Básico'), 'sin encabezado', page('7° básico a 2° medio'), 'sin encabezado', page('3º y 4º medio')];
    const segs = segmentPagesByLevel(pages);
    assert.deepEqual(segs.map((s) => [s.level, s.offset, s.pages.length]), [
      ['1° a 6° básico', 0, 5],
      ['7° básico a 2° medio', 5, 2],
      ['3° y 4° medio', 7, 1],
    ]);
  });

  test('los niveles solo avanzan: una mención suelta de un nivel anterior no parte el tramo', () => {
    const segs = segmentPagesByLevel([page('3º y 4º medio'), 'a', 'Bases Curriculares Ú 1º a 6º Básico', 'b']);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].level, '3° y 4° medio');
  });

  test('sin ningún encabezado queda un solo tramo sin nivel', () => {
    assert.deepEqual(segmentPagesByLevel(['uno', 'dos']), [{ level: null, pages: ['uno', 'dos'], offset: 0 }]);
  });

  test('con tramos, las páginas citadas siguen siendo las del PDF (pageOffset)', async () => {
    const rag = makeRag();
    const pages = ['x', 'Bases Curriculares Ú 1º a 6º Básico\nUna página.', 'y', `Bases Curriculares Ú 3º y 4º medio\n${'Texto del tramo final sobre probabilidades. '.repeat(10)}`];
    const last = segmentPagesByLevel(pages).at(-1);
    const prepared = await rag.prepare({ pages: last.pages, pageOffset: last.offset, title: 'MINEDUC · Matemática · 3° y 4° medio' });
    assert.match(prepared.chunks[0].text, /^\[MINEDUC · Matemática · 3° y 4° medio · p\. 4\]/);
  });
});

describe('retrieve: Bases por asignatura', () => {
  const OBJ = 'OA 5: Resolver problemas con fracciones y números decimales positivos en contextos cotidianos.';
  async function courseWith(docs, info) {
    const store = createVectorStore();
    const rag = createRagService({ embedder: fakeEmbedder(), store: { ...store, courseInfo: async () => info }, minScore: 0.2 });
    for (const [docId, text] of docs) await rag.ingest({ ...A, docId, text });
    return rag;
  }

  test('un curso de Matemática 7B no recibe las Bases de Historia ni las de 1° a 6°', async () => {
    const rag = await courseWith([[MAT_7, OBJ], [MAT_1, OBJ], [HIST_7, OBJ]], { nivel: '7B', asignatura: 'Matemática' });
    const { hits } = await rag.retrieve({ ...A, query: 'OA 5 resolver problemas con fracciones y números decimales', curricular: true });
    assert.deepEqual([...new Set(hits.map((h) => h.doc_id))], [MAT_7]);
  });

  test('si falta la asignatura se usa el nombre del curso', async () => {
    const rag = await courseWith([[MAT_7, OBJ], [HIST_7, OBJ]], { nivel: '7B', asignatura: null, nombre: 'Historia 7° Básico A' });
    const { hits } = await rag.retrieve({ ...A, query: 'OA 5 resolver problemas con fracciones y números decimales', curricular: true });
    assert.deepEqual([...new Set(hits.map((h) => h.doc_id))], [HIST_7]);
  });

  test('las Bases de la asignatura pasan antes que las introducciones generales, aunque éstas se parezcan más', async () => {
    const store = {
      listTitles: async () => [MAT_7, GENERAL_7],
      courseInfo: async () => ({ nivel: '7B', asignatura: 'Matemática' }),
      search: async ({ docIds }) => (docIds[0] === GENERAL_7
        ? [{ doc_id: GENERAL_7, chunk_index: 0, text: 'Objetivos de aprendizaje de la educación media', score: 0.6 }]
        : [{ doc_id: MAT_7, chunk_index: 0, text: 'Objetivos de aprendizaje de matemática: fracciones', score: 0.5 }]),
    };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.4 });
    const { hits } = await rag.retrieve({ ...A, query: 'objetivos de aprendizaje de matemática', curricular: true });
    assert.equal(hits[0].doc_id, MAT_7);
  });

  test('con cupos de sobra, las generales completan; no desplazan a la asignatura', async () => {
    const mat = Array.from({ length: 4 }, (_, i) => ({ doc_id: MAT_7, chunk_index: i, text: `Objetivos de aprendizaje de matemática ${i}`, score: 0.5 }));
    const gen = Array.from({ length: 4 }, (_, i) => ({ doc_id: GENERAL_7, chunk_index: i, text: `Objetivos de aprendizaje generales ${i}`, score: 0.6 }));
    const store = {
      listTitles: async () => [MAT_7, GENERAL_7],
      courseInfo: async () => ({ nivel: '7B', asignatura: 'Matemática' }),
      search: async ({ docIds }) => (docIds[0] === GENERAL_7 ? gen : mat),
    };
    const rag = createRagService({ embedder: fakeEmbedder(), store, minScore: 0.4, topK: 4 });
    const { hits } = await rag.retrieve({ ...A, query: 'objetivos de aprendizaje de matemática', curricular: true });
    assert.equal(hits.length, 4);
    assert.equal(hits.filter((h) => h.doc_id === MAT_7).length, 4);
  });
});
