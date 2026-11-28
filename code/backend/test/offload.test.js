// Pool de workers para PDF (offload.js): el hilo principal sigue libre, y los límites (tiempo, cola, memoria) funcionan.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createOffloader } from '../src/modules/tutor/rag/offload.js';
import { extractPdfPages } from '../src/modules/tutor/rag/pdf-text.js';
import { ProcessingBusyError, UnreadableDocumentError } from '../src/modules/tutor/rag/errors.js';
import { toRagProblem } from '../src/modules/tutor/rag/rag.routes.js';
import { buildBigPdf, buildPdf } from './pdf-fixture.js';

const FAKE = new URL('../test-support/worker-lento.js', import.meta.url);

describe('offloader con un worker de prueba', () => {
  test('devuelve el resultado del worker', async () => {
    const o = createOffloader({ workerUrl: FAKE });
    assert.equal(await o.run('hola', {}), 'hola');
  });

  test('un error del worker llega como el mismo tipo de error', async () => {
    const o = createOffloader({ workerUrl: FAKE });
    await assert.rejects(o.run('error', {}), (e) => e instanceof UnreadableDocumentError && e.message === 'roto');
  });

  test('un trabajo colgado se cancela al vencer el tiempo máximo y el pool sigue sirviendo', async () => {
    const o = createOffloader({ workerUrl: FAKE, timeoutMs: 300, maxWorkers: 1 });
    await assert.rejects(o.run('colgar', {}), (e) => e instanceof UnreadableDocumentError && /tardó más de/.test(e.message));
    assert.equal(await o.run('hola', {}), 'hola');
    assert.deepEqual(o.stats(), { running: 0, queued: 0, maxWorkers: 1, maxQueue: 20 });
  });

  // Si el proceso arranca con --max-old-space-size (NODE_OPTIONS), V8 ignora el tope propio del worker y un worker
  // descontrolado se come la memoria de todo el proceso: la prueba no tiene sentido en ese entorno (el Dockerfile no lo usa).
  const topeAjeno = /max-old-space-size/.test(process.env.NODE_OPTIONS ?? '') && 'NODE_OPTIONS fija --max-old-space-size y V8 ignora el tope del worker';
  test('un worker que se queda sin memoria muere solo: la API (este proceso) sigue viva', { skip: topeAjeno }, async () => {
    const o = createOffloader({ workerUrl: FAKE, maxMemoryMb: 64, timeoutMs: 20_000 });
    await assert.rejects(o.run('memoria', {}), (e) => e instanceof UnreadableDocumentError);
    assert.equal(await o.run('hola', {}), 'hola');
  });

  test('cola llena: rechaza con ProcessingBusyError (503) en vez de acumular archivos', async () => {
    const o = createOffloader({ workerUrl: FAKE, maxWorkers: 1, maxQueue: 1, timeoutMs: 400 });
    const a = o.run('colgar', {}); // corre
    const b = o.run('hola', {});   // espera en cola
    await assert.rejects(o.run('hola', {}), ProcessingBusyError); // no cabe
    assert.deepEqual([o.stats().running, o.stats().queued], [1, 1]);
    await assert.rejects(a, UnreadableDocumentError);
    assert.equal(await b, 'hola', 'el que esperaba se atiende cuando el primero se cancela');
  });

  test('nunca corren más trabajos a la vez que maxWorkers', async () => {
    const o = createOffloader({ workerUrl: FAKE, maxWorkers: 2, maxQueue: 10, timeoutMs: 300 });
    const todos = Array.from({ length: 5 }, () => o.run('colgar', {}).catch((e) => e));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(o.stats().running, 2);
    assert.equal(o.stats().queued, 3);
    await Promise.all(todos);
  });

  test('maxWorkers 0 corre en el mismo hilo (como antes)', async () => {
    const o = createOffloader({ maxWorkers: 0 });
    const pages = await o.run('extract-pdf', { data: new Uint8Array(buildBigPdf(2)) });
    assert.equal(pages.length, 2);
    await assert.rejects(o.run('no-existe', {}), /desconocido/);
  });

  test('ProcessingBusyError se traduce a 503 RFC 7807', () => {
    const p = toRagProblem(new ProcessingBusyError());
    assert.equal(p.status, 503);
  });
});

describe('PDF real por el worker', () => {
  test('lee las páginas y respeta las reglas de siempre (escaneo = 422)', async () => {
    const o = createOffloader({ maxWorkers: 1 });
    const pages = await extractPdfPages(buildBigPdf(3), { offloader: o });
    assert.equal(pages.length, 3);
    assert.match(pages[0], /Capítulo 1/);
    await assert.rejects(extractPdfPages(buildPdf([['hola']]), { offloader: o }), UnreadableDocumentError);
    await assert.rejects(extractPdfPages(Buffer.from('%PDF-1.4 basura'), { offloader: o }), UnreadableDocumentError);
  });

  test('el buffer original no se pierde (se copia antes de cederlo)', async () => {
    const o = createOffloader({ maxWorkers: 1 });
    const pdf = buildBigPdf(2);
    const antes = pdf.length;
    await extractPdfPages(pdf, { offloader: o });
    assert.equal(pdf.length, antes);
  });

  test('mientras se lee un PDF grande, el hilo principal sigue respondiendo (atraso < 100 ms)', async () => {
    const o = createOffloader({ maxWorkers: 1 });
    const pdf = buildBigPdf(250); // ~1 s de CPU: en el hilo principal lo habría parado ese tiempo
    let last = performance.now();
    let peor = 0;
    const t = setInterval(() => { const now = performance.now(); peor = Math.max(peor, now - last - 10); last = now; }, 10);
    const t0 = performance.now();
    let pages;
    try {
      pages = await extractPdfPages(pdf, { offloader: o });
    } finally {
      // Si la lectura falla, el intervalo no debe quedar vivo: colgaría todo `npm test`.
      clearInterval(t);
    }
    const total = performance.now() - t0;
    assert.equal(pages.length, 250);
    assert.ok(total > 300, `el PDF debía tardar (tardó ${total.toFixed(0)} ms): si no, la prueba no demuestra nada`);
    assert.ok(peor < 100, `el hilo principal se atrasó ${peor.toFixed(0)} ms mientras se leía el PDF`);
  });

  test('el troceo también va al worker y da lo mismo que en el hilo principal', async () => {
    const { chunkPages } = await import('../src/modules/tutor/rag/pdf-chunks.js');
    const o = createOffloader({ maxWorkers: 1 });
    const pages = await extractPdfPages(buildBigPdf(5), { offloader: o });
    const options = { title: 'x', maxChars: 800, overlapChars: 120 };
    assert.deepEqual(await o.run('chunk-pages', { pages, options }), chunkPages(pages, options));
  });
});
