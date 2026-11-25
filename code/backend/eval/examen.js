// Examen del tutor: corre una lista de preguntas con el comportamiento esperado y dice cuántas pasan.
//
// Dos modos:
//   - determinista (por defecto): sin Ollama ni base. Usa embeddings falsos (bolsa de palabras) y mide lo que el CÓDIGO decide:
//     qué tipo de turno es (charla, con apuntes, básico, sin información, sin apuntes), de qué apunte sale la respuesta, y qué
//     reglas y datos verificados lleva el prompt. Es rápido (< 1 s), estable, y sirve para detectar si un cambio rompió algo.
//   - --live: con el modelo real (Ollama): además genera la respuesta y revisa que mencione lo esperado. Es lento, depende del
//     modelo y sus resultados varían un poco entre corridas: sirve para comparar versiones de prompts o de modelo.
//
// Un caso es: { id, categoria, curso, pregunta, historial?, esperado: { turno, fuente?, sistema_incluye?,
// sistema_no_incluye?, respuesta_incluye_alguna?, respuesta_no_incluye? }, conocido?, solo_live? }.
//   - `conocido` = falla conocida (se explica por qué): no cuenta como error, pero si un día pasa, el informe lo avisa.
//   - `solo_live` = el caso depende de embeddings reales (paráfrasis, relleno que baja la similitud): el embedder falso solo
//     compara palabras exactas y no lo puede juzgar, así que en el modo determinista se OMITE (y se informa que se omitió).
import { readFile } from 'node:fs/promises';
import { SYSTEM_PROMPTS } from '../src/modules/tutor/system-prompt.js';
import { prepareTurn } from '../src/modules/tutor/rag/rag-prompt.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { createVectorStore } from '../src/modules/tutor/rag/vector-store.js';
import { fakeEmbedder } from '../test/fake-embedder.js';

const TENANT = 'examen';
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const mentions = (text, needle) => fold(text).includes(fold(needle));

/** Lee el examen y valida su forma (un examen mal escrito no debe "pasar" en silencio). */
export function validarExamen(examen) {
  const errores = [];
  const ids = new Set();
  for (const c of examen.casos) {
    if (ids.has(c.id)) errores.push(`id repetido: ${c.id}`);
    ids.add(c.id);
    if (!examen.cursos[c.curso]) errores.push(`${c.id}: el curso "${c.curso}" no existe`);
    if (typeof c.pregunta !== 'string' || !c.pregunta.trim()) errores.push(`${c.id}: falta la pregunta`);
    if (!c.esperado?.turno) errores.push(`${c.id}: falta esperado.turno`);
    if (c.historial && c.historial.length % 2 !== 0) errores.push(`${c.id}: el historial debe tener pares pregunta/respuesta`);
  }
  if (errores.length) throw new Error(`El examen tiene errores:\n- ${errores.join('\n- ')}`);
}

export async function cargarExamen(url = new URL('./tutor-examen.json', import.meta.url)) {
  const examen = JSON.parse(await readFile(url, 'utf8'));
  validarExamen(examen);
  return examen;
}

/** Un RAG por curso con sus apuntes cargados. */
async function armarCursos(examen, { embedder, ragOptions, dirApuntes }) {
  const cursos = new Map();
  for (const [id, curso] of Object.entries(examen.cursos)) {
    const store = createVectorStore();
    const rag = createRagService({
      embedder,
      store: { ...store, courseInfo: async () => ({ asignatura: curso.asignatura, nombre: curso.nombre, nivel: curso.nivel }) },
      ...ragOptions,
    });
    for (const archivo of curso.apuntes) {
      const text = await readFile(new URL(archivo, dirApuntes), 'utf8');
      await rag.ingest({ tenantId: TENANT, courseId: id, docId: archivo, text });
    }
    cursos.set(id, rag);
  }
  return cursos;
}

/** Mensajes de un caso: el historial (pregunta, respuesta, pregunta, respuesta…) y la pregunta nueva. */
function mensajesDe(caso) {
  const historial = (caso.historial ?? []).map((content, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content }));
  return [...historial, { role: 'user', content: caso.pregunta }];
}

/** Junta la respuesta del modelo (o devuelve la respuesta fija del turno). */
async function responder(turn, mensajes, llm) {
  if (turn.reply) return turn.reply;
  const system = turn.kind === 'plain' ? SYSTEM_PROMPTS.tutor : turn.system;
  const history = turn.kind === 'plain' ? mensajes : turn.messages;
  const prompt = [{ role: 'system', content: system }, ...history.map(({ role, content }) => ({ role, content }))];
  let text = '';
  for await (const chunk of llm.chat(prompt, { ...(turn.temperature !== undefined && { temperature: turn.temperature }) })) text += chunk;
  return text;
}

/** Revisa un caso. Devuelve la lista de lo que falló (vacía = pasó). */
function revisar(caso, turn, respuesta) {
  const e = caso.esperado;
  const fallas = [];
  if (turn.kind !== e.turno) fallas.push(`turno: esperaba "${e.turno}" y fue "${turn.kind}"`);
  if (e.fuente) {
    const fuentes = (turn.sources ?? []).map((s) => s.doc_id);
    if (!fuentes.includes(e.fuente)) fallas.push(`fuente: esperaba "${e.fuente}" y fue [${fuentes.join(', ') || 'ninguna'}]`);
  }
  const system = turn.system ?? '';
  for (const t of e.sistema_incluye ?? []) if (!mentions(system, t)) fallas.push(`el prompt debía incluir "${t}"`);
  for (const t of e.sistema_no_incluye ?? []) if (mentions(system, t)) fallas.push(`el prompt NO debía incluir "${t}"`);
  if (respuesta !== null) {
    const alguna = e.respuesta_incluye_alguna;
    if (alguna?.length && !alguna.some((t) => mentions(respuesta, t))) fallas.push(`la respuesta debía mencionar alguna de: ${alguna.join(' | ')}`);
    for (const t of e.respuesta_no_incluye ?? []) if (mentions(respuesta, t)) fallas.push(`la respuesta NO debía mencionar "${t}"`);
  }
  return fallas;
}

/**
 * @param {object} examen  ver cargarExamen
 * @param {object} [opts]
 * @param {{chat: Function}} [opts.llm]  si viene, el examen es "live": se genera y revisa la respuesta
 * @param {{embed: Function}} [opts.embedder]  por defecto el falso (determinista)
 * @param {object} [opts.ragOptions]  minScore, topK… del servicio RAG
 * @param {string[]} [opts.categorias]  correr solo esas categorías
 */
export async function correrExamen(examen, { llm, embedder = fakeEmbedder(), ragOptions = { minScore: 0.2 }, categorias, dirApuntes = new URL('./apuntes/', import.meta.url) } = {}) {
  const cursos = await armarCursos(examen, { embedder, ragOptions, dirApuntes });
  const resultados = [];
  for (const caso of examen.casos) {
    if (categorias?.length && !categorias.includes(caso.categoria)) continue;
    if (caso.solo_live && !llm) {
      resultados.push({ id: caso.id, categoria: caso.categoria, pregunta: caso.pregunta, turno: null, paso: null, omitido: caso.solo_live, fallas: [], conocido: null });
      continue;
    }
    const mensajes = mensajesDe(caso);
    let turn;
    let respuesta = null;
    let fallas;
    try {
      turn = await prepareTurn({ rag: cursos.get(caso.curso), tenantId: TENANT, courseId: caso.curso, messages: mensajes, systemPrompt: SYSTEM_PROMPTS.tutor });
      if (llm) respuesta = await responder(turn, mensajes, llm);
      fallas = revisar(caso, turn, respuesta);
    } catch (err) {
      fallas = [`error al correr el caso: ${err.message}`];
    }
    const paso = fallas.length === 0;
    resultados.push({
      id: caso.id,
      categoria: caso.categoria,
      pregunta: caso.pregunta,
      turno: turn?.kind ?? null,
      paso,
      fallas,
      conocido: caso.conocido ?? null,
      ...(respuesta !== null && { respuesta }),
    });
  }
  return { modo: llm ? 'live' : 'determinista', resultados: resultados.filter((r) => !r.omitido), resumen: resumir(resultados) };
}

/** Totales y por categoría. Una falla conocida no cuenta como error; un conocido que pasa se avisa. */
export function resumir(resultados) {
  const porCategoria = {};
  let pasan = 0;
  const omitidos = resultados.filter((r) => r.omitido).map((r) => r.id);
  resultados = resultados.filter((r) => !r.omitido);
  const errores = [];
  const conocidosFallan = [];
  const conocidosPasan = [];
  for (const r of resultados) {
    const cat = (porCategoria[r.categoria] ??= { total: 0, pasan: 0 });
    cat.total += 1;
    if (r.paso) { cat.pasan += 1; pasan += 1; }
    if (r.conocido) (r.paso ? conocidosPasan : conocidosFallan).push(r.id);
    else if (!r.paso) errores.push(r.id);
  }
  return { total: resultados.length, pasan, omitidos, errores, conocidosFallan, conocidosPasan, porCategoria };
}

/**
 * Compara contra una corrida anterior (`baseline`: { id: boolean }). `empeoraron` = pasaban y ya no (lo que hay que mirar);
 * `mejoraron` = fallaban y ahora pasan.
 */
export function compararConBase(resultados, baseline) {
  const empeoraron = [];
  const mejoraron = [];
  for (const r of resultados) {
    const antes = baseline?.[r.id];
    if (antes === undefined) continue;
    if (antes && !r.paso) empeoraron.push(r.id);
    if (!antes && r.paso) mejoraron.push(r.id);
  }
  return { empeoraron, mejoraron };
}

export const aBaseline = (resultados) => Object.fromEntries(resultados.map((r) => [r.id, r.paso]));
