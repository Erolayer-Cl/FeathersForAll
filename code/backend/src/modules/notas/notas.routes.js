import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import { cursoVisible, esStaffDelCurso } from '../cursos/acceso-curso.js';
import * as Q from '../../../db/queries.js';

const NOTA_APROBACION = 4.0;

const notFound = (what) => new HttpProblem(404, 'No encontrado', `${what} no existe o no es visible`, 'not-found');
const forbidden = () => new HttpProblem(403, 'Sin permiso', 'Tu rol no puede ver estas notas', 'forbidden');

async function evaluacionVisible(client, assessmentId) {
  const ev = (await client.query(Q.EVALUACION_ACCESO, [assessmentId])).rows[0];
  if (!ev) throw notFound('La evaluación');
  return ev;
}

const gradeRow = (r) => ({
  assessment_id: r.evaluacion_id,
  title: r.evaluacion,
  score: r.puntaje,
  grade: r.nota,
  weight: r.ponderacion,
  submitted_at: r.fecha_envio,
});

/**
 * Notas en escala chilena 1.0–7.0 (ver db/03_notas.sql). Todas las rutas
 * requieren req.user (requireAuth) y corren en una transacción de solo lectura
 * con el colegio del token, salvo el PATCH.
 */
export function createNotasRouter({ db }) {
  const router = Router();
  const read = (user, fn) => db.withUser(user, fn, { readOnly: true });

  // Mis ramos y mis notas (solo lectura): TODAS las asignaturas con matrícula activa, tengan o no
  // notas todavía, con el promedio ponderado de cada una y si el tutor tiene apuntes del curso.
  router.get('/v1/me/grades', async (req, res) => {
    if (req.user.rol !== 'estudiante') throw forbidden();
    const courseId = uuidParam(req.query.course_id, 'course_id', { optional: true });

    const { ramos, notas } = await read(req.user, async (c) => ({
      ramos: (await c.query(Q.RAMOS_ESTUDIANTE, [req.user.id, courseId])).rows,
      notas: (await c.query(Q.NOTAS_ESTUDIANTE, [req.user.id, courseId])).rows,
    }));

    const notasPorCurso = Map.groupBy(notas, (n) => n.curso_id);
    const courses = ramos.map((r) => {
      const delRamo = notasPorCurso.get(r.curso_id) ?? [];
      return {
        course_id: r.curso_id,
        course: r.curso,
        subject: r.asignatura,
        period: r.periodo,
        teacher_name: r.docente,
        tutor_available: r.tutor_disponible,
        // Ponderado por la ponderación de cada evaluación; null si aún no hay notas.
        average: delRamo[0]?.promedio_curso ?? null,
        grades: delRamo.map(gradeRow),
      };
    });
    res.json({ student_id: req.user.id, courses });
  });

  // Detalle de una evaluación ya entregada: qué respondí, si estaba bien y la retroalimentación.
  router.get('/v1/me/grades/:assessmentId', async (req, res) => {
    if (req.user.rol !== 'estudiante') throw forbidden();
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');

    const body = await read(req.user, async (c) => {
      const nota = (await c.query(Q.NOTA_ESTUDIANTE_EVALUACION, [req.user.id, assessmentId])).rows[0];
      if (!nota) throw notFound('La entrega');
      const detalle = (await c.query(Q.DETALLE_NOTA, [req.user.id, assessmentId])).rows;
      return {
        ...gradeRow(nota),
        pass_threshold: nota.exigencia,
        answers: detalle.map((d) => ({
          order: d.orden,
          question: d.enunciado,
          selected_option: d.respuesta_elegida,
          correct: d.es_correcta,
          feedback: d.retroalimentacion,
        })),
      };
    });
    res.json(body);
  });

  // Libro de notas del curso: columnas = evaluaciones, filas = estudiantes activos.
  router.get('/v1/courses/:courseId/gradebook', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');

    const body = await read(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      if (!esStaffDelCurso(req.user, curso)) throw forbidden();

      const evaluaciones = (await c.query(Q.LIBRO_NOTAS_EVALUACIONES, [courseId])).rows;
      const filas = (await c.query(Q.LIBRO_NOTAS_ESTUDIANTES, [courseId])).rows;

      const students = new Map();
      for (const f of filas) {
        if (!students.has(f.estudiante_id)) {
          students.set(f.estudiante_id, { student_id: f.estudiante_id, name: f.nombre, average: f.promedio, grades: {} });
        }
        if (f.evaluacion_id) students.get(f.estudiante_id).grades[f.evaluacion_id] = f.nota;
      }
      const promedios = [...students.values()].map((s) => s.average).filter((a) => a !== null);

      return {
        course_id: curso.id,
        course: curso.nombre,
        assessments: evaluaciones.map((e) => ({
          id: e.id,
          title: e.titulo,
          status: e.estado,
          pass_threshold: e.exigencia,
          weight: e.ponderacion,
          published_at: e.fecha_publicacion,
        })),
        students: [...students.values()],
        // Promedio simple de los promedios de cada estudiante, a un decimal.
        course_average: promedios.length
          ? Math.round((promedios.reduce((a, b) => a + b, 0) / promedios.length) * 10) / 10
          : null,
      };
    });
    res.json(body);
  });

  // Resumen rápido: estadísticas por evaluación + estudiantes en riesgo (promedio < umbral).
  router.get('/v1/courses/:courseId/grades/summary', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const threshold = req.query.threshold === undefined ? NOTA_APROBACION : Number(req.query.threshold);
    if (!(threshold >= 1 && threshold <= 7)) throw invalid('"threshold" debe ser una nota entre 1.0 y 7.0');

    const body = await read(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      if (!esStaffDelCurso(req.user, curso)) throw forbidden();

      const resumen = (await c.query(Q.RESUMEN_NOTAS_CURSO, [courseId])).rows;
      const matriculados = (await c.query(Q.MATRICULADOS_ACTIVOS, [courseId])).rows[0].total;
      const riesgo = (await c.query(Q.ESTUDIANTES_EN_RIESGO, [courseId, threshold])).rows;
      return {
        course_id: curso.id,
        course: curso.nombre,
        enrolled_students: matriculados,
        assessments: resumen.map((r) => ({
          assessment_id: r.evaluacion_id,
          title: r.titulo,
          status: r.estado,
          submissions: r.entregas,
          pending: Math.max(matriculados - r.entregas, 0),
          average: r.promedio,
          min: r.nota_minima,
          max: r.nota_maxima,
          passed: r.aprobados,
          failed: r.reprobados,
        })),
        at_risk_threshold: threshold,
        at_risk: riesgo.map((r) => ({
          student_id: r.estudiante_id,
          name: r.nombre,
          average: r.promedio,
          assessments_taken: r.evaluaciones_rendidas,
        })),
      };
    });
    res.json(body);
  });

  // Notas de un estudiante en un curso: para el docente/admin, o para el propio estudiante.
  router.get('/v1/courses/:courseId/students/:studentId/grades', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const studentId = uuidParam(req.params.studentId, 'studentId');

    const body = await read(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      const esElMismo = req.user.rol === 'estudiante' && req.user.id === studentId && curso.matriculado;
      if (!esElMismo && !esStaffDelCurso(req.user, curso)) throw forbidden();

      const rows = (await c.query(Q.NOTAS_ESTUDIANTE, [studentId, courseId])).rows;
      return {
        course_id: curso.id,
        course: curso.nombre,
        student_id: studentId,
        average: rows[0]?.promedio_curso ?? null,
        grades: rows.map(gradeRow),
      };
    });
    res.json(body);
  });

  // Dashboard de una evaluación (contrato S05: getAssessmentResults, H3).
  router.get('/v1/assessments/:assessmentId/results', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const studentId = uuidParam(req.query.student_id, 'student_id', { optional: true });

    const body = await read(req.user, async (c) => {
      const ev = await evaluacionVisible(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden();

      const resumen = (await c.query(Q.RESULTADOS_EVALUACION_RESUMEN, [assessmentId])).rows[0];
      const preguntas = (await c.query(Q.ACIERTO_POR_PREGUNTA, [assessmentId])).rows;
      const estudiantes = (await c.query(Q.RESULTADOS_EVALUACION_ESTUDIANTES, [assessmentId, studentId])).rows;
      return {
        assessment_id: ev.id,
        title: ev.titulo,
        submissions_count: resumen.entregas,
        average_score: resumen.puntaje_promedio,
        average_grade: resumen.nota_promedio,
        questions: preguntas.map((p) => ({
          question_id: p.pregunta_id,
          order: p.orden,
          answers: p.respuestas,
          correct_rate: Math.round(p.tasa_acierto * 1000) / 1000,
        })),
        students: estudiantes.map((e) => ({
          student_id: e.estudiante_id,
          name: e.nombre,
          score: e.puntaje,
          grade: e.nota,
          submitted_at: e.fecha_envio,
        })),
      };
    });
    res.json(body);
  });

  // Cambiar exigencia (% para el 4.0) o ponderación. Las notas se recalculan solas.
  router.patch('/v1/assessments/:assessmentId/grading', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const { pass_threshold: exigencia, weight: ponderacion } = req.body ?? {};
    if (exigencia === undefined && ponderacion === undefined) {
      throw invalid('Envía "pass_threshold" y/o "weight"');
    }
    if (exigencia !== undefined && !(typeof exigencia === 'number' && exigencia >= 1 && exigencia <= 99)) {
      throw invalid('"pass_threshold" debe ser un número entre 1 y 99 (% de logro para el 4.0)');
    }
    if (ponderacion !== undefined && !(typeof ponderacion === 'number' && ponderacion > 0 && ponderacion <= 999)) {
      throw invalid('"weight" debe ser un número mayor que 0');
    }

    const body = await db.withUser(req.user, async (c) => {
      const ev = await evaluacionVisible(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden();
      const r = (await c.query(Q.ACTUALIZAR_CALIFICACION, [assessmentId, exigencia ?? null, ponderacion ?? null])).rows[0];
      return { assessment_id: r.id, title: r.titulo, pass_threshold: r.exigencia, weight: r.ponderacion };
    });
    res.json(body);
  });

  return router;
}
