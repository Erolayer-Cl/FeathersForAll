// Material visible para el estudiante y tareas con hora límite (v1.8) contra un PostgreSQL REAL (RLS + permisos).
// Se saltan si no hay TEST_DATABASE_URL (ver test/pg-fixture.js).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import * as Q from '../db/queries.js';
import { buildPdf } from './pdf-fixture.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const A = DEMO.colegioA;
const B = DEMO.colegioB;
const ANA = { id: DEMO.ana, rol: 'docente' };          // docente de Matemáticas (curso MATE)
const LUIS = { id: DEMO.luis, rol: 'docente' };        // docente de Historia (no dicta MATE)
const MARTA = { id: DEMO.marta, rol: 'admin_colegio' };
const CAMILA = { id: DEMO.camila, rol: 'estudiante' };
const TOMAS = { id: DEMO.tomas, rol: 'estudiante' };
const JAVIERA = { id: DEMO.javiera, rol: 'estudiante' }; // colegio B

const PDF = buildPdf([['Guia de fracciones: resuelve los ejercicios 1 al 5.']]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const en = (min) => new Date(Date.now() + min * 60_000).toISOString();

describe('material y tareas (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;
  let server;
  let url;

  const tok = (u, tenant = A) => signJwt({ sub: u.id, tenant_id: tenant, role: u.rol }, SECRET);
  const call = (method, path, { user, tenant, body, raw, type, key = randomUUID() } = {}) => fetch(url + path, {
    method,
    headers: {
      ...(raw ? { 'content-type': type ?? 'application/octet-stream' } : { 'content-type': 'application/json' }),
      ...(user && { authorization: `Bearer ${tok(user, tenant)}` }),
      ...(key && method === 'POST' && { 'idempotency-key': key }),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const ok = async (res, status) => {
    assert.equal(res.status, status, `esperaba ${status}, llegó ${res.status}: ${await res.clone().text()}`);
    return res.status === 204 ? null : res.headers.get('content-type')?.includes('json') ? res.json() : Buffer.from(await res.arrayBuffer());
  };
  const problema = async (res, status, type) => {
    const body = await res.json();
    assert.equal(res.status, status, JSON.stringify(body));
    if (type) assert.match(body.type, new RegExp(`/${type}$`));
    return body;
  };

  before(async () => {
    testDb = await createTestDatabase('ffa_contenido');
    db = createDb({ connectionString: testDb.appUrl, max: 6 });
    const llm = { async *chat() {}, ping: async () => true };
    server = createApp({ logger: pino({ level: 'silent' }), llm, db, jwtSecret: SECRET }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;

    // Apuntes de MATE: uno con su archivo original, uno antiguo (solo texto) y las Bases Mineduc (no se muestran).
    const su = testDb.superuser;
    const apunte = async (titulo, contenido) => (await su.query(
      'INSERT INTO apuntes_curso (colegio_id, curso_id, titulo, contenido) VALUES ($1, $2, $3, $4) RETURNING id', [A, DEMO.mate, titulo, contenido])).rows[0].id;
    const guia = await apunte('guia-fracciones.pdf', 'Guía de fracciones');
    await su.query('INSERT INTO apuntes_archivos (apunte_id, colegio_id, curso_id, nombre, tipo, bytes, contenido) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [guia, A, DEMO.mate, 'guia-fracciones.pdf', 'application/pdf', PDF.length, PDF]);
    await apunte('decimales.pdf', 'Los decimales tienen una parte entera y una decimal.');
    await apunte('MINEDUC Bases Matemática.pdf', 'Bases curriculares');
  });
  after(async () => {
    server?.close();
    await db?.end();
    await testDb?.drop();
  });

  describe('1 · el estudiante ve lo que sube el docente', () => {
    test('lista los apuntes del curso, sin las Bases Mineduc', async () => {
      const { data } = await ok(await call('GET', `/v1/courses/${DEMO.mate}/materials`, { user: CAMILA }), 200);
      assert.deepEqual(data.map((m) => m.name).sort(), ['decimales.pdf', 'guia-fracciones.pdf']);
      const guia = data.find((m) => m.name === 'guia-fracciones.pdf');
      assert.equal(guia.original, true);
      assert.equal(guia.size_bytes, PDF.length);
      assert.equal(guia.content_type, 'application/pdf');
    });

    test('descarga el archivo original, como adjunto y sin que el navegador lo interprete', async () => {
      const res = await call('GET', `/v1/courses/${DEMO.mate}/materials/${encodeURIComponent('guia-fracciones.pdf')}/file`, { user: CAMILA });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.match(res.headers.get('content-disposition'), /^attachment; filename="guia-fracciones\.pdf"/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-security-policy'), /sandbox/);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PDF);
    });

    test('un apunte sin archivo original se entrega como texto', async () => {
      const res = await call('GET', `/v1/courses/${DEMO.mate}/materials/decimales.pdf/file`, { user: CAMILA });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /filename="decimales\.txt"/);
      assert.match(await res.text(), /parte entera/);
    });

    test('las Bases Mineduc no se descargan; un curso ajeno o de otro colegio es 404', async () => {
      await problema(await call('GET', `/v1/courses/${DEMO.mate}/materials/${encodeURIComponent('MINEDUC Bases Matemática.pdf')}/file`, { user: CAMILA }), 404);
      await problema(await call('GET', `/v1/courses/${DEMO.mate}/materials`, { user: JAVIERA, tenant: B }), 404);
      await problema(await call('GET', `/v1/courses/${DEMO.mate}/materials`, { user: LUIS }), 404);
    });

    test('la base no deja que un estudiante cambie ni borre archivos de apuntes', async () => {
      const upd = await db.withUser(sesion(CAMILA), (c) => c.query('UPDATE apuntes_archivos SET nombre = $1', ['x.pdf']));
      const del = await db.withUser(sesion(CAMILA), (c) => c.query('DELETE FROM apuntes_archivos'));
      assert.deepEqual([upd.rowCount, del.rowCount], [0, 0]);
    });
  });

  describe('2 · tareas con hora límite', () => {
    let tareaId;

    test('el docente crea una tarea con hora límite; el estudiante no puede', async () => {
      const t = await ok(await call('POST', `/v1/courses/${DEMO.mate}/tasks`, {
        user: ANA, body: { title: 'Guía de fracciones', instructions: 'Resuelve y sube una foto o PDF.', due_at: en(60) },
      }), 201);
      tareaId = t.id;
      assert.equal(t.is_open, true);
      assert.equal(t.submissions_count, 0);
      assert.equal(t.students_count, 4);
      await problema(await call('POST', `/v1/courses/${DEMO.mate}/tasks`, { user: CAMILA, body: { title: 'Trampa', due_at: en(60) } }), 403, 'forbidden');
      await problema(await call('POST', `/v1/courses/${DEMO.mate}/tasks`, { user: ANA, body: { title: 'Pasada', due_at: en(-5) } }), 400);
      await problema(await call('POST', `/v1/courses/${DEMO.mate}/tasks`, { user: ANA, body: { title: 'Sin zona', due_at: '2026-12-01T10:00' } }), 400);
    });

    test('el docente adjunta el enunciado y el estudiante lo descarga', async () => {
      const t = await ok(await call('PUT', `/v1/tasks/${tareaId}/attachment/enunciado.pdf`, { user: ANA, raw: PDF, type: 'application/pdf' }), 200);
      assert.deepEqual(t.attachment, { name: 'enunciado.pdf', size_bytes: PDF.length, content_type: 'application/pdf' });
      assert.deepEqual(await ok(await call('GET', `/v1/tasks/${tareaId}/attachment`, { user: CAMILA }), 200), PDF);
      await problema(await call('PUT', `/v1/tasks/${tareaId}/attachment/otro.pdf`, { user: CAMILA, raw: PDF }), 403);
    });

    test('el estudiante ve la tarea abierta y sin entrega', async () => {
      const { data } = await ok(await call('GET', `/v1/courses/${DEMO.mate}/tasks`, { user: CAMILA }), 200);
      const t = data.find((x) => x.id === tareaId);
      assert.equal(t.is_open, true);
      assert.equal(t.my_submission, null);
      assert.equal(t.submissions_count, undefined); // los conteos del curso son del docente
    });

    test('el estudiante entrega (201) y la puede reemplazar antes de la hora (200)', async () => {
      const r1 = await ok(await call('PUT', `/v1/tasks/${tareaId}/submission/mi-guia.pdf`, { user: CAMILA, raw: PDF }), 201);
      assert.equal(r1.file_name, 'mi-guia.pdf');
      const r2 = await ok(await call('PUT', `/v1/tasks/${tareaId}/submission/${encodeURIComponent('foto guía.png')}`, { user: CAMILA, raw: PNG, type: 'image/png' }), 200);
      assert.equal(r2.file_name, 'foto guía.png');
      assert.ok(new Date(r2.submitted_at) >= new Date(r1.submitted_at));
      assert.deepEqual(await ok(await call('GET', `/v1/tasks/${tareaId}/submission`, { user: CAMILA }), 200), PNG);
    });

    test('archivos inválidos: extensión no permitida (415), contenido que no calza (422), vacío (422)', async () => {
      await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/virus.exe`, { user: TOMAS, raw: PDF }), 415);
      await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/falso.pdf`, { user: TOMAS, raw: Buffer.from('no soy un pdf') }), 422, 'invalid-file');
      await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/vacio.txt`, { user: TOMAS, raw: Buffer.alloc(0) }), 422);
      await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/a.pdf`, { user: TOMAS, body: { x: 1 } }), 415);
    });

    test('el docente ve quién entregó y descarga la entrega; nadie más la descarga', async () => {
      const t = await ok(await call('GET', `/v1/tasks/${tareaId}`, { user: ANA }), 200);
      assert.equal(t.submissions_count, 1);
      assert.equal(t.students.length, 4);
      const camila = t.students.find((s) => s.student_id === DEMO.camila);
      assert.equal(camila.submission.file_name, 'foto guía.png');
      assert.equal(t.students.filter((s) => s.submission === null).length, 3);
      assert.deepEqual(await ok(await call('GET', `/v1/tasks/${tareaId}/submissions/${DEMO.camila}/file`, { user: ANA }), 200), PNG);
      assert.deepEqual(await ok(await call('GET', `/v1/tasks/${tareaId}/submissions/${DEMO.camila}/file`, { user: MARTA }), 200), PNG);
      // Otro estudiante del curso no ve la entrega de Camila; otro docente ni siquiera ve la tarea.
      await problema(await call('GET', `/v1/tasks/${tareaId}/submissions/${DEMO.camila}/file`, { user: TOMAS }), 403);
      await problema(await call('GET', `/v1/tasks/${tareaId}/submission`, { user: TOMAS }), 404);
      await problema(await call('GET', `/v1/tasks/${tareaId}`, { user: LUIS }), 404);
      await problema(await call('GET', `/v1/tasks/${tareaId}`, { user: JAVIERA, tenant: B }), 404);
      // El docente no sube entregas por un estudiante.
      await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/x.pdf`, { user: ANA, raw: PDF }), 403);
    });

    test('pasada la hora límite, ya no se puede subir nada (409)', async () => {
      await testDb.superuser.query("UPDATE tareas SET fecha_limite = now() - interval '1 minute' WHERE id = $1", [tareaId]);
      const { data } = await ok(await call('GET', `/v1/courses/${DEMO.mate}/tasks`, { user: CAMILA }), 200);
      assert.equal(data.find((x) => x.id === tareaId).is_open, false);
      const p = await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/tarde.pdf`, { user: TOMAS, raw: PDF }), 409, 'task-closed');
      assert.match(p.detail, /ya no se pueden subir entregas/);
      await problema(await call('PUT', `/v1/tasks/${tareaId}/submission/cambio.pdf`, { user: CAMILA, raw: PDF }), 409, 'task-closed');
      // Lo entregado a tiempo se sigue pudiendo descargar.
      assert.deepEqual(await ok(await call('GET', `/v1/tasks/${tareaId}/submission`, { user: CAMILA }), 200), PNG);
    });

    test('la BASE rechaza la entrega tardía aunque la API no la revisara', async () => {
      await assert.rejects(
        db.withUser(sesion(TOMAS), (c) => c.query(Q.GUARDAR_ENTREGA, [DEMO.mate, tareaId, 'tarde.pdf', 'application/pdf', PDF.length, PDF])),
        (err) => err.code === '42501',
      );
      const r = await db.withUser(sesion(CAMILA), (c) => c.query('UPDATE entregas_tarea SET archivo_nombre = $2 WHERE tarea_id = $1', [tareaId, 'cambiado.png']));
      assert.equal(r.rowCount, 0);
    });

    test('el docente extiende el plazo y se puede volver a entregar', async () => {
      const t = await ok(await call('PATCH', `/v1/tasks/${tareaId}`, { user: ANA, body: { due_at: en(30) } }), 200);
      assert.equal(t.is_open, true);
      await ok(await call('PUT', `/v1/tasks/${tareaId}/submission/tarde.pdf`, { user: TOMAS, raw: PDF }), 201);
      await problema(await call('PATCH', `/v1/tasks/${tareaId}`, { user: CAMILA, body: { due_at: en(600) } }), 403);
    });

    test('el estudiante no puede fijar la hora de su entrega', async () => {
      await db.withUser(sesion(TOMAS), (c) => c.query("UPDATE entregas_tarea SET entregada_at = now() - interval '10 days' WHERE tarea_id = $1", [tareaId]));
      const { rows } = await testDb.superuser.query('SELECT entregada_at FROM entregas_tarea WHERE tarea_id = $1 AND estudiante_id = $2', [tareaId, DEMO.tomas]);
      assert.ok(Date.now() - rows[0].entregada_at.getTime() < 60_000);
    });

    test('el docente borra la tarea y con ella las entregas', async () => {
      await problema(await call('DELETE', `/v1/tasks/${tareaId}`, { user: CAMILA }), 403);
      await ok(await call('DELETE', `/v1/tasks/${tareaId}`, { user: ANA }), 204);
      await problema(await call('GET', `/v1/tasks/${tareaId}`, { user: ANA }), 404);
      const { rows } = await testDb.superuser.query('SELECT count(*)::int AS n FROM entregas_tarea WHERE tarea_id = $1', [tareaId]);
      assert.equal(rows[0].n, 0);
    });
  });
});

/** Sesión de base para un usuario del colegio A (lo que db.withUser recibe de req.user). */
function sesion(u) {
  return { id: u.id, rol: u.rol, colegioId: DEMO.colegioA };
}
