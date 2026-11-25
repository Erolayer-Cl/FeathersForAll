// Entrada del worker: recibe UN trabajo, lo ejecuta y responde. Después el offloader lo termina (un worker por trabajo:
// pdf.js acumula memoria y así cada PDF empieza limpio, sin que uno grande deje al proceso inflado).
import { parentPort } from 'node:worker_threads';
import { JOBS } from './jobs.js';

parentPort.once('message', async ({ job, payload }) => {
  try {
    const run = JOBS[job];
    if (!run) throw new Error(`Trabajo desconocido: ${job}`);
    parentPort.postMessage({ ok: true, result: await run(payload) });
  } catch (err) {
    // Los errores no viajan como instancias: se manda el nombre y el mensaje, y el offloader los reconstruye.
    parentPort.postMessage({ ok: false, error: { name: err?.name ?? 'Error', message: err?.message ?? String(err) } });
  }
});
