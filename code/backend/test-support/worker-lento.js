// Worker de prueba: nunca responde (simula un PDF que se cuelga) o consume memoria sin parar.
import { parentPort } from 'node:worker_threads';
parentPort.once('message', ({ job }) => {
  if (job === 'colgar') setInterval(() => {}, 1000);
  else if (job === 'memoria') { const a = []; for (;;) a.push(new Array(1e6).fill('x')); }
  else if (job === 'error') parentPort.postMessage({ ok: false, error: { name: 'UnreadableDocumentError', message: 'roto' } });
  else parentPort.postMessage({ ok: true, result: job });
});
