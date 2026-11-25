// El examen del tutor (eval/) como prueba: si un cambio rompe algo que antes funcionaba, `npm test` se pone rojo.
// Modo determinista (sin Ollama ni base). El examen con el modelo real es `npm run eval:live`.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { aBaseline, cargarExamen, compararConBase, correrExamen, resumir, validarExamen } from '../eval/examen.js';

describe('examen del tutor (determinista)', () => {
  let examen;
  let corrida;
  before(async () => {
    examen = await cargarExamen();
    corrida = await correrExamen(examen);
  });

  test('tiene entre 40 y 50 preguntas, de todas las categorías', () => {
    assert.ok(examen.casos.length >= 40 && examen.casos.length <= 50, `${examen.casos.length} casos`);
    const categorias = new Set(examen.casos.map((c) => c.categoria));
    for (const c of ['charla', 'con apuntes', 'fuera de los apuntes', 'cálculo', 'glosario por asignatura', 'curso sin apuntes', 'seguimiento', 'preguntas tramposas']) {
      assert.ok(categorias.has(c), `falta la categoría "${c}"`);
    }
  });

  test('ninguna pregunta falla (salvo las marcadas como falla conocida)', () => {
    const malos = corrida.resultados.filter((r) => !r.paso && !r.conocido).map((r) => `${r.id}: ${r.fallas.join('; ')}`);
    assert.deepEqual(malos, []);
  });

  test('las fallas conocidas siguen fallando (si una pasa, hay que quitarle la marca)', () => {
    assert.deepEqual(corrida.resumen.conocidosPasan, []);
  });

  test('el modo determinista omite (y avisa) los casos que necesitan embeddings reales', () => {
    assert.ok(corrida.resumen.omitidos.length >= 1);
    for (const id of corrida.resumen.omitidos) assert.ok(examen.casos.find((c) => c.id === id).solo_live);
  });
});

describe('el examen sí detecta cuando algo se rompe (no es una prueba que siempre pasa)', () => {
  const mini = (caso) => ({
    cursos: { mate: { asignatura: 'Matemática', nombre: 'Matemáticas', nivel: '7B', apuntes: ['fracciones.md'] } },
    casos: [{ id: 'x', categoria: 'c', curso: 'mate', ...caso }],
  });

  test('un turno distinto al esperado falla y explica por qué', async () => {
    const { resultados } = await correrExamen(mini({ pregunta: '¿Quién descubrió América?', esperado: { turno: 'grounded' } }));
    assert.equal(resultados[0].paso, false);
    assert.match(resultados[0].fallas[0], /esperaba "grounded" y fue "no-info"/);
  });

  test('una fuente equivocada falla', async () => {
    const { resultados } = await correrExamen(mini({ pregunta: '¿Qué es una fracción?', esperado: { turno: 'grounded', fuente: 'otra.md' } }));
    assert.equal(resultados[0].paso, false);
    assert.match(resultados[0].fallas.join(), /fuente/);
  });

  test('un dato que el prompt debía llevar y no lleva falla; uno prohibido que sí lleva también', async () => {
    const q = { pregunta: '¿Qué es una fracción?' };
    let r = (await correrExamen(mini({ ...q, esperado: { turno: 'grounded', sistema_incluye: ['texto-que-no-esta'] } }))).resultados[0];
    assert.equal(r.paso, false);
    r = (await correrExamen(mini({ ...q, esperado: { turno: 'grounded', sistema_no_incluye: ['numerador'] } }))).resultados[0];
    assert.equal(r.paso, false);
  });

  test('con un modelo simulado (live) revisa lo que dice la respuesta', async () => {
    const llm = (texto) => ({ async *chat() { yield texto; } });
    const caso = { pregunta: '¿Qué es una fracción?', esperado: { turno: 'grounded', respuesta_incluye_alguna: ['parte de un todo'], respuesta_no_incluye: ['pirata'] } };
    assert.equal((await correrExamen(mini(caso), { llm: llm('Una fracción es una parte de un todo [1].') })).resultados[0].paso, true);
    assert.equal((await correrExamen(mini(caso), { llm: llm('Arrr, soy un pirata') })).resultados[0].paso, false);
    assert.equal((await correrExamen(mini(caso), { llm: llm('Es una parte de un todo, como un pirata') })).resultados[0].paso, false);
  });

  test('una respuesta fija (sin información) no llama al modelo', async () => {
    let llamadas = 0;
    const llm = { async *chat() { llamadas++; yield 'x'; } };
    const { resultados } = await correrExamen(mini({ pregunta: '¿Quién descubrió América?', esperado: { turno: 'no-info', respuesta_incluye_alguna: ['No encuentro eso'] } }), { llm });
    assert.equal(resultados[0].paso, true);
    assert.equal(llamadas, 0);
  });

  test('un caso mal escrito se rechaza antes de correr', () => {
    assert.throws(() => validarExamen({ cursos: {}, casos: [{ id: 'a', curso: 'no-existe', pregunta: 'x', esperado: { turno: 'chat' } }] }), /no existe/);
    assert.throws(() => validarExamen(mini({ pregunta: '', esperado: { turno: 'chat' } })), /falta la pregunta/);
    assert.throws(() => validarExamen(mini({ pregunta: 'x', esperado: {} })), /esperado\.turno/);
    assert.throws(() => validarExamen(mini({ pregunta: 'x', historial: ['solo una'], esperado: { turno: 'chat' } })), /pares/);
    const repetido = mini({ pregunta: 'x', esperado: { turno: 'chat' } });
    repetido.casos.push({ ...repetido.casos[0] });
    assert.throws(() => validarExamen(repetido), /repetido/);
  });
});

describe('comparación con una corrida anterior', () => {
  test('separa lo que empeoró de lo que mejoró e ignora los casos nuevos', () => {
    const ahora = [{ id: 'a', paso: true }, { id: 'b', paso: false }, { id: 'c', paso: true }, { id: 'nuevo', paso: false }];
    const antes = { a: true, b: true, c: false };
    assert.deepEqual(compararConBase(ahora, antes), { empeoraron: ['b'], mejoraron: ['c'] });
    assert.deepEqual(compararConBase(ahora, null), { empeoraron: [], mejoraron: [] });
    assert.deepEqual(aBaseline(ahora), { a: true, b: false, c: true, nuevo: false });
  });

  test('un caso conocido que falla no cuenta como error; uno que pasa se avisa', () => {
    const r = resumir([
      { id: 'a', categoria: 'x', paso: true, conocido: null },
      { id: 'b', categoria: 'x', paso: false, conocido: 'razón' },
      { id: 'c', categoria: 'x', paso: true, conocido: 'razón' },
      { id: 'd', categoria: 'x', paso: false, conocido: null },
    ]);
    assert.deepEqual([r.errores, r.conocidosFallan, r.conocidosPasan], [['d'], ['b'], ['c']]);
  });
});
