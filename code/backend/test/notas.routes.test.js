// Pruebas UNITARIAS de las rutas de notas (sin PostgreSQL: base falsa de test/fake-db.js).
// Prueban la ruta: validación, permisos por rol, forma de la respuesta y qué se le pide a la base.
// El cálculo de la nota y el RLS se prueban contra PostgreSQL real en test/notas.test.js.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../db/queries.js';
import { fakeDb, startApi, tokenOf } from './fake-db.js';

const A = '11111111-1111-1111-1111-111111111111';
const CAMILA = { id: 'e0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'estudiante' };
const SOFIA = { id: 'e0000000-0000-0000-0000-000000000003', colegioId: A, rol: 'estudiante' };
const ANA = { id: 'a0000000-0000-0000-0000-000000000001', colegioId: A, rol: 'docente' };
const LUIS = { id: 'a0000000-0000-0000-0000-000000000002', colegioId: A, rol: 'docente' };
const MARTA = { id: 'a0000000-0000-0000-0000-000000000003', colegioId: A, rol: 'admin_colegio' };
const MATE = 'c0000000-0000-0000-0000-000000000001';
const HISTORIA = 'c0000000-0000-0000-0000-000000000002';
const FRACCIONES = 'd0000000-0000-0000-0000-000000000001';
const DECIMALES = 'd0000000-0000-0000-0000-000000000002';

const T = Object.fromEntries(Object.entries({ CAMILA, SOFIA, ANA, LUIS, MARTA }).map(([k, u]) => [k, tokenOf(u)]));

/** Curso de Ana tal como lo devuelve CURSO_ACCESO (matriculado = el usuario de la sesión tiene matrícula). */
const cursoMate = (matriculado = false) => [{ id: MATE, nombre: 'Matemáticas 7° Básico A', docente_id: ANA.id, matriculado }];

describe('rutas de notas (unitarias, sin base)', () => {
  let db;
  let api;
  const json = async (path, opts, status = 200) => {
    const res = await api.request(path, opts);
    assert.equal(res.status, status, `${opts?.method ?? 'GET'} ${path} -> ${res.status}`);
    return res.json();
  };
  const problem = async (path, opts, status) => {
    const res = await api.request(path, opts);
    assert.equal(res.status, status, `${opts?.method ?? 'GET'} ${path} -> ${res.status}`);
    assert.match(res.headers.get('content-type'), /application\/problem\+json/);
    return res.json();
  };

  before(async () => {
    db = fakeDb();
    api = await startApi(db);
  });
  after(() => api.close());
  beforeEach(() => {
    db.handlers.clear();
    db.calls.length = 0;
  });

  describe('GET /v1/me/grades (mis ramos y mis notas)', () => {
    const ramos = [
      { curso_id: MATE, curso: 'Matemáticas 7° Básico A', asignatura: 'Matemática', periodo: '2026-S2', docente: 'Ana Rojas', tutor_disponible: true },
      { curso_id: HISTORIA, curso: 'Historia 7° Básico A', asignatura: 'Historia', periodo: '2026-S2', docente: 'Luis Pérez', tutor_disponible: false },
    ];
    const notas = [
      { curso_id: MATE, evaluacion_id: FRACCIONES, evaluacion: 'Fracciones', puntaje: 75, nota: 5.2, ponderacion: 1, fecha_envio: '2026-10-01T12:00:00.000Z', promedio_curso: 5.7 },
      { curso_id: MATE, evaluacion_id: DECIMALES, evaluacion: 'Números decimales', puntaje: 90, nota: 6.0, ponderacion: 2, fecha_envio: '2026-10-20T12:00:00.000Z', promedio_curso: 5.7 },
    ];

    test('agrupa las notas por ramo; un ramo sin notas sale igual, con average null', async () => {
      db.handlers.set(Q.RAMOS_ESTUDIANTE, () => ramos);
      db.handlers.set(Q.NOTAS_ESTUDIANTE, () => notas);
      const body = await json('/v1/me/grades', { token: T.CAMILA });

      assert.equal(body.student_id, CAMILA.id);
      assert.equal(body.courses.length, 2);
      const [mate, historia] = body.courses;
      assert.deepEqual(
        { ...mate, grades: undefined },
        { course_id: MATE, course: 'Matemáticas 7° Básico A', subject: 'Matemática', period: '2026-S2', teacher_name: 'Ana Rojas', tutor_available: true, average: 5.7, grades: undefined },
      );
      assert.deepEqual(mate.grades[1], { assessment_id: DECIMALES, title: 'Números decimales', score: 90, grade: 6.0, weight: 2, submitted_at: '2026-10-20T12:00:00.000Z' });
      assert.equal(historia.average, null);
      assert.deepEqual(historia.grades, []);
      assert.equal(historia.tutor_available, false);
    });

    test('el estudiante sale del JWT (nunca del cliente) y la lectura es de solo lectura, con su sesión', async () => {
      db.handlers.set(Q.RAMOS_ESTUDIANTE, () => []);
      db.handlers.set(Q.NOTAS_ESTUDIANTE, () => []);
      // Un intento de pedir las notas de otra persona por query se ignora: no existe ese parámetro.
      const body = await json(`/v1/me/grades?student_id=${SOFIA.id}`, { token: T.CAMILA });
      assert.equal(body.student_id, CAMILA.id);
      for (const call of db.calls) {
        assert.equal(call.params[0], CAMILA.id);
        assert.equal(call.readOnly, true);
        assert.deepEqual(call.session, { colegioId: A, usuarioId: CAMILA.id, rol: 'estudiante' });
      }
    });

    test('course_id filtra un ramo (se pasa a las dos consultas); sin él va null', async () => {
      db.handlers.set(Q.RAMOS_ESTUDIANTE, () => []);
      db.handlers.set(Q.NOTAS_ESTUDIANTE, () => []);
      await json(`/v1/me/grades?course_id=${MATE}`, { token: T.CAMILA });
      assert.deepEqual(db.calls.map((c) => c.params[1]), [MATE, MATE]);
      db.calls.length = 0;
      await json('/v1/me/grades', { token: T.CAMILA });
      assert.deepEqual(db.calls.map((c) => c.params[1]), [null, null]);
    });

    test('course_id que no es UUID -> 400, sin consultar la base', async () => {
      const p = await problem('/v1/me/grades?course_id=mate', { token: T.CAMILA }, 400);
      assert.match(p.type, /validation-error$/);
      assert.equal(db.calls.length, 0);
    });

    test('docente y admin -> 403 (es solo de estudiantes); sin token -> 401', async () => {
      await problem('/v1/me/grades', { token: T.ANA }, 403);
      await problem('/v1/me/grades', { token: T.MARTA }, 403);
      await problem('/v1/me/grades', {}, 401);
      assert.equal(db.calls.length, 0);
    });
  });

  describe('GET /v1/me/grades/{assessmentId} (detalle de una evaluación rendida)', () => {
    test('nota + respuestas con retroalimentación', async () => {
      db.handlers.set(Q.NOTA_ESTUDIANTE_EVALUACION, () => [{ evaluacion_id: FRACCIONES, evaluacion: 'Fracciones', puntaje: 75, nota: 5.2, ponderacion: 1, fecha_envio: '2026-10-01T12:00:00.000Z', exigencia: 60 }]);
      db.handlers.set(Q.DETALLE_NOTA, () => [
        { orden: 1, enunciado: '¿Cuánto es 1/2 + 1/4?', respuesta_elegida: '3/4', es_correcta: true, retroalimentacion: 'Bien: se igualan los denominadores.' },
        { orden: 2, enunciado: '¿Qué indica el denominador?', respuesta_elegida: 'Las partes que se toman', es_correcta: false, retroalimentacion: 'Indica en cuántas partes se divide el todo.' },
      ]);
      const body = await json(`/v1/me/grades/${FRACCIONES}`, { token: T.CAMILA });
      assert.equal(body.grade, 5.2);
      assert.equal(body.pass_threshold, 60);
      assert.deepEqual(body.answers[1], { order: 2, question: '¿Qué indica el denominador?', selected_option: 'Las partes que se toman', correct: false, feedback: 'Indica en cuántas partes se divide el todo.' });
      assert.deepEqual(db.callsOf(Q.NOTA_ESTUDIANTE_EVALUACION)[0].params, [CAMILA.id, FRACCIONES]);
    });

    test('sin entrega (o evaluación ajena: la base no devuelve fila) -> 404 y no se pide el detalle', async () => {
      db.handlers.set(Q.NOTA_ESTUDIANTE_EVALUACION, () => []);
      await problem(`/v1/me/grades/${FRACCIONES}`, { token: T.CAMILA }, 404);
      assert.equal(db.callsOf(Q.DETALLE_NOTA).length, 0);
    });

    test('id que no es UUID -> 400; docente -> 403', async () => {
      await problem('/v1/me/grades/fracciones', { token: T.CAMILA }, 400);
      await problem(`/v1/me/grades/${FRACCIONES}`, { token: T.ANA }, 403);
    });
  });

  describe('GET /v1/courses/{id}/gradebook (libro de notas)', () => {
    const evaluaciones = [{ id: FRACCIONES, titulo: 'Fracciones', estado: 'cerrada', exigencia: 60, ponderacion: 1, fecha_publicacion: '2026-09-25T12:00:00.000Z' }];
    const filas = [
      { estudiante_id: CAMILA.id, nombre: 'Camila Díaz', promedio: 5.2, evaluacion_id: FRACCIONES, nota: 5.2 },
      { estudiante_id: SOFIA.id, nombre: 'Sofía Muñoz', promedio: 6.5, evaluacion_id: FRACCIONES, nota: 6.5 },
      { estudiante_id: 'e0000000-0000-0000-0000-000000000004', nombre: 'Tomás Vera', promedio: null, evaluacion_id: null, nota: null },
    ];

    test('el docente del curso ve una fila por estudiante y el promedio del curso (sin contar a quien no tiene notas)', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate());
      db.handlers.set(Q.LIBRO_NOTAS_EVALUACIONES, () => evaluaciones);
      db.handlers.set(Q.LIBRO_NOTAS_ESTUDIANTES, () => filas);
      const body = await json(`/v1/courses/${MATE}/gradebook`, { token: T.ANA });
      assert.equal(body.students.length, 3);
      assert.deepEqual(body.students[0], { student_id: CAMILA.id, name: 'Camila Díaz', average: 5.2, grades: { [FRACCIONES]: 5.2 } });
      assert.deepEqual(body.students[2].grades, {});
      assert.equal(body.course_average, 5.9); // (5.2 + 6.5) / 2 = 5.85 -> 5.9
      assert.deepEqual(body.assessments[0], { id: FRACCIONES, title: 'Fracciones', status: 'cerrada', pass_threshold: 60, weight: 1, published_at: '2026-09-25T12:00:00.000Z' });
    });

    test('sin ninguna nota, el promedio del curso es null', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate());
      db.handlers.set(Q.LIBRO_NOTAS_EVALUACIONES, () => []);
      db.handlers.set(Q.LIBRO_NOTAS_ESTUDIANTES, () => [filas[2]]);
      assert.equal((await json(`/v1/courses/${MATE}/gradebook`, { token: T.ANA })).course_average, null);
    });

    test('el admin del colegio también; estudiante matriculado y docente de otro curso -> 403', async () => {
      db.handlers.set(Q.CURSO_ACCESO, (_p, session) => cursoMate(session.rol === 'estudiante'));
      db.handlers.set(Q.LIBRO_NOTAS_EVALUACIONES, () => []);
      db.handlers.set(Q.LIBRO_NOTAS_ESTUDIANTES, () => []);
      await json(`/v1/courses/${MATE}/gradebook`, { token: T.MARTA });
      await problem(`/v1/courses/${MATE}/gradebook`, { token: T.CAMILA }, 403);
      await problem(`/v1/courses/${MATE}/gradebook`, { token: T.LUIS }, 403);
      // Los 403 se deciden antes de leer notas: solo la consulta de acceso.
      assert.equal(db.callsOf(Q.LIBRO_NOTAS_ESTUDIANTES).length, 1);
    });

    test('curso que la base no muestra (otro colegio, RLS) -> 404', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => []);
      await problem(`/v1/courses/${MATE}/gradebook`, { token: T.ANA }, 404);
    });
  });

  describe('GET /v1/courses/{id}/grades/summary', () => {
    const setUp = () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate());
      db.handlers.set(Q.RESUMEN_NOTAS_CURSO, () => [
        { evaluacion_id: FRACCIONES, titulo: 'Fracciones', estado: 'cerrada', entregas: 3, promedio: 5.1, nota_minima: 3.2, nota_maxima: 6.5, aprobados: 2, reprobados: 1 },
        { evaluacion_id: DECIMALES, titulo: 'Números decimales', estado: 'publicada', entregas: 5, promedio: 5.5, nota_minima: 4, nota_maxima: 7, aprobados: 5, reprobados: 0 },
      ]);
      db.handlers.set(Q.MATRICULADOS_ACTIVOS, () => [{ total: 4 }]);
      db.handlers.set(Q.ESTUDIANTES_EN_RIESGO, () => [{ estudiante_id: SOFIA.id, nombre: 'Sofía Muñoz', promedio: 3.2, evaluaciones_rendidas: 1 }]);
    };

    test('pendientes = matriculados − entregas (nunca negativo) y umbral 4,0 por defecto', async () => {
      setUp();
      const body = await json(`/v1/courses/${MATE}/grades/summary`, { token: T.ANA });
      assert.equal(body.enrolled_students, 4);
      assert.equal(body.assessments[0].pending, 1);
      assert.equal(body.assessments[1].pending, 0); // 5 entregas con 4 matriculados (alguien se retiró)
      assert.equal(body.at_risk_threshold, 4);
      assert.deepEqual(db.callsOf(Q.ESTUDIANTES_EN_RIESGO)[0].params, [MATE, 4]);
      assert.deepEqual(body.at_risk[0], { student_id: SOFIA.id, name: 'Sofía Muñoz', average: 3.2, assessments_taken: 1 });
    });

    test('threshold propio se pasa a la base; fuera de 1,0–7,0 o no numérico -> 400', async () => {
      setUp();
      await json(`/v1/courses/${MATE}/grades/summary?threshold=5.5`, { token: T.ANA });
      assert.deepEqual(db.callsOf(Q.ESTUDIANTES_EN_RIESGO)[0].params, [MATE, 5.5]);
      for (const bad of ['0.9', '7.1', 'abc', '']) {
        await problem(`/v1/courses/${MATE}/grades/summary?threshold=${bad}`, { token: T.ANA }, 400);
      }
    });

    test('estudiante -> 403', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate(true));
      await problem(`/v1/courses/${MATE}/grades/summary`, { token: T.CAMILA }, 403);
    });
  });

  describe('GET /v1/courses/{id}/students/{studentId}/grades', () => {
    const notas = [{ curso_id: MATE, evaluacion_id: FRACCIONES, evaluacion: 'Fracciones', puntaje: 75, nota: 5.2, ponderacion: 1, fecha_envio: '2026-10-01T12:00:00.000Z', promedio_curso: 5.2 }];

    test('el propio estudiante (matriculado) ve sus notas', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate(true));
      db.handlers.set(Q.NOTAS_ESTUDIANTE, () => notas);
      const body = await json(`/v1/courses/${MATE}/students/${CAMILA.id}/grades`, { token: T.CAMILA });
      assert.equal(body.average, 5.2);
      assert.equal(body.grades.length, 1);
      assert.deepEqual(db.callsOf(Q.NOTAS_ESTUDIANTE)[0].params, [CAMILA.id, MATE]);
    });

    test('un estudiante NO ve las notas de otro (403), ni las suyas en un curso donde ya no está matriculado', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate(true));
      await problem(`/v1/courses/${MATE}/students/${SOFIA.id}/grades`, { token: T.CAMILA }, 403);
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate(false));
      await problem(`/v1/courses/${MATE}/students/${CAMILA.id}/grades`, { token: T.CAMILA }, 403);
      assert.equal(db.callsOf(Q.NOTAS_ESTUDIANTE).length, 0);
    });

    test('el docente del curso ve las de cualquier estudiante; otro docente -> 403', async () => {
      db.handlers.set(Q.CURSO_ACCESO, () => cursoMate());
      db.handlers.set(Q.NOTAS_ESTUDIANTE, () => []);
      const body = await json(`/v1/courses/${MATE}/students/${SOFIA.id}/grades`, { token: T.ANA });
      assert.equal(body.average, null);
      await problem(`/v1/courses/${MATE}/students/${SOFIA.id}/grades`, { token: T.LUIS }, 403);
    });

    test('studentId que no es UUID -> 400', async () => {
      await problem(`/v1/courses/${MATE}/students/sofia/grades`, { token: T.ANA }, 400);
    });
  });

  describe('GET /v1/assessments/{id}/results', () => {
    const evaluacion = () => [{ id: FRACCIONES, curso_id: MATE, titulo: 'Fracciones', estado: 'cerrada', exigencia: 60, ponderacion: 1, docente_id: ANA.id }];

    test('resumen, acierto por pregunta redondeado a 3 decimales y filtro por estudiante', async () => {
      db.handlers.set(Q.EVALUACION_ACCESO, evaluacion);
      db.handlers.set(Q.RESULTADOS_EVALUACION_RESUMEN, () => [{ entregas: 3, puntaje_promedio: 66.7, nota_promedio: 4.8 }]);
      db.handlers.set(Q.ACIERTO_POR_PREGUNTA, () => [{ pregunta_id: 'p1', orden: 1, respuestas: 3, tasa_acierto: 2 / 3 }]);
      db.handlers.set(Q.RESULTADOS_EVALUACION_ESTUDIANTES, () => [{ estudiante_id: CAMILA.id, nombre: 'Camila Díaz', puntaje: 75, nota: 5.2, fecha_envio: '2026-10-01T12:00:00.000Z' }]);
      const body = await json(`/v1/assessments/${FRACCIONES}/results?student_id=${CAMILA.id}`, { token: T.ANA });
      assert.equal(body.submissions_count, 3);
      assert.equal(body.questions[0].correct_rate, 0.667);
      assert.deepEqual(db.callsOf(Q.RESULTADOS_EVALUACION_ESTUDIANTES)[0].params, [FRACCIONES, CAMILA.id]);
    });

    test('evaluación que no existe en el colegio -> 404; estudiante y otro docente -> 403', async () => {
      db.handlers.set(Q.EVALUACION_ACCESO, () => []);
      await problem(`/v1/assessments/${FRACCIONES}/results`, { token: T.ANA }, 404);
      db.handlers.set(Q.EVALUACION_ACCESO, evaluacion);
      await problem(`/v1/assessments/${FRACCIONES}/results`, { token: T.CAMILA }, 403);
      await problem(`/v1/assessments/${FRACCIONES}/results`, { token: T.LUIS }, 403);
      assert.equal(db.callsOf(Q.RESULTADOS_EVALUACION_RESUMEN).length, 0);
    });
  });

  describe('PATCH /v1/assessments/{id}/grading (exigencia y ponderación)', () => {
    const patch = (body, token = T.ANA) => ({ method: 'PATCH', body, token });
    const setUp = () => {
      db.handlers.set(Q.EVALUACION_ACCESO, () => [{ id: FRACCIONES, titulo: 'Fracciones', docente_id: ANA.id }]);
      db.handlers.set(Q.ACTUALIZAR_CALIFICACION, ([, exigencia, ponderacion]) => [{ id: FRACCIONES, titulo: 'Fracciones', exigencia: exigencia ?? 60, ponderacion: ponderacion ?? 1 }]);
    };

    test('el docente cambia la exigencia: escribe (no es solo lectura) y lo que no se envía va como null', async () => {
      setUp();
      const body = await json(`/v1/assessments/${FRACCIONES}/grading`, patch({ pass_threshold: 50 }));
      assert.deepEqual(body, { assessment_id: FRACCIONES, title: 'Fracciones', pass_threshold: 50, weight: 1 });
      const call = db.callsOf(Q.ACTUALIZAR_CALIFICACION)[0];
      assert.deepEqual(call.params, [FRACCIONES, 50, null]);
      assert.equal(call.readOnly, false);
    });

    test('valores inválidos -> 400 sin tocar la base', async () => {
      setUp();
      for (const body of [{}, { pass_threshold: 0 }, { pass_threshold: 100 }, { pass_threshold: '60' }, { weight: 0 }, { weight: -1 }, { weight: 1000 }, { weight: '2' }]) {
        await problem(`/v1/assessments/${FRACCIONES}/grading`, patch(body), 400);
      }
      assert.equal(db.calls.length, 0);
    });

    test('estudiante y docente de otro curso -> 403, sin actualizar', async () => {
      setUp();
      await problem(`/v1/assessments/${FRACCIONES}/grading`, patch({ weight: 2 }, T.CAMILA), 403);
      await problem(`/v1/assessments/${FRACCIONES}/grading`, patch({ weight: 2 }, T.LUIS), 403);
      assert.equal(db.callsOf(Q.ACTUALIZAR_CALIFICACION).length, 0);
    });
  });
});
