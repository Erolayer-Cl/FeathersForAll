// Métricas al estilo RAGAS sobre el golden set (tutor-examen.json).
//
// RAGAS (https://docs.ragas.io) mide un RAG en dos mitades: la búsqueda (¿trajo el contexto correcto?) y la
// generación (¿la respuesta se apoya en ese contexto?). Aquí se calculan versiones sin dependencias ni LLM juez,
// para que corran en CI y den el mismo número cada vez:
//
//   Búsqueda (modo determinista y live), solo en los casos que dicen de qué apunte debe salir la respuesta:
//     - acierto@k            ¿el apunte esperado está entre los fragmentos que se le pasan al modelo?
//     - MRR                  1 / posición del apunte esperado (1 = primero); 0 si no está
//     - precisión de contexto de los fragmentos entregados, qué parte viene del apunte esperado
//   Generación (solo live, porque necesita una respuesta real):
//     - fidelidad            parte de las oraciones de la respuesta cuyas palabras de contenido están en el contexto
//                            (los apuntes o las nociones que vio el modelo). Aproxima la "faithfulness" de RAGAS sin
//                            usar otro LLM como juez: detecta datos agregados, no paráfrasis con palabras nuevas.
//
// Es una aproximación: no reemplaza a RAGAS con LLM juez, pero cambia cuando la búsqueda o el modelo empeoran.

const STOP = new Set(('para pero como cuando donde desde hasta sobre entre este esta estos estas eso esos esas ese aquel '
  + 'porque tambien tiene tienen puede pueden hace hacen cada todo todos toda todas otra otro otros otras muy mas '
  + 'menos algo nada siempre nunca solo sola solos ademas luego entonces asi tanto cual cuales quien quienes que '
  + 'una uno unos unas los las del con sin por ser son esta estan fue era han hay les nos sus tus mis tu yo '
  + 'ejemplo idea general apuntes docente curso pregunta respuesta puedes quieres sabes ayudo podemos').split(' '));

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const palabras = (s) => (norm(s).match(/[\p{L}\d]+/gu) ?? []).filter((w) => w.length >= 4 && !STOP.has(w));

/** Métricas de búsqueda de un caso. fuentes = doc_id de los fragmentos entregados, en orden. */
export function metricasBusqueda(esperada, fuentes) {
  const pos = fuentes.indexOf(esperada);
  return {
    acierto: pos !== -1 ? 1 : 0,
    rr: pos === -1 ? 0 : 1 / (pos + 1),
    precision: fuentes.length ? fuentes.filter((f) => f === esperada).length / fuentes.length : 0,
  };
}

/**
 * Fidelidad de una respuesta a su contexto (0–1), o null si no hay nada que medir.
 * Se ignoran las preguntas (el tutor termina con una pregunta para el estudiante) y las oraciones sin contenido.
 * Una oración cuenta como apoyada si al menos `umbral` de sus palabras de contenido aparece en el contexto.
 */
export function fidelidad(respuesta, contexto, { umbral = 0.6 } = {}) {
  const vocab = new Set(palabras(contexto));
  // Raíces de 5 letras: "simplificar" en el apunte apoya "simplificamos" en la respuesta.
  const raices = new Set([...vocab].map((w) => w.slice(0, 5)));
  const oraciones = respuesta.replace(/\[\d+(?:,\s*\d+)*\]/g, '').split(/(?<=[.!])\s+|\n+/).map((o) => o.trim()).filter((o) => o && !o.includes('?'));
  let medidas = 0;
  let apoyadas = 0;
  for (const o of oraciones) {
    const ws = palabras(o);
    if (ws.length < 2) continue;
    medidas++;
    const dentro = ws.filter((w) => vocab.has(w) || raices.has(w.slice(0, 5))).length;
    if (dentro / ws.length >= umbral) apoyadas++;
  }
  return medidas ? apoyadas / medidas : null;
}

/** Promedios de todos los casos. Devuelve null en una métrica si ningún caso la tuvo. */
export function agregarMetricas(resultados) {
  const prom = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);
  const b = resultados.map((r) => r.busqueda).filter(Boolean);
  const f = resultados.map((r) => r.fidelidad).filter((x) => typeof x === 'number');
  return {
    casosBusqueda: b.length,
    aciertoK: prom(b.map((x) => x.acierto)),
    mrr: prom(b.map((x) => x.rr)),
    precisionContexto: prom(b.map((x) => x.precision)),
    casosFidelidad: f.length,
    fidelidad: prom(f),
  };
}
