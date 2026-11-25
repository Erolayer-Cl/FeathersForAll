// El glosario de nociones básicas se limita a la asignatura del curso (basics.js + prepareTurn).
// Sin base ni Ollama: almacén en memoria con un `courseInfo` que dice de qué asignatura es el curso.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { courseSubjectKey, findBasics, GLOSSARY_SUBJECTS, matchConcepts } from '../src/modules/tutor/rag/basics.js';
import { createVectorStore } from '../src/modules/tutor/rag/vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { prepareTurn } from '../src/modules/tutor/rag/rag-prompt.js';
import { fakeEmbedder } from './fake-embedder.js';

const REF = { tenantId: 'colegio-a', courseId: 'curso-1' };

/** RAG de prueba. `info` = lo que el almacén dice del curso (undefined = no lo sabe, como el almacén en archivo). */
function makeRag(info) {
  const store = createVectorStore();
  const courseInfo = info === undefined ? {} : { courseInfo: async () => info };
  return createRagService({ embedder: fakeEmbedder(), store: { ...store, ...courseInfo }, minScore: 0.2 });
}
const ask = (rag, content) => prepareTurn({ rag, ...REF, messages: [{ role: 'user', content }], systemPrompt: 'BASE' });

describe('matchConcepts con asignatura', () => {
  test('sin asignatura se mira todo el glosario (comportamiento de siempre)', () => {
    assert.equal(matchConcepts('¿qué es un átomo?')[0].termino, 'átomo');
    assert.equal(matchConcepts('¿qué es un sustantivo?')[0].termino, 'sustantivo');
  });

  test('con asignatura solo se consideran las entradas de esa asignatura', () => {
    assert.equal(matchConcepts('¿qué es un átomo?', { subject: 'ciencias' })[0].termino, 'átomo');
    assert.equal(matchConcepts('¿qué es un átomo?', { subject: 'lengua' }), null);
    assert.equal(matchConcepts('¿qué es un sustantivo?', { subject: 'matematica' }), null);
    assert.equal(matchConcepts('¿qué es una fracción?', { subject: 'matematica' })[0].termino, 'fracción');
  });

  test('las claves del glosario son las mismas que usa el RAG para los cursos', () => {
    assert.deepEqual([...GLOSSARY_SUBJECTS].sort(), ['ciencias', 'historia', 'lengua', 'matematica']);
  });

  test('findBasics: el cálculo vale en cualquier asignatura; el concepto, solo en la suya', () => {
    assert.equal(findBasics({ lastUser: '2+2', query: '2+2', subject: 'lengua' }).calc.text, '2 + 2 = 4');
    assert.equal(findBasics({ lastUser: '¿qué es un átomo?', query: '¿qué es un átomo?', subject: 'lengua' }), null);
    assert.ok(findBasics({ lastUser: '¿qué es un átomo?', query: '¿qué es un átomo?', subject: 'ciencias' }).concepts);
  });
});

describe('courseSubjectKey', () => {
  test('usa la asignatura del curso y, si no se reconoce, su nombre', () => {
    assert.equal(courseSubjectKey({ asignatura: 'Lenguaje', nombre: 'Lenguaje 7° A' }), 'lengua');
    assert.equal(courseSubjectKey({ asignatura: 'Matemática' }), 'matematica');
    assert.equal(courseSubjectKey({ asignatura: null, nombre: 'Matemáticas 7° Básico A' }), 'matematica');
    assert.equal(courseSubjectKey({ asignatura: 'Taller', nombre: 'Biología 8° B' }), 'ciencias');
  });

  test('si no se reconoce nada (o no hay datos) devuelve null', () => {
    assert.equal(courseSubjectKey({ asignatura: 'Taller de Robótica', nombre: 'Taller 7°' }), null);
    assert.equal(courseSubjectKey(null), null);
    assert.equal(courseSubjectKey(undefined), null);
    assert.equal(courseSubjectKey({}), null);
  });
});

describe('prepareTurn según la asignatura del curso (curso sin apuntes)', () => {
  test('en un curso de Lenguaje, "¿qué es un átomo?" ya no se explica: avisa que no hay apuntes', async () => {
    assert.equal((await ask(makeRag({ asignatura: 'Lenguaje', nombre: 'Lenguaje 7° A' }), '¿qué es un átomo?')).kind, 'no-notes');
  });

  test('en un curso de Ciencias sí se explica, con el glosario', async () => {
    const turn = await ask(makeRag({ asignatura: 'Ciencias Naturales', nombre: 'Ciencias 7° A' }), '¿qué es un átomo?');
    assert.equal(turn.kind, 'basic');
    assert.match(turn.system, /Ciencias · átomo/);
  });

  test('en un curso de Lenguaje sí se explica un sustantivo, y el prompt no trae nociones de otras materias', async () => {
    const turn = await ask(makeRag({ asignatura: 'Lenguaje', nombre: 'Lenguaje 7° A' }), '¿qué es un sustantivo?');
    assert.equal(turn.kind, 'basic');
    assert.match(turn.system, /Lenguaje · sustantivo/);
    assert.doesNotMatch(turn.system, /Matemática ·|Ciencias ·|Historia y Geografía ·/);
  });

  test('un cálculo se responde en cualquier curso, también en Lenguaje', async () => {
    const turn = await ask(makeRag({ asignatura: 'Lenguaje', nombre: 'Lenguaje 7° A' }), '¿cuánto es 3+4?');
    assert.equal(turn.kind, 'basic');
    assert.match(turn.system, /3 \+ 4 = 7/);
  });

  test('asignatura sin glosario (Inglés): no se inventa un concepto de otra materia', async () => {
    assert.equal((await ask(makeRag({ asignatura: 'Inglés', nombre: 'Inglés 7° A' }), '¿qué es una fracción?')).kind, 'no-notes');
  });
});

describe('prepareTurn cuando no se sabe la asignatura: no se filtra (como antes)', () => {
  test('curso de nombre no reconocido', async () => {
    assert.equal((await ask(makeRag({ asignatura: null, nombre: 'Taller de Robótica' }), '¿qué es un átomo?')).kind, 'basic');
  });
  test('almacén que no conoce los cursos (archivo, solo desarrollo)', async () => {
    assert.equal((await ask(makeRag(undefined), '¿qué es un átomo?')).kind, 'basic');
  });
  test('courseInfo devuelve null', async () => {
    assert.equal((await ask(makeRag(null), '¿qué es una fracción?')).kind, 'basic');
  });
});

describe('prepareTurn con apuntes: los apuntes del docente siguen mandando', () => {
  test('si los apuntes de un curso de Lenguaje hablan de átomos, se responde con ellos (grounded)', async () => {
    const rag = makeRag({ asignatura: 'Lenguaje', nombre: 'Lenguaje 7° A' });
    await rag.ingest({ ...REF, docId: 'lectura.md', text: '# Lectura\n\nEl átomo es la unidad más pequeña de un elemento. Esta lectura habla de los átomos y su estructura.' });
    assert.equal((await ask(rag, '¿qué es un átomo?')).kind, 'grounded');
  });

  test('con apuntes que no lo cubren, un curso de Lenguaje no cae al glosario de Ciencias', async () => {
    const rag = makeRag({ asignatura: 'Lenguaje', nombre: 'Lenguaje 7° A' });
    await rag.ingest({ ...REF, docId: 'poemas.md', text: '# Poemas\n\nUn poema se compone de versos y estrofas. La metáfora compara cosas sin usar la palabra como.' });
    assert.equal((await ask(rag, '¿qué es un átomo?')).kind, 'no-info');
  });
});
