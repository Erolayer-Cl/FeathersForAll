// Pruebas UNITARIAS del ciclo mínimo (sin PostgreSQL): validación, permisos por rol e Idempotency-Key.
// El comportamiento con la base real (RLS, orden de alternativas, carreras) está en test/ciclo.pg.test.js.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as Q from '../db/queries.js';
import { leerEvaluacion } from '../src/modules/evaluaciones/evaluaciones.routes.js';
import { fakeDb, startApi, tokenOf } from './fake-db.js';

const A = '11111111-1111-1111-1111-111111111111';
const CAMILA = { id: 'e0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'estudiante' };
const ANA = { id: 'a0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'docente' };
const LUIS = { id: 'a0000000-0000-0000-0000-000000000002', colegioId: A, rol: 'docente' };
const MARTA = { id: 'a0000000-0000-0000-0000-000000000003', colegioId: A, rol: 'admin_colegio' };
const MATE = 'c0000000-0000-0000-0000-000000000001';
const EV = 'd0000000-0000-0000-0000-000000000001';
const Q1 = 'f0000000-0000-0000-0000-000000000001';
const T = { CAMILA: tokenOf(CAMILA), ANA: tokenOf(ANA), LUIS: tokenOf(LUIS), MARTA: tokenOf(MARTA) };

const pregunta = { statement: '¿Cuánto es 3/4 + 1/4?', options: ['1/2', '1'], correct_option: 1, feedback: 'Es 1.' };

describe('leerEvaluacion (validación del cuerpo)', () => {
  test('normaliza espacios y devuelve la forma interna', () => {
    const r = leerEvaluacion({ title: '  Prueba de fracciones ', questions: [{ ...pregunta, statement: ' ¿Cuánto es? ', options: [' a ', 'b'] }] });
    assert.deepEqual(r, { title: 'Prueba de fracciones', closesAt: null, questions: [{ type: 'multiple_choice', statement: '¿Cuánto es?', options: ['a', 'b'], correct: 1, accepted: null, feedback: 'Es 1.' }] });
  });
  test('correct_option y feedback son opcionales (se exigen al publicar, no al crear)', () => {
    const [q] = leerEvaluacion({ title: 'Borrador', questions: [{ statement: 'Enunciado', options: ['a', 'b'] }] }).questions;
    assert.deepEqual({ correct: q.correct, feedback: q.feedback }, { correct: null, feedback: null });
  });
  test('rechaza lo inválido', () => {
    const malos = [undefined, {}, { title: 'ab', questions: [pregunta] }, { title: 'Prueba', questions: [] },
      { title: 'Prueba', questions: Array(101).fill(pregunta) }, { title: 'Prueba', questions: [{ ...pregunta, options: ['a'] }] },
      { title: 'Prueba', questions: [{ ...pregunta, options: ['a', 'A'] }] }, { title: 'Prueba', questions: [{ ...pregunta, correct_option: 2 }] },
      { title: 'Prueba', questions: [{ ...pregunta, correct_option: 1.5 }] }, { title: 'Prueba', questions: [{ ...pregunta, options: ['a', 1] }] },
      { title: 'Prueba', questions: [{ ...pregunta, feedback: 'x'.repeat(1001) }] }, { title: 'Prueba', max_attempts: 2, questions: [pregunta] },
      { title: 'Prueba', closes_at: 'mañana', questions: [pregunta] }, { title: 'Prueba', closes_at: '2020-01-01T00:00:00Z', questions: [pregunta] }];
    for (const body of malos) assert.throws(() => leerEvaluacion(body), (e) => e.status === 400, JSON.stringify(body)?.slice(0, 70));
  });
});

describe('rutas del ciclo mínimo (unitarias, sin base)', () => {
  let db;
  let api;
  before(async () => { db = fakeDb(); api = await startApi(db); });
  after(() => api.close());
  beforeEach(() => { db.handlers.clear(); db.calls.length = 0; });

  const post = (path, user, body, key = randomUUID()) => fetch(api.url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${T[user]}`, ...(key && { 'idempotency-key': key }) },
    body: JSON.stringify(body),
  });
  const cursoDe = (matriculado = false) => [{ id: MATE, nombre: 'Matemáticas', docente_id: ANA.id, matriculado }];

  describe('Idempotency-Key', () => {
    const cuerpo = { name: 'Lenguaje 7° B', period: '2026-S2' };
    const filaCurso = { id: MATE, nombre: 'Lenguaje 7° B', periodo: '2026-S2', asignatura: null, nivel: null, docente_id: ANA.id, docente: 'Ana Rojas', matriculados: 0, apuntes: 0, tutor_disponible: false, created_at: '2026-11-14T12:00:00.000Z' };

    test('sin la cabecera o con una que no es UUID -> 400, sin tocar la base', async () => {
      assert.equal((await post('/v1/courses', 'ANA', cuerpo, null)).status, 400);
      assert.equal((await post('/v1/courses', 'ANA', cuerpo, 'no-es-uuid')).status, 400);
      assert.equal(db.calls.length, 0);
    });

    test('primera vez: ejecuta y guarda la respuesta; repetida: devuelve lo guardado sin ejecutar de nuevo', async () => {
      const guardadas = new Map();
      db.handlers.set(Q.IDEMPOTENCIA_BUSCAR, ([clave]) => (guardadas.has(clave) ? [guardadas.get(clave)] : []));
      db.handlers.set(Q.IDEMPOTENCIA_GUARDAR, ([clave, usuarioId, operacion, status, respuesta]) => {
        guardadas.set(clave, { usuario_id: usuarioId, operacion, status_http: status, respuesta });
        return [];
      });
      db.handlers.set(Q.CREAR_CURSO, () => [{ id: MATE }]);
      db.handlers.set(Q.CURSO_DETALLE, () => [filaCurso]);

      const key = randomUUID();
      const a = await post('/v1/courses', 'ANA', cuerpo, key);
      assert.equal(a.status, 201);
      assert.equal(a.headers.get('idempotent-replayed'), null);
      const b = await post('/v1/courses', 'ANA', cuerpo, key);
      assert.equal(b.status, 201);
      assert.equal(b.headers.get('idempotent-replayed'), 'true');
      assert.deepEqual(await b.json(), await a.json());
      assert.equal(db.callsOf(Q.CREAR_CURSO).length, 1, 'el curso se crea una sola vez');
      assert.equal(db.callsOf(Q.IDEMPOTENCIA_GUARDAR)[0].params[2], 'POST /v1/courses');
    });

    test('la misma clave en otra operación o de otro usuario -> 422 y no se ejecuta nada', async () => {
      const key = randomUUID();
      db.handlers.set(Q.IDEMPOTENCIA_BUSCAR, () => [{ usuario_id: ANA.id, operacion: 'POST /v1/courses', status_http: 201, respuesta: {} }]);
      db.handlers.set(Q.CREAR_CURSO, () => { throw new Error('no debía ejecutarse'); });
      const otroUsuario = await post('/v1/courses', 'MARTA', { ...cuerpo, teacher_id: ANA.id }, key);
      assert.equal(otroUsuario.status, 422);
      db.handlers.set(Q.IDEMPOTENCIA_BUSCAR, () => [{ usuario_id: ANA.id, operacion: 'POST /v1/courses/:courseId/enrollments', status_http: 201, respuesta: {} }]);
      assert.equal((await post('/v1/courses', 'ANA', cuerpo, key)).status, 422);
      assert.equal(db.callsOf(Q.CREAR_CURSO).length, 0);
    });

    test('si la operación falla no se guarda nada (reintentar vuelve a intentar)', async () => {
      db.handlers.set(Q.IDEMPOTENCIA_BUSCAR, () => []);
      db.handlers.set(Q.CREAR_CURSO, () => { throw Object.assign(new Error('fk'), { code: '23503' }); });
      assert.equal((await post('/v1/courses', 'MARTA', { ...cuerpo, teacher_id: CAMILA.id })).status, 422);
      assert.equal(db.callsOf(Q.IDEMPOTENCIA_GUARDAR).length, 0);
    });
  });

  describe('permisos (se deciden antes de escribir)', () => {
    beforeEach(() => {
      db.handlers.set(Q.IDEMPOTENCIA_BUSCAR, () => []);
      db.handlers.set(Q.CURSO_ACCESO, (_p, s) => cursoDe(s.rol === 'estudiante'));
    });

    test('el estudiante no crea cursos; el docente no crea a nombre de otro; el admin debe indicar el docente', async () => {
      assert.equal((await post('/v1/courses', 'CAMILA', { name: 'Curso', period: '2026-S2' })).status, 403);
      assert.equal((await post('/v1/courses', 'ANA', { name: 'Curso', period: '2026-S2', teacher_id: LUIS.id })).status, 403);
      assert.equal((await post('/v1/courses', 'MARTA', { name: 'Curso', period: '2026-S2' })).status, 400);
      assert.equal(db.callsOf(Q.CREAR_CURSO).length, 0);
    });

    test('matricular: correo inválido 400; estudiante y otro docente 403; correo que no existe 404', async () => {
      const ruta = `/v1/courses/${MATE}/enrollments`;
      assert.equal((await post(ruta, 'ANA', { student_email: 'no-es-correo' })).status, 400);
      assert.equal((await post(ruta, 'CAMILA', { student_email: 'sofia@demo-a.cl' })).status, 403);
      assert.equal((await post(ruta, 'LUIS', { student_email: 'sofia@demo-a.cl' })).status, 403);
      db.handlers.set(Q.MATRICULAR_POR_EMAIL, () => []);
      assert.equal((await post(ruta, 'ANA', { student_email: 'nadie@demo-a.cl' })).status, 404);
      assert.equal(db.callsOf(Q.MATRICULAR_POR_EMAIL).length, 1, 'solo el docente del curso llegó a escribir');
    });

    test('crear evaluación: estudiante y otro docente 403, y no se escribe nada', async () => {
      const body = { title: 'Prueba', questions: [pregunta] };
      assert.equal((await post(`/v1/courses/${MATE}/assessments`, 'CAMILA', body)).status, 403);
      assert.equal((await post(`/v1/courses/${MATE}/assessments`, 'LUIS', body)).status, 403);
      assert.equal(db.callsOf(Q.CREAR_EVALUACION).length, 0);
    });

    test('rendir: docente y admin 403 sin consultar la base; respuestas mal formadas 400', async () => {
      const ruta = `/v1/assessments/${EV}/submissions`;
      assert.equal((await post(ruta, 'ANA', { answers: [{ question_id: Q1, selected_option: 0 }] })).status, 403);
      assert.equal((await post(ruta, 'MARTA', { answers: [{ question_id: Q1, selected_option: 0 }] })).status, 403);
      for (const answers of [undefined, [], [{ question_id: 'x', selected_option: 0 }], [{ question_id: Q1, selected_option: -1 }], [{ question_id: Q1, selected_option: 0 }, { question_id: Q1, selected_option: 1 }]]) {
        assert.equal((await post(ruta, 'CAMILA', { answers })).status, 400, JSON.stringify(answers));
      }
      assert.equal(db.callsOf(Q.CREAR_INTENTO).length, 0);
    });

    test('rendir: un borrador no existe para el estudiante (404) y una cerrada da 409', async () => {
      const ruta = `/v1/assessments/${EV}/submissions`;
      const body = { answers: [{ question_id: Q1, selected_option: 0 }] };
      db.handlers.set(Q.EVALUACION_ACCESO, () => [{ id: EV, curso_id: MATE, estado: 'borrador', docente_id: ANA.id }]);
      assert.equal((await post(ruta, 'CAMILA', body)).status, 404);
      db.handlers.set(Q.EVALUACION_ACCESO, () => [{ id: EV, curso_id: MATE, estado: 'cerrada', docente_id: ANA.id }]);
      assert.equal((await post(ruta, 'CAMILA', body)).status, 409);
      assert.equal(db.callsOf(Q.CREAR_INTENTO).length, 0);
    });

    test('publicar: sin alternativa correcta 422 con la lista de preguntas; estudiante 403; estado inválido 400', async () => {
      const patch = (user, body) => fetch(`${api.url}/v1/assessments/${EV}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${T[user]}` }, body: JSON.stringify(body) });
      db.handlers.set(Q.EVALUACION_ACCESO, () => [{ id: EV, curso_id: MATE, titulo: 'Prueba', estado: 'borrador', docente_id: ANA.id }]);
      db.handlers.set(Q.PREGUNTAS_SIN_CORRECTA, () => [{ id: Q1, orden: 2 }, { id: 'x', orden: 4 }]);
      const r = await patch('ANA', { status: 'published' });
      assert.equal(r.status, 422);
      const problema = await r.json();
      assert.deepEqual(problema.errors.map((e) => e.field), ['questions[1].correct_option', 'questions[3].correct_option']);
      assert.match(problema.detail, /pregunta 2, 4/);
      assert.equal((await patch('CAMILA', { status: 'published' })).status, 403);
      assert.equal((await patch('ANA', { status: 'draft' })).status, 400);
      assert.equal(db.callsOf(Q.PUBLICAR_EVALUACION).length, 0);
    });
  });
});

describe('leerCierre (v1.9): hora de cierre al publicar o después', async () => {
  const { leerCierre } = await import('../src/modules/evaluaciones/evaluaciones.routes.js');
  const en = (min) => new Date(Date.now() + min * 60_000).toISOString();
  test('undefined = no cambia; null = sin cierre; fecha futura con zona = se normaliza a UTC', () => {
    assert.equal(leerCierre(undefined), undefined);
    assert.equal(leerCierre(null), null);
    const dia = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    assert.equal(leerCierre(`${dia}T23:59:00-03:00`), new Date(`${dia}T23:59:00-03:00`).toISOString());
    assert.match(leerCierre(en(90)), /Z$/);
  });
  test('rechaza pasado, sin zona horaria, a más de un año o que no sea texto', () => {
    for (const malo of [en(-1), '2026-12-01T10:00', en(60 * 24 * 400), 123, 'mañana']) {
      assert.throws(() => leerCierre(malo), (e) => e.status === 400, String(malo));
    }
  });
});

describe('preguntas de texto (v1.10): validación', () => {
  const base = { title: 'Mixta' };
  test('acepta una pregunta de texto con respuestas aceptadas, y sin ellas en un borrador', () => {
    const { questions } = leerEvaluacion({ ...base, questions: [{ statement: '¿Cuánto es 3 + 4?', type: 'text', accepted_answers: [' 7 ', 'siete'] }, { statement: '¿Capital de Chile?', type: 'text' }] });
    assert.deepEqual(questions[0], { type: 'text', statement: '¿Cuánto es 3 + 4?', options: [], correct: null, accepted: ['7', 'siete'], feedback: null });
    assert.equal(questions[1].accepted, null);
  });
  test('rechaza mezclar alternativas con texto, tipos desconocidos y respuestas repetidas o vacías', () => {
    const malas = [
      { statement: 'Pregunta', type: 'text', options: ['a', 'b'] },
      { statement: 'Pregunta', type: 'text', correct_option: 0 },
      { statement: 'Pregunta', type: 'abierta' },
      { statement: 'Pregunta', type: 'text', accepted_answers: ['7', '7'] },
      { statement: 'Pregunta', type: 'text', accepted_answers: [''] },
      { statement: 'Pregunta', type: 'text', accepted_answers: Array.from({ length: 11 }, (_, i) => String(i)) },
    ];
    for (const q of malas) assert.throws(() => leerEvaluacion({ ...base, questions: [q] }), (e) => e.status === 400, JSON.stringify(q));
  });
});
