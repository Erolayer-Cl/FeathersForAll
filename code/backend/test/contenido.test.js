// Material y tareas (v1.8) sin base: validación de archivos y de tareas, y cómo se descargan.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { enviarArchivo, leerCuerpoArchivo, leerNombreArchivo } from '../src/modules/contenido/archivos.js';
import { aTarea, leerCambiosTarea, leerFechaLimite, leerTarea } from '../src/modules/contenido/contenido.routes.js';

const PDF = Buffer.from('%PDF-1.4\n...');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const en = (min) => new Date(Date.now() + min * 60_000).toISOString();

describe('nombres de archivo', () => {
  test('acepta tildes y espacios; el tipo lo decide la extensión', () => {
    assert.deepEqual(leerNombreArchivo('  Guía 3 · fracciones.PDF '), { nombre: 'Guía 3 · fracciones.PDF', ext: 'pdf', tipo: 'application/pdf', firma: 'pdf' });
    assert.equal(leerNombreArchivo('informe.docx').tipo, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  test('rechaza rutas, controles, nombres ocultos y extensiones fuera de la lista', () => {
    for (const malo of ['../secreto.pdf', 'a/b.pdf', 'a\\b.pdf', 'a\nb.pdf', '.pdf', '', 'x'.repeat(151) + '.pdf']) {
      assert.throws(() => leerNombreArchivo(malo), (e) => e.status === 400, malo);
    }
    for (const ext of ['exe', 'html', 'svg', 'js', 'sin-extension']) {
      assert.throws(() => leerNombreArchivo(`archivo.${ext}`), (e) => e.status === 415, ext);
    }
  });
});

describe('contenido del archivo', () => {
  test('la firma debe calzar con la extensión', () => {
    assert.equal(leerCuerpoArchivo(PDF, leerNombreArchivo('a.pdf')), PDF);
    assert.equal(leerCuerpoArchivo(ZIP, leerNombreArchivo('a.docx')), ZIP);
    assert.throws(() => leerCuerpoArchivo(ZIP, leerNombreArchivo('a.pdf')), (e) => e.status === 422);
    assert.throws(() => leerCuerpoArchivo(PDF, leerNombreArchivo('foto.png')), (e) => e.status === 422);
    assert.throws(() => leerCuerpoArchivo(Buffer.from([0x4d, 0x5a, 0, 0]), leerNombreArchivo('notas.txt')), (e) => e.status === 422);
  });

  test('vacío -> 422; JSON ya leído (no Buffer) -> 415', () => {
    assert.throws(() => leerCuerpoArchivo(Buffer.alloc(0), leerNombreArchivo('a.txt')), (e) => e.status === 422);
    assert.throws(() => leerCuerpoArchivo({ a: 1 }, leerNombreArchivo('a.txt')), (e) => e.status === 415);
  });

  test('la descarga va como adjunto, con nombre UTF-8 y sin que el navegador la interprete', () => {
    const headers = {};
    let cuerpo;
    const res = { set: (h) => Object.assign(headers, h), end: (b) => { cuerpo = b; } };
    enviarArchivo(res, { nombre: 'Guía "final".pdf', tipo: 'application/pdf', contenido: PDF });
    assert.equal(headers['Content-Disposition'], `attachment; filename="Guia _final_.pdf"; filename*=UTF-8''Gu%C3%ADa%20%22final%22.pdf`);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.match(headers['Content-Security-Policy'], /sandbox/);
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(cuerpo, PDF);
  });
});

describe('tareas', () => {
  test('una tarea necesita título, hora límite futura con zona horaria y a menos de un año', () => {
    const t = leerTarea({ title: '  Guía 1 ', instructions: '  ', due_at: en(60) });
    assert.equal(t.title, 'Guía 1');
    assert.equal(t.instructions, null);
    assert.throws(() => leerTarea({ title: 'ab', due_at: en(60) }), /title/);
    assert.throws(() => leerTarea({ title: 'Guía', due_at: en(-1) }), /futuras/);
    assert.throws(() => leerTarea({ title: 'Guía', due_at: '2026-12-01T10:00' }), /zona horaria/);
    assert.throws(() => leerTarea({ title: 'Guía', due_at: en(60 * 24 * 400) }), /366 días/);
    assert.throws(() => leerTarea({ title: 'Guía' }), /due_at/);
  });

  test('la hora con -03:00 (Chile) se guarda en UTC', () => {
    const dia = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    assert.equal(leerFechaLimite(`${dia}T12:00:00-03:00`, { futura: true }), `${dia}T15:00:00.000Z`);
  });

  test('PATCH: al menos un campo; se puede mover la hora al pasado (cierra la tarea) o quitar instrucciones', () => {
    assert.throws(() => leerCambiosTarea({}), /al menos uno/);
    assert.ok(leerCambiosTarea({ due_at: en(-10) }).dueAt);
    assert.deepEqual(leerCambiosTarea({ instructions: null }), { instructions: null });
  });

  test('el estudiante ve su entrega; el docente ve los conteos', () => {
    const fila = {
      id: 't', curso_id: 'c', titulo: 'Guía', instrucciones: null, fecha_limite: new Date('2026-12-01T12:00:00Z'), abierta: true,
      archivo_nombre: null, created_at: new Date('2026-11-01T00:00:00Z'), entregas: 3, estudiantes: 10,
      entrega_nombre: 'mia.pdf', entrega_bytes: 10, entregada_at: new Date('2026-11-20T00:00:00Z'),
    };
    const est = aTarea(fila, { staff: false });
    assert.deepEqual(est.my_submission, { file_name: 'mia.pdf', size_bytes: 10, submitted_at: '2026-11-20T00:00:00.000Z' });
    assert.equal(est.submissions_count, undefined);
    const doc = aTarea(fila, { staff: true });
    assert.deepEqual([doc.submissions_count, doc.students_count, doc.my_submission], [3, 10, undefined]);
    assert.equal(doc.attachment, null);
    assert.equal(doc.due_at, '2026-12-01T12:00:00.000Z');
  });
});
