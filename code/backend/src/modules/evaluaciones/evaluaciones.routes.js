import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { withIdempotency } from '../../platform/idempotency.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import { cursoVisible, esStaffDelCurso } from '../cursos/acceso-curso.js';
import * as Q from '../../../db/queries.js';

const MAX_PREGUNTAS = 100;
const MAX_ENUNCIADO = 1000;
const MAX_ALTERNATIVA = 300;
const MAX_RETRO = 1000;

const forbidden = (detail) => new HttpProblem(403, 'Prohibido', detail, 'forbidden');
const notFound = (what) => new HttpProblem(404, 'No encontrado', `${what} no existe o no es visible`, 'not-found');
const conflict = (detail) => new HttpProblem(409, 'Conflicto', detail, 'conflict');

/** estado de la base -> status del contrato. */
const STATUS = { borrador: 'draft', publicada: 'published', cerrada: 'closed' };

// ---------------------------------------------------------------- validación (H2)

/** Cuerpo de POST /v1/courses/{id}/assessments (schema AssessmentInput) -> datos limpios, o 400. */
export function leerEvaluacion(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (title.length < 3 || title.length > 150) throw invalid('"title" debe ser un texto de 3 a 150 caracteres');
  if (body.max_attempts !== undefined && body.max_attempts !== 1) throw invalid('"max_attempts" solo puede ser 1 (un intento por evaluación)');

  let closesAt = null;
  if (body.closes_at !== undefined && body.closes_at !== null) {
    const fecha = typeof body.closes_at === 'string' ? new Date(body.closes_at) : null;
    if (!fecha || Number.isNaN(fecha.getTime()) || fecha.getTime() <= Date.now()) throw invalid('"closes_at" debe ser una fecha y hora futuras (ISO 8601)');
    closesAt = fecha.toISOString();
  }

  const preguntas = body.questions;
  if (!Array.isArray(preguntas) || preguntas.length < 1 || preguntas.length > MAX_PREGUNTAS) {
    throw invalid(`"questions" debe tener de 1 a ${MAX_PREGUNTAS} preguntas`);
  }
  const questions = preguntas.map((q, i) => {
    const en = `questions[${i}]`;
    const statement = typeof q?.statement === 'string' ? q.statement.trim() : '';
    if (statement.length < 3 || statement.length > MAX_ENUNCIADO) throw invalid(`${en}.statement debe ser un texto de 3 a ${MAX_ENUNCIADO} caracteres`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) throw invalid(`${en}.options debe tener de 2 a 6 alternativas`);
    const options = q.options.map((o, j) => {
      const texto = typeof o === 'string' ? o.trim() : '';
      if (!texto || texto.length > MAX_ALTERNATIVA) throw invalid(`${en}.options[${j}] debe ser un texto de 1 a ${MAX_ALTERNATIVA} caracteres`);
      return texto;
    });
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw invalid(`${en}.options tiene alternativas repetidas`);
    const correct = q.correct_option ?? null;
    if (correct !== null && !(Number.isInteger(correct) && correct >= 0 && correct < options.length)) {
      throw invalid(`${en}.correct_option debe ser el índice (desde 0) de una de las alternativas`);
    }
    if (q.feedback !== undefined && q.feedback !== null && (typeof q.feedback !== 'string' || q.feedback.length > MAX_RETRO)) {
      throw invalid(`${en}.feedback debe ser un texto de hasta ${MAX_RETRO} caracteres`);
    }
    return { statement, options, correct, feedback: q.feedback?.trim() || null };
  });
  return { title, closesAt, questions };
}

// ---------------------------------------------------------------- lectura

/** Evaluación completa para el docente/admin, con la alternativa correcta de cada pregunta (schema Assessment). */
async function evaluacionParaDocente(c, ev) {
  const preguntas = (await c.query(Q.PREGUNTAS_PARA_DOCENTE, [ev.id])).rows;
  return {
    id: ev.id,
    course_id: ev.curso_id,
    title: ev.titulo,
    status: STATUS[ev.estado],
    max_attempts: 1,
    published_at: ev.fecha_publicacion ?? null,
    closes_at: ev.fecha_cierre ?? null,
    questions: preguntas.map((p) => {
      const correct = p.alternativas.findIndex((a) => a.es_correcta);
      return {
        id: p.id,
        statement: p.enunciado,
        options: p.alternativas.map((a) => a.texto),
        correct_option: correct === -1 ? null : correct,
        feedback: p.retroalimentacion ?? '',
      };
    }),
  };
}

/** Evaluación para el estudiante: SIN las alternativas correctas ni la retroalimentación (vista alternativas_publicas). */
async function evaluacionParaEstudiante(c, ev) {
  const preguntas = (await c.query(Q.PREGUNTAS_PARA_RENDIR, [ev.id])).rows;
  return {
    id: ev.id,
    course_id: ev.curso_id,
    title: ev.titulo,
    status: STATUS[ev.estado],
    max_attempts: 1,
    published_at: ev.fecha_publicacion ?? null,
    closes_at: ev.fecha_cierre ?? null,
    questions: preguntas.map((p) => ({ id: p.id, statement: p.enunciado, options: p.alternativas.map((a) => a.texto) })),
  };
}

/**
 * Evaluaciones (H2 crear y publicar, H3 ver, H4 rendir). Requiere req.user (requireAuth).
 *   404 -> la evaluación o el curso no existen en tu colegio, o no participas en él (o es un borrador y eres estudiante);
 *   403 -> participas, pero tu rol no permite la acción.
 * Los POST llevan Idempotency-Key (platform/idempotency.js). Lo que el estudiante nunca recibe: la alternativa
 * correcta antes de rendir ni las retroalimentaciones de una evaluación que no ha entregado.
 */
export function createEvaluacionesRouter({ db }) {
  const router = Router();
  const read = (user, fn) => db.withUser(user, fn, { readOnly: true });

  /** La evaluación, o 404. */
  async function cargarEvaluacion(c, assessmentId) {
    const ev = (await c.query(Q.EVALUACION_ACCESO, [assessmentId])).rows[0];
    if (!ev) throw notFound('La evaluación');
    return ev;
  }

  // H2 · Crear una evaluación en borrador con sus preguntas, alternativas y retroalimentación.
  router.post('/v1/courses/:courseId/assessments', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const input = leerEvaluacion(req.body);
    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const curso = await cursoVisible(c, req.user, courseId);
        if (!esStaffDelCurso(req.user, curso)) throw forbidden('Solo el docente del curso o el administrador crean evaluaciones');
        const { id } = (await c.query(Q.CREAR_EVALUACION, [courseId, input.title, input.closesAt])).rows[0];
        for (const [i, q] of input.questions.entries()) {
          const pregunta = (await c.query(Q.CREAR_PREGUNTA, [id, q.statement, i + 1, q.feedback])).rows[0];
          for (const [j, texto] of q.options.entries()) {
            await c.query(Q.CREAR_ALTERNATIVA, [pregunta.id, texto, j === q.correct, j]);
          }
        }
        const ev = await cargarEvaluacion(c, id);
        return { status: 201, body: await evaluacionParaDocente(c, ev) };
      },
    });
  });

  // Evaluaciones de un curso. Docente/admin: todas (con borradores y cuántos entregaron). Estudiante matriculado:
  // solo las publicadas y cerradas, con su nota si ya la rindió.
  router.get('/v1/courses/:courseId/assessments', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const body = await read(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      if (esStaffDelCurso(req.user, curso)) {
        const rows = (await c.query(Q.EVALUACIONES_DEL_CURSO, [courseId])).rows;
        return {
          data: rows.map((e) => ({
            id: e.id, title: e.titulo, status: STATUS[e.estado], questions_count: e.preguntas, submissions_count: e.entregas,
            published_at: e.fecha_publicacion, closes_at: e.fecha_cierre,
          })),
        };
      }
      // Otro docente o admin sin permiso: 403 (participa del colegio). Estudiante sin matrícula: 404.
      if (req.user.rol !== 'estudiante') throw forbidden('Solo el docente del curso, el administrador o sus estudiantes ven las evaluaciones');
      if (!curso.matriculado) throw notFound('El curso');
      const rows = (await c.query(Q.EVALUACIONES_PARA_ESTUDIANTE, [courseId, req.user.id])).rows;
      return {
        data: rows.map((e) => ({
          id: e.id, title: e.titulo, status: STATUS[e.estado], questions_count: e.preguntas,
          published_at: e.fecha_publicacion, closes_at: e.fecha_cierre,
          submitted: e.entregada_at !== null, grade: e.nota ?? null, score: e.puntaje ?? null, submitted_at: e.entregada_at ?? null,
        })),
      };
    });
    res.json(body);
  });

  // Una evaluación. Docente/admin: completa, con la alternativa correcta. Estudiante matriculado: solo si está
  // publicada, sin la alternativa correcta ni la retroalimentación (eso llega al enviar).
  router.get('/v1/assessments/:assessmentId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const body = await read(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      const curso = await cursoVisible(c, req.user, ev.curso_id);
      if (esStaffDelCurso(req.user, ev)) return evaluacionParaDocente(c, ev);
      if (req.user.rol !== 'estudiante') throw forbidden('Solo el docente del curso, el administrador o sus estudiantes ven esta evaluación');
      if (!curso.matriculado || ev.estado === 'borrador') throw notFound('La evaluación');
      return evaluacionParaEstudiante(c, ev);
    });
    res.json(body);
  });

  // H2 · Publicar o cerrar. No se publica si alguna pregunta no tiene alternativa correcta (422, con cuáles).
  router.patch('/v1/assessments/:assessmentId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const status = req.body?.status;
    if (status !== 'published' && status !== 'closed') throw invalid('"status" debe ser "published" o "closed"');

    const body = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden('Solo el docente del curso o el administrador publican evaluaciones');

      if (status === 'published') {
        const sinCorrecta = (await c.query(Q.PREGUNTAS_SIN_CORRECTA, [assessmentId])).rows;
        if (sinCorrecta.length > 0) {
          const nums = sinCorrecta.map((p) => p.orden).join(', ');
          throw new HttpProblem(422, 'Datos inválidos', `No se puede publicar: la pregunta ${nums} no tiene respuesta correcta.`, 'validation-error', {
            errors: sinCorrecta.map((p) => ({ field: `questions[${p.orden - 1}].correct_option`, message: 'Requerido para publicar.' })),
          });
        }
        if (ev.estado !== 'borrador') throw conflict('Solo una evaluación en borrador se puede publicar');
        await c.query(Q.PUBLICAR_EVALUACION, [assessmentId]);
      } else {
        if (ev.estado !== 'publicada') throw conflict('Solo una evaluación publicada se puede cerrar');
        await c.query(Q.CERRAR_EVALUACION, [assessmentId]);
      }
      return evaluacionParaDocente(c, await cargarEvaluacion(c, assessmentId));
    });
    res.json(body);
  });

  // H4 · El estudiante envía sus respuestas y recibe puntaje, nota y retroalimentación al instante.
  router.post('/v1/assessments/:assessmentId/submissions', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    if (req.user.rol !== 'estudiante') throw forbidden('Solo los estudiantes rinden evaluaciones');
    const respuestas = leerRespuestas(req.body);

    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const ev = await cargarEvaluacion(c, assessmentId);
        const curso = await cursoVisible(c, req.user, ev.curso_id);
        // Sin matrícula activa o borrador: para este estudiante la evaluación no existe.
        if (!curso.matriculado || ev.estado === 'borrador') throw notFound('La evaluación');
        if (ev.estado === 'cerrada') throw conflict('La evaluación ya está cerrada');

        const previo = (await c.query(Q.INTENTO_DEL_ESTUDIANTE, [assessmentId, req.user.id])).rows[0];
        if (previo) throw await yaRendida(c, req.user, assessmentId);

        const preguntas = (await c.query(Q.PREGUNTAS_PARA_RENDIR, [assessmentId])).rows;
        const elegidas = resolverRespuestas(preguntas, respuestas);

        const intento = (await c.query(Q.CREAR_INTENTO, [assessmentId, req.user.id])).rows[0];
        // Publicada pero vencida (fecha_cierre pasó): la base no abre el intento.
        if (!intento) throw conflict('El plazo de esta evaluación ya terminó');

        const answers = [];
        for (const p of preguntas) {
          const r = (await c.query(Q.INSERTAR_RESPUESTA, [intento.id, p.id, elegidas.get(p.id) ?? null])).rows[0];
          if (!r) throw conflict('La evaluación ya no recibe respuestas');
          answers.push({ question_id: p.id, correct: r.es_correcta, feedback: r.retroalimentacion ?? '' });
        }
        const enviado = (await c.query(Q.ENVIAR_INTENTO, [intento.id])).rows[0];
        const nota = (await c.query(Q.NOTA_ESTUDIANTE_EVALUACION, [req.user.id, assessmentId])).rows[0];
        return {
          status: 201,
          body: {
            id: intento.id,
            assessment_id: assessmentId,
            score: answers.filter((a) => a.correct).length,
            max_score: preguntas.length,
            percentage: enviado.puntaje,
            grade: nota?.nota ?? null,
            answers,
            submitted_at: enviado.fecha_envio,
          },
        };
      },
    });
  });

  return router;
}

/** Cuerpo de submissions (schema SubmissionInput) -> [{ question_id, selected_option }], o 400. */
function leerRespuestas(body) {
  const answers = body?.answers;
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > MAX_PREGUNTAS) {
    throw invalid(`"answers" debe tener de 1 a ${MAX_PREGUNTAS} respuestas`);
  }
  const vistas = new Set();
  return answers.map((a, i) => {
    const questionId = uuidParam(a?.question_id, `answers[${i}].question_id`);
    if (!Number.isInteger(a.selected_option) || a.selected_option < 0) throw invalid(`answers[${i}].selected_option debe ser el índice (desde 0) de la alternativa elegida`);
    if (vistas.has(questionId)) throw invalid(`answers[${i}]: la pregunta ya fue respondida en este envío`);
    vistas.add(questionId);
    return { questionId, selected: a.selected_option };
  });
}

/** Índices -> id de la alternativa, según el MISMO orden que vio el estudiante. 422 si la pregunta o la alternativa no existen. */
function resolverRespuestas(preguntas, respuestas) {
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const elegidas = new Map();
  for (const { questionId, selected } of respuestas) {
    const pregunta = porId.get(questionId);
    if (!pregunta) throw new HttpProblem(422, 'Datos inválidos', 'Una de las respuestas es de una pregunta que no pertenece a esta evaluación', 'validation-error');
    const alternativa = pregunta.alternativas[selected];
    if (!alternativa) throw new HttpProblem(422, 'Datos inválidos', `La pregunta ${pregunta.orden} no tiene una alternativa ${selected + 1}`, 'validation-error');
    elegidas.set(questionId, alternativa.id);
  }
  return elegidas;
}

/** 409 de «ya la rendiste», con el resultado anterior en `detail` (contrato: submitAssessment). */
async function yaRendida(c, user, assessmentId) {
  const nota = (await c.query(Q.NOTA_ESTUDIANTE_EVALUACION, [user.id, assessmentId])).rows[0];
  const detalle = nota ? ` Tu resultado anterior: ${nota.puntaje}% de logro, nota ${String(nota.nota).replace('.', ',')}.` : '';
  return conflict(`Ya rendiste esta evaluación: solo se permite un intento.${detalle}`);
}
