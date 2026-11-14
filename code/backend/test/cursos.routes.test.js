// Pruebas UNITARIAS de las rutas de cursos (sin PostgreSQL: base falsa de test/fake-db.js).
// Qué cursos ve cada rol lo decide puede_ver_curso() en la base: eso se prueba en test/cursos.pg.test.js.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../db/queries.js';
import { encodeCursor } from '../src/platform/pagination.js';
import { fakeDb, startApi, tokenOf } from './fake-db.js';

const A = '11111111-1111-1111-1111-111111111111';
const CAMILA = { id: 'e0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'estudiante' };
const ANA = { id: 'a0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'docente' };
const MARTA = { id: 'a0000000-0000-0000-0000-000000000003', colegioId: A, rol: 'admin_colegio' };
const MATE = 'c0000000-0000-0000-0000-000000000001';
const HISTORIA = 'c0000000-0000-0000-0000-000000000002';

const fila = (id, nombre, extra = {}) => ({
  id, nombre, periodo: '2026-S2', asignatura: 'Matemática', nivel: '7B', docente_id: ANA.id, docente: 'Ana Rojas',
  matriculados: 4, apuntes: 2, tutor_disponible: true, created_at: '2026-08-01T12:00:00.000Z', ...extra,
});

describe('rutas de cursos (unitarias, sin base)', () => {
  let db;
  let api;
  before(async () => {
    db = fakeDb();
    api = await startApi(db);
  });
  after(() => api.close());
  beforeEach(() => {
    db.handlers.clear();
    db.calls.length = 0;
  });

  describe('GET /v1/courses', () => {
    test('fila de la base -> schema Course; el estudiante NO ve students_count', async () => {
      db.handlers.set(Q.CURSOS_VISIBLES, () => [fila(MATE, 'Matemáticas 7° Básico A')]);
      const res = await api.request('/v1/courses', { token: tokenOf(CAMILA) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.data[0], {
        id: MATE, name: 'Matemáticas 7° Básico A', period: '2026-S2', subject: 'Matemática', grade_level: '7B',
        teacher_id: ANA.id, teacher_name: 'Ana Rojas', tutor_available: true, tutor_documents: 2, created_at: '2026-08-01T12:00:00.000Z',
      });
      assert.equal(body.next_cursor, null);
    });

    test('docente y admin sí ven students_count', async () => {
      db.handlers.set(Q.CURSOS_VISIBLES, () => [fila(MATE, 'Matemáticas 7° Básico A')]);
      for (const user of [ANA, MARTA]) {
        const body = await (await api.request('/v1/courses', { token: tokenOf(user) })).json();
        assert.equal(body.data[0].students_count, 4);
      }
    });

    test('pide una fila de más: si llega, hay otra página y next_cursor apunta a la ÚLTIMA fila entregada', async () => {
      db.handlers.set(Q.CURSOS_VISIBLES, () => [fila(HISTORIA, 'Historia 7° Básico A'), fila(MATE, 'Matemáticas 7° Básico A')]);
      const body = await (await api.request('/v1/courses?limit=1', { token: tokenOf(ANA) })).json();
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].id, HISTORIA);
      assert.equal(body.next_cursor, encodeCursor(['2026-S2', 'Historia 7° Básico A', HISTORIA]));
      // $2 = limit + 1; en la primera página el cursor va en null.
      assert.deepEqual(db.calls[0].params, [null, 2, null, null, null]);
    });

    test('la segunda página manda a la base los valores del cursor y el periodo pedido', async () => {
      db.handlers.set(Q.CURSOS_VISIBLES, () => []);
      const cursor = encodeCursor(['2026-S2', 'Historia 7° Básico A', HISTORIA]);
      const body = await (await api.request(`/v1/courses?limit=1&period=2026-S2&cursor=${cursor}`, { token: tokenOf(ANA) })).json();
      assert.deepEqual(body, { data: [], next_cursor: null });
      assert.deepEqual(db.calls[0].params, ['2026-S2', 2, '2026-S2', 'Historia 7° Básico A', HISTORIA]);
      assert.equal(db.calls[0].readOnly, true);
      assert.deepEqual(db.calls[0].session, { colegioId: A, usuarioId: ANA.id, rol: 'docente' });
    });

    test('period, limit o cursor inválidos -> 400 sin consultar la base', async () => {
      const malos = ['period=2026', 'period=2026-S3', 'limit=0', 'limit=101', 'limit=abc', 'cursor=no-es-base64url-valido',
        `cursor=${encodeCursor(['2026-S2', 'Historia'])}`, `cursor=${encodeCursor(['2026-S2', 'Historia', "x' OR 1=1"])}`,
        `cursor=${encodeCursor({ periodo: '2026-S2' })}`];
      for (const q of malos) {
        const res = await api.request(`/v1/courses?${q}`, { token: tokenOf(ANA) });
        assert.equal(res.status, 400, q);
        assert.match(res.headers.get('content-type'), /application\/problem\+json/);
      }
      assert.equal(db.calls.length, 0);
    });

    test('sin token -> 401', async () => {
      assert.equal((await api.request('/v1/courses')).status, 401);
    });
  });

  describe('GET /v1/courses/{id}', () => {
    test('el curso visible, con el mismo schema', async () => {
      db.handlers.set(Q.CURSO_DETALLE, () => [fila(MATE, 'Matemáticas 7° Básico A', { tutor_disponible: false, apuntes: 0 })]);
      const body = await (await api.request(`/v1/courses/${MATE}`, { token: tokenOf(CAMILA) })).json();
      assert.equal(body.id, MATE);
      assert.equal(body.tutor_available, false);
      assert.equal(body.students_count, undefined);
      assert.deepEqual(db.calls[0].params, [MATE]);
    });

    test('curso que la base no muestra (otro colegio o no participas) -> 404; id que no es UUID -> 400', async () => {
      db.handlers.set(Q.CURSO_DETALLE, () => []);
      const res = await api.request(`/v1/courses/${MATE}`, { token: tokenOf(CAMILA) });
      assert.equal(res.status, 404);
      assert.match((await res.json()).type, /not-found$/);
      assert.equal((await api.request('/v1/courses/matematicas', { token: tokenOf(CAMILA) })).status, 400);
    });
  });
});
