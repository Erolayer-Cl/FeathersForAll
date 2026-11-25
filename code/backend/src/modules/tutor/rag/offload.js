// Corre trabajos pesados (leer un PDF, trocear sus páginas) en worker threads, para no frenar al resto de la API (D-1).
//
// Antes, un PDF grande se leía en el hilo principal: mientras tanto NINGUNA otra solicitud avanzaba (login, tutor, notas…).
// Ahora el hilo principal solo entrega el archivo y espera; el trabajo corre en otro hilo con estos topes:
//   - maxWorkers : trabajos simultáneos (más allá, esperan en cola). Cada uno usa CPU y memoria propias.
//   - maxQueue   : cuántos pueden esperar. Si la cola está llena responde ProcessingBusyError (503) en vez de acumular archivos.
//   - timeoutMs  : tiempo máximo por trabajo; pasado ese tiempo el worker se termina (un PDF patológico no cuelga nada).
//   - maxMemoryMb: tope de memoria del worker; si lo pasa muere SOLO el worker, no la API.
// Con maxWorkers = 0 no se usan workers (todo en el hilo principal, como antes): sirve para depurar o si el entorno no los permite.
import { Worker } from 'node:worker_threads';
import { intFromEnv } from '../../../platform/env.js';
import { ProcessingBusyError, UnreadableDocumentError } from './errors.js';

const WORKER_URL = new URL('./offload-worker.js', import.meta.url);

/** Reconstruye el error que murió dentro del worker (no cruzan instancias, solo nombre y mensaje). */
function rebuildError({ name, message }) {
  if (name === 'UnreadableDocumentError') return new UnreadableDocumentError(message);
  if (name === 'RangeError') return new RangeError(message);
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxWorkers]
 * @param {number} [opts.maxQueue]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxMemoryMb]
 * @param {URL} [opts.workerUrl]  solo para pruebas
 */
export function createOffloader({ maxWorkers = 2, maxQueue = 20, timeoutMs = 120_000, maxMemoryMb = 1024, workerUrl = WORKER_URL } = {}) {
  let running = 0;
  /** @type {{job: string, payload: unknown, transfer: ArrayBuffer[], resolve: Function, reject: Function}[]} */
  const queue = [];

  function runInWorker({ job, payload, transfer, resolve, reject }) {
    return new Promise((done) => {
      let worker;
      let timer;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker?.terminate().catch(() => {});
        fn(value);
        done();
      };
      try {
        worker = new Worker(workerUrl, { resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb } });
        timer = setTimeout(() => {
          finish(reject, new UnreadableDocumentError(`El archivo tardó más de ${Math.round(timeoutMs / 1000)} s en procesarse y se canceló. Prueba con uno más pequeño o divídelo.`));
        }, timeoutMs);
        timer.unref?.();

        worker.once('message', (msg) => (msg.ok ? finish(resolve, msg.result) : finish(reject, rebuildError(msg.error))));
        worker.once('error', (err) => {
          const outOfMemory = err?.code === 'ERR_WORKER_OUT_OF_MEMORY';
          finish(reject, outOfMemory
            ? new UnreadableDocumentError('El archivo es demasiado grande o complejo para procesarlo. Prueba con uno más pequeño o divídelo.')
            : err);
        });
        // Un worker que sale sin haber respondido (p. ej. lo mataron) no debe dejar la promesa colgada.
        worker.once('exit', (code) => finish(reject, new Error(`El worker terminó sin responder (código ${code})`)));
        worker.postMessage({ job, payload }, transfer);
      } catch (err) {
        // No se pudo ni crear el worker ni mandarle el trabajo: se rechaza este trabajo (si no, quedaría colgado).
        finish(reject, err);
      }
    });
  }

  function pump() {
    while (running < maxWorkers && queue.length > 0) {
      const item = queue.shift();
      running += 1;
      runInWorker(item).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  return {
    maxWorkers,

    /**
     * @param {string} job  nombre en jobs.js
     * @param {unknown} payload
     * @param {ArrayBuffer[]} [transfer]  buffers que se ceden al worker (no se copian; quedan inutilizables aquí)
     */
    async run(job, payload, transfer = []) {
      if (maxWorkers === 0) {
        const { JOBS } = await import('./jobs.js');
        if (!JOBS[job]) throw new Error(`Trabajo desconocido: ${job}`);
        return JOBS[job](payload);
      }
      return new Promise((resolve, reject) => {
        // Cola llena: se rechaza de inmediato (los que ya corren no cuentan en la cola).
        if (running >= maxWorkers && queue.length >= maxQueue) {
          reject(new ProcessingBusyError());
          return;
        }
        queue.push({ job, payload, transfer, resolve, reject });
        pump();
      });
    },

    /** Para observabilidad y pruebas. */
    stats: () => ({ running, queued: queue.length, maxWorkers, maxQueue }),
  };
}

/** Configuración desde el entorno: PDF_WORKERS (2; 0 = sin workers), PDF_QUEUE (20), PDF_TIMEOUT_MS (120000), PDF_WORKER_MEMORY_MB (1024). */
export function offloaderFromEnv(env = process.env) {
  return createOffloader({
    maxWorkers: intFromEnv(env, 'PDF_WORKERS', 2),
    maxQueue: intFromEnv(env, 'PDF_QUEUE', 20),
    timeoutMs: intFromEnv(env, 'PDF_TIMEOUT_MS', 120_000),
    maxMemoryMb: intFromEnv(env, 'PDF_WORKER_MEMORY_MB', 1024),
  });
}

let shared;
/** El offloader del proceso (se crea la primera vez que se usa, así una variable mal escrita falla al usarlo y no al importar). */
export function sharedOffloader() {
  shared ??= offloaderFromEnv();
  return shared;
}
