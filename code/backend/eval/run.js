// Corre el examen del tutor y muestra cómo le fue.
//
//   npm run eval                       examen determinista (sin Ollama ni base)
//   npm run eval -- --guardar          además guarda el resultado como punto de comparación (eval/baseline.json)
//   npm run eval -- --solo="cálculo"   solo una categoría (se puede repetir)
//   npm run eval:live                  con el modelo real: genera las respuestas y revisa que mencionen lo esperado
//   npm run eval -- --json             el resultado completo en JSON (para otros programas)
//
// Código de salida: 1 si algún caso (que no sea una falla conocida) no pasa o si algo que pasaba en el punto de comparación
// dejó de pasar; 0 si no.
import { readFile, writeFile } from 'node:fs/promises';
import { aBaseline, cargarExamen, compararConBase, correrExamen } from './examen.js';
import { createOllamaClient } from '../src/modules/tutor/llm-client.js';
import { createOllamaEmbedder } from '../src/modules/tutor/embeddings-client.js';
import { ragConfigFromEnv } from '../src/modules/tutor/rag/create-rag.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const valores = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

const live = flag('live');
const BASELINE_URL = new URL(live ? './baseline-live.json' : './baseline.json', import.meta.url);

let llm;
let embedder;
let ragOptions;
if (live) {
  const cfg = ragConfigFromEnv();
  const env = process.env;
  llm = createOllamaClient({
    endpoint: env.LLM_ENDPOINT ?? 'http://localhost:11434',
    model: env.LLM_MODEL ?? 'qwen2.5:3b',
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 120000),
    temperature: Number(env.LLM_TEMPERATURE ?? 0.6),
    numCtx: env.LLM_NUM_CTX ? Number(env.LLM_NUM_CTX) : 4096,
    keepAlive: env.LLM_KEEP_ALIVE ?? '30m',
  });
  embedder = createOllamaEmbedder({ endpoint: cfg.endpoint, model: cfg.embeddingModel, timeoutMs: cfg.timeoutMs, keepAlive: cfg.keepAlive });
  // Los mismos umbrales del servidor: el examen "live" también mide la búsqueda con embeddings reales.
  ragOptions = { topK: cfg.topK, minScore: cfg.minScore, ...(cfg.strongScore !== undefined && { strongScore: cfg.strongScore }), referenceMode: cfg.referenceMode, chunk: { maxChars: cfg.chunkChars, overlapChars: Math.round(cfg.chunkChars * 0.15) } };
}

const examen = await cargarExamen();
const { modo, resultados, resumen } = await correrExamen(examen, { llm, embedder, ragOptions, categorias: valores('solo') });

let baseline = null;
try {
  baseline = JSON.parse(await readFile(BASELINE_URL, 'utf8')).casos;
} catch {
  // sin punto de comparación todavía
}
const { empeoraron, mejoraron } = compararConBase(resultados, baseline);

if (flag('json')) {
  console.log(JSON.stringify({ modo, resumen, empeoraron, mejoraron, resultados }, null, 2));
} else {
  const pct = (a, b) => (b === 0 ? '—' : `${Math.round((a / b) * 100)} %`);
  console.log(`\nExamen del tutor · modo ${modo} · ${resumen.pasan}/${resumen.total} (${pct(resumen.pasan, resumen.total)})\n`);
  const ancho = Math.max(...Object.keys(resumen.porCategoria).map((c) => c.length));
  for (const [cat, { total, pasan }] of Object.entries(resumen.porCategoria)) {
    console.log(`  ${cat.padEnd(ancho)}  ${String(pasan).padStart(2)}/${String(total).padEnd(2)} ${pasan === total ? '✔' : '✖'}`);
  }
  const m = resumen.metricas;
  const n = (x) => (x === null ? '—' : x.toFixed(2));
  console.log(`\n  Métricas (estilo RAGAS, ver eval/metricas.js) · búsqueda en ${m.casosBusqueda} casos: acierto@k ${n(m.aciertoK)} · MRR ${n(m.mrr)} · precisión de contexto ${n(m.precisionContexto)}`);
  console.log(`  Fidelidad de la respuesta al contexto: ${m.casosFidelidad ? `${n(m.fidelidad)} en ${m.casosFidelidad} respuestas` : '— (solo con --live)'}`);
  if (resumen.omitidos.length) console.log(`\n  (${resumen.omitidos.length} casos solo se corren con --live: ${resumen.omitidos.join(', ')})`);
  const malos = resultados.filter((r) => !r.paso);
  if (malos.length) {
    console.log('\nNo pasan:');
    for (const r of malos) {
      console.log(`  ${r.conocido ? '○ (conocido)' : '✖'} ${r.id}  «${r.pregunta}»`);
      for (const f of r.fallas) console.log(`      - ${f}`);
      if (r.conocido) console.log(`      · ${r.conocido}`);
    }
  }
  if (resumen.conocidosPasan.length) console.log(`\nOjo: pasan casos marcados como falla conocida (${resumen.conocidosPasan.join(', ')}). Si es estable, quita la marca "conocido".`);
  if (baseline) {
    console.log(`\nContra el punto de comparación: ${empeoraron.length ? `EMPEORARON ${empeoraron.join(', ')}` : 'nada empeoró'}${mejoraron.length ? ` · mejoraron ${mejoraron.join(', ')}` : ''}`);
  } else {
    console.log('\nSin punto de comparación todavía: usa --guardar para guardar este resultado.');
  }
}

if (flag('guardar')) {
  await writeFile(BASELINE_URL, `${JSON.stringify({ modo, guardado: new Date().toISOString().slice(0, 10), metricas: resumen.metricas, casos: aBaseline(resultados) }, null, 2)}\n`);
  if (!flag('json')) console.log(`\nGuardado en eval/${live ? 'baseline-live.json' : 'baseline.json'}.`);
}

process.exitCode = resumen.errores.length || empeoraron.length ? 1 : 0;
