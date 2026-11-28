import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { withIdempotency } from '../../platform/idempotency.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import { cursoVisible, esStaffDelCurso } from '../cursos/acceso-curso.js';
import { createLoginLimiter } from '../../platform/login-limiter.js';
import * as Q from '../../../db/queries.js';
import { armarPrompt, leerBorradorIa, leerPedidoIa } from './generar-ia.js';

const MAX_PREGUNTAS = 100;
const MAX_ENUNCIADO = 1000;
const MAX_ALTERNATIVA = 300;
const MAX_RETRO = 1000;
const MAX_ACEPTADAS = 10;
const MAX_RESPUESTA_TEXTO = 1000;
// Tipos de pregunta: API (inglés) <-> base (preguntas.tipo, 11_preguntas_texto.sql).
const TIPO_API = { alternativas: 'multiple_choice', texto: 'text' };

const forbidden = (detail) => new HttpProblem(403, 'Prohibido', detail, 'forbidden');
const notFound = (what) => new HttpProblem(404, 'No encontrado', `${what} no existe o no es visible`, 'not-found');
const conflict = (detail) => new HttpProblem(409, 'Conflicto', detail, 'conflict');

/** estado de la base -> status del contrato. */
const STATUS = { borrador: 'draft', publicada: 'published', cerrada: 'closed' };

// ---------------------------------------------------------------- validación (H2)

const MAX_DIAS_CIERRE = 366;
const MAX_DURACION_MIN = 600;

/** "duration_minutes": minutos que tiene cada estudiante desde que empieza (v1.12). null/ausente = sin límite propio. */
export function leerDuracion(valor) {
  if (valor === undefined || valor === null) return null;
  if (!Number.isInteger(valor) || valor < 1 || valor > MAX_DURACION_MIN) {
    throw invalid(`"duration_minutes" debe ser un entero de 1 a ${MAX_DURACION_MIN}, o null`);
  }
  return valor;
}

/**
 * "closes_at" de PATCH: undefined (no viene), null (sin cierre automático) o una fecha futura ISO 8601 con zona
 * horaria, a menos de un año. Sirve tanto para "cierra el jueves a las 23:59" como para "cierra en 90 minutos"
 * (el portal calcula la hora y manda la fecha).
 */
export function leerCierre(valor) {
  if (valor === undefined || valor === null) return valor;
  const fecha = typeof valor === 'string' && /([zZ]|[+-]\d{2}:?\d{2})$/.test(valor) ? new Date(valor) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) throw invalid('"closes_at" debe ser una fecha y hora ISO 8601 con zona horaria, o null');
  if (fecha.getTime() <= Date.now()) throw invalid('"closes_at" debe ser una fecha y hora futuras');
  if (fecha.getTime() > Date.now() + MAX_DIAS_CIERRE * 864e5) throw invalid(`"closes_at" no puede estar a más de ${MAX_DIAS_CIERRE} días`);
  return fecha.toISOString();
}

/** Cuerpo de POST /v1/courses/{id}/assessments (schema AssessmentInput) -> datos limpios, o 400. */
export function leerEvaluacion(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (title.length < 3 || title.length > 150) throw invalid('"title" debe ser un texto de 3 a 150 caracteres');
  if (body.max_attempts !== undefined && body.max_attempts !== 1) throw invalid('"max_attempts" solo puede ser 1 (un intento por evaluación)');

  // Misma validación que PATCH (con zona horaria, futura y a menos de un año).
  const closesAt = leerCierre(body.closes_at) ?? null;

  const preguntas = body.questions;
  if (!Array.isArray(preguntas) || preguntas.length < 1 || preguntas.length > MAX_PREGUNTAS) {
    throw invalid(`"questions" debe tener de 1 a ${MAX_PREGUNTAS} preguntas`);
  }
  const questions = preguntas.map((q, i) => {
    const en = `questions[${i}]`;
    const statement = typeof q?.statement === 'string' ? q.statement.trim() : '';
    if (statement.length < 3 || statement.length > MAX_ENUNCIADO) throw invalid(`${en}.statement debe ser un texto de 3 a ${MAX_ENUNCIADO} caracteres`);
    const type = q.type ?? 'multiple_choice';
    if (type !== 'multiple_choice' && type !== 'text') throw invalid(`${en}.type debe ser "multiple_choice" o "text"`);
    if (q.feedback !== undefined && q.feedback !== null && (typeof q.feedback !== 'string' || q.feedback.length > MAX_RETRO)) {
      throw invalid(`${en}.feedback debe ser un texto de hasta ${MAX_RETRO} caracteres`);
    }
    if (type === 'text') return leerPreguntaTexto(q, en, statement);
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
    return { type, statement, options, correct, accepted: null, feedback: q.feedback?.trim() || null };
  });
  return { title, closesAt, durationMin: leerDuracion(body.duration_minutes), questions };
}

/**
 * Pregunta de respuesta escrita (v1.10): sin alternativas; `accepted_answers` = 1 a 10 respuestas que se dan por
 * correctas (la base compara sin mayúsculas, tildes ni puntuación final, y los números por valor). Un borrador puede
 * no tenerlas todavía; publicar las exige (422), como la alternativa correcta.
 */
function leerPreguntaTexto(q, en, statement) {
  if (q.options !== undefined && !(Array.isArray(q.options) && q.options.length === 0)) throw invalid(`${en}.options no va en una pregunta de texto`);
  if (q.correct_option !== undefined && q.correct_option !== null) throw invalid(`${en}.correct_option no va en una pregunta de texto: usa accepted_answers`);
  const lista = q.accepted_answers ?? [];
  if (!Array.isArray(lista) || lista.length > MAX_ACEPTADAS) throw invalid(`${en}.accepted_answers debe ser una lista de hasta ${MAX_ACEPTADAS} respuestas`);
  const accepted = lista.map((r, j) => {
    const texto = typeof r === 'string' ? r.trim() : '';
    if (!texto || texto.length > MAX_ALTERNATIVA) throw invalid(`${en}.accepted_answers[${j}] debe ser un texto de 1 a ${MAX_ALTERNATIVA} caracteres`);
    return texto;
  });
  if (new Set(accepted.map((r) => r.toLowerCase())).size !== accepted.length) throw invalid(`${en}.accepted_answers tiene respuestas repetidas`);
  return { type: 'text', statement, options: [], correct: null, accepted: accepted.length ? accepted : null, feedback: q.feedback?.trim() || null };
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
    duration_minutes: ev.duracion_min ?? null,
    questions: preguntas.map((p) => {
      const correct = p.alternativas.findIndex((a) => a.es_correcta);
      return {
        id: p.id,
        type: TIPO_API[p.tipo] ?? 'multiple_choice',
        statement: p.enunciado,
        options: p.alternativas.map((a) => a.texto),
        correct_option: correct === -1 ? null : correct,
        ...(p.tipo === 'texto' && { accepted_answers: p.respuestas_aceptadas ?? [] }),
        feedback: p.retroalimentacion ?? '',
      };
    }),
  };
}

/** Intento del estudiante -> schema AttemptInfo (v1.12). deadline: inicio + duración o el cierre, lo que llegue primero. */
const toAttempt = (i) => (i ? { id: i.id, started_at: i.fecha_inicio, deadline: i.plazo ?? null, submitted: i.fecha_envio !== null } : null);

/**
 * Evaluación para el estudiante: SIN las alternativas correctas ni la retroalimentación (vista alternativas_publicas).
 * Con duración por intento (v1.12), las preguntas solo llegan después de empezar: si no, el estudiante podría
 * leerlas con calma y empezar el reloj recién al saber las respuestas.
 */
async function evaluacionParaEstudiante(c, ev, user) {
  const intento = (await c.query(Q.INTENTO_DEL_ESTUDIANTE, [ev.id, user.id])).rows[0] ?? null;
  const ocultas = ev.duracion_min !== null && ev.duracion_min !== undefined && !intento;
  const preguntas = ocultas ? [] : (await c.query(Q.PREGUNTAS_PARA_RENDIR, [ev.id])).rows;
  const { now } = (await c.query('SELECT now() AS now')).rows[0];
  return {
    id: ev.id,
    course_id: ev.curso_id,
    title: ev.titulo,
    status: STATUS[ev.estado],
    max_attempts: 1,
    published_at: ev.fecha_publicacion ?? null,
    closes_at: ev.fecha_cierre ?? null,
    duration_minutes: ev.duracion_min ?? null,
    questions_count: ocultas ? Number((await c.query(Q.CONTAR_PREGUNTAS, [ev.id])).rows[0].n) : preguntas.length,
    questions: preguntas.map((p) => ({ id: p.id, type: TIPO_API[p.tipo] ?? 'multiple_choice', statement: p.enunciado, options: p.alternativas.map((a) => a.texto) })),
    attempt: toAttempt(intento),
    // Hora del servidor: el portal corrige con ella el reloj del equipo para la cuenta regresiva.
    server_time: now,
  };
}

/**
 * Evaluaciones (H2 crear y publicar, H3 ver, H4 rendir). Requiere req.user (requireAuth).
 *   404 -> la evaluación o el curso no existen en tu colegio, o no participas en él (o es un borrador y eres estudiante);
 *   403 -> participas, pero tu rol no permite la acción.
 * Los POST llevan Idempotency-Key (platform/idempotency.js). Lo que el estudiante nunca recibe: la alternativa
 * correcta antes de rendir ni las retroalimentaciones de una evaluación que no ha entregado.
 */
export function createEvaluacionesRouter({ db, llm, rag, tenantId, aiLimiter = createLoginLimiter({ maxFailures: 10, windowMs: 10 * 60_000 }) }) {
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
        const { id } = (await c.query(Q.CREAR_EVALUACION, [courseId, input.title, input.closesAt, input.durationMin])).rows[0];
        await escribirPreguntas(c, id, input.questions);
        const ev = await cargarEvaluacion(c, id);
        return { status: 201, body: await evaluacionParaDocente(c, ev) };
      },
    });
  });

  // H2 · Generar un BORRADOR con IA a partir de un tema y, si se quiere, de los apuntes del curso. No guarda nada:
  // el docente revisa y edita lo propuesto y lo guarda con POST /assessments (o lo descarta).
  router.post('/v1/courses/:courseId/assessments/generate', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const pedido = leerPedidoIa(req.body);
    if (pedido.error) throw invalid(pedido.error);
    if (!llm) throw new HttpProblem(503, 'Generador no disponible', 'La generación con IA no está configurada en este servidor', 'llm-unavailable');

    await read(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      if (!esStaffDelCurso(req.user, curso)) throw forbidden('Solo el docente del curso o el administrador generan evaluaciones');
    });

    // Cada generación cuesta tiempo de modelo: tope por usuario (el contrato declara 429).
    const clave = `ia|${req.user.id}`;
    const espera = aiLimiter.retryAfterSeconds(clave);
    if (espera > 0) {
      res.set('Retry-After', String(espera));
      throw new HttpProblem(429, 'Demasiadas generaciones', `Espera ${Math.ceil(espera / 60)} min antes de generar otra evaluación`, 'too-many-requests');
    }
    aiLimiter.recordFailure(clave);

    // Apuntes del curso (solo del colegio del token: el RAG filtra por tenant y curso).
    let notes = '';
    let sources = [];
    if (pedido.useNotes) {
      if (!rag) throw new HttpProblem(422, 'Sin apuntes', 'Este servidor no tiene el buscador de apuntes: genera con "use_notes": false', 'validation-error');
      const { hits } = await rag.retrieve({ tenantId: req.user.colegioId ?? tenantId, courseId, query: pedido.topic });
      const propios = hits.filter((h) => !h.reference);
      if (propios.length === 0) {
        throw new HttpProblem(422, 'Sin apuntes sobre ese tema', 'No encontré apuntes del curso sobre ese tema: sube el material o genera sin usar los apuntes', 'validation-error');
      }
      notes = propios.map((h) => h.text).join('\n\n---\n\n');
      sources = [...new Set(propios.map((h) => h.doc_id))];
    }

    let salida = '';
    for await (const trozo of llm.chat(armarPrompt({ ...pedido, notes }), { temperature: 0.3 })) salida += trozo;
    const borrador = leerBorradorIa(salida, pedido);
    if (!borrador) throw new HttpProblem(502, 'Respuesta inválida del generador', 'El modelo no devolvió preguntas utilizables: vuelve a intentarlo o escribe la evaluación a mano', 'bad-gateway');

    res.json({
      title: borrador.title || `Evaluación de ${pedido.topic}`.slice(0, 150),
      questions: borrador.questions,
      source: pedido.useNotes ? 'apuntes' : 'tema',
      sources,
      requested_questions: pedido.count,
    });
  });

  // Evaluaciones de un curso. Docente/admin: todas (con borradores y cuántos entregaron). Estudiante matriculado:
  // solo las publicadas y cerradas, con su nota si ya la rindió.
  router.get('/v1/courses/:courseId/assessments', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    // Transacción de escritura: al estudiante se le cierran aquí sus intentos vencidos (CERRAR_INTENTOS_VENCIDOS).
    const body = await db.withUser(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      if (esStaffDelCurso(req.user, curso)) {
        const rows = (await c.query(Q.EVALUACIONES_DEL_CURSO, [courseId])).rows;
        return {
          data: rows.map((e) => ({
            id: e.id, title: e.titulo, status: STATUS[e.estado], questions_count: e.preguntas, submissions_count: e.entregas,
            published_at: e.fecha_publicacion, closes_at: e.fecha_cierre, duration_minutes: e.duracion_min ?? null,
          })),
        };
      }
      // Otro docente o admin sin permiso: 403 (participa del colegio). Estudiante sin matrícula: 404.
      if (req.user.rol !== 'estudiante') throw forbidden('Solo el docente del curso, el administrador o sus estudiantes ven las evaluaciones');
      if (!curso.matriculado) throw notFound('El curso');
      // Sus intentos con tiempo que vencieron sin entregar se cierran aquí: así ya aparecen con nota.
      await c.query(Q.CERRAR_INTENTOS_VENCIDOS, [null, courseId]);
      const rows = (await c.query(Q.EVALUACIONES_PARA_ESTUDIANTE, [courseId, req.user.id])).rows;
      return {
        data: rows.map((e) => ({
          id: e.id, title: e.titulo, status: STATUS[e.estado], questions_count: e.preguntas,
          published_at: e.fecha_publicacion, closes_at: e.fecha_cierre, duration_minutes: e.duracion_min ?? null,
          submitted: e.entregada_at !== null, grade: e.nota ?? null, score: e.puntaje ?? null, submitted_at: e.entregada_at ?? null,
          started_at: e.iniciada_at ?? null, pending_review: e.por_revisar ?? 0,
        })),
      };
    });
    res.json(body);
  });

  // Una evaluación. Docente/admin: completa, con la alternativa correcta. Estudiante matriculado: solo si está
  // publicada, sin la alternativa correcta ni la retroalimentación (eso llega al enviar).
  router.get('/v1/assessments/:assessmentId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const body = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      const curso = await cursoVisible(c, req.user, ev.curso_id);
      if (esStaffDelCurso(req.user, ev)) return evaluacionParaDocente(c, ev);
      if (req.user.rol !== 'estudiante') throw forbidden('Solo el docente del curso, el administrador o sus estudiantes ven esta evaluación');
      if (!curso.matriculado || ev.estado === 'borrador') throw notFound('La evaluación');
      await c.query(Q.CERRAR_INTENTOS_VENCIDOS, [assessmentId, null]);
      return evaluacionParaEstudiante(c, ev, req.user);
    });
    res.json(body);
  });

  // H2 · Editar un BORRADOR (también uno generado con IA): reemplaza título, cierre y preguntas. Solo borradores.
  router.put('/v1/assessments/:assessmentId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const input = leerEvaluacion(req.body);
    const body = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden('Solo el docente del curso o el administrador editan evaluaciones');
      if (ev.estado !== 'borrador') throw conflict('Solo se puede editar una evaluación en borrador: esta ya fue publicada');
      const ok = (await c.query(Q.ACTUALIZAR_BORRADOR, [assessmentId, input.title, input.closesAt, input.durationMin])).rows[0];
      if (!ok) throw conflict('La evaluación ya no está en borrador');
      await c.query(Q.BORRAR_PREGUNTAS, [assessmentId]);
      await escribirPreguntas(c, assessmentId, input.questions);
      return evaluacionParaDocente(c, await cargarEvaluacion(c, assessmentId));
    });
    res.json(body);
  });

  // Borrar un borrador. Una evaluación publicada o cerrada tiene entregas y notas: no se borra.
  router.delete('/v1/assessments/:assessmentId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden('Solo el docente del curso o el administrador borran evaluaciones');
      if (ev.estado !== 'borrador') throw conflict('Solo se puede borrar una evaluación en borrador: las publicadas tienen entregas y notas');
      if (!(await c.query(Q.BORRAR_BORRADOR, [assessmentId])).rows[0]) throw conflict('La evaluación ya no está en borrador');
    });
    res.status(204).end();
  });

  // H2 · Publicar o cerrar, y (v1.9) fijar o cambiar la hora de cierre. No se publica si alguna pregunta no tiene
  // alternativa correcta (422, con cuáles).
  router.patch('/v1/assessments/:assessmentId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const status = req.body?.status;
    const cierre = leerCierre(req.body?.closes_at);
    if (status === undefined && cierre === undefined) throw invalid('Envía "status" ("published" o "closed") o "closes_at"');
    if (status !== undefined && status !== 'published' && status !== 'closed') throw invalid('"status" debe ser "published" o "closed"');
    if (status === 'closed' && cierre !== undefined) throw invalid('Al cerrar una evaluación no se envía "closes_at": se cierra ahora');

    const body = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden('Solo el docente del curso o el administrador publican, cierran o cambian el cierre de una evaluación');

      if (status === 'published') {
        const sinCorrecta = (await c.query(Q.PREGUNTAS_SIN_CORRECTA, [assessmentId])).rows;
        if (sinCorrecta.length > 0) {
          const nums = sinCorrecta.map((p) => p.orden).join(', ');
          throw new HttpProblem(422, 'Datos inválidos', `No se puede publicar: la pregunta ${nums} no tiene respuesta correcta.`, 'validation-error', {
            errors: sinCorrecta.map((p) => ({ field: `questions[${p.orden - 1}].${p.tipo === 'texto' ? 'accepted_answers' : 'correct_option'}`, message: p.tipo === 'texto' ? 'Falta al menos una respuesta aceptada.' : 'Requerido para publicar.' })),
          });
        }
        if (ev.estado !== 'borrador') throw conflict('Solo una evaluación en borrador se puede publicar');
        // Un borrador guardado con un cierre que ya pasó no se publica (se cerraría al instante): hay que elegir otro.
        if (cierre === undefined && ev.fecha_cierre && new Date(ev.fecha_cierre).getTime() <= Date.now()) {
          throw conflict('La hora de cierre del borrador ya pasó: elige una nueva al publicar o quítala');
        }
        await c.query(Q.PUBLICAR_EVALUACION, [assessmentId, cierre !== undefined, cierre ?? null]);
      } else if (status === undefined) {
        if (ev.estado === 'cerrada') throw conflict('La evaluación ya está cerrada: no se puede cambiar su cierre');
        await c.query(Q.CAMBIAR_CIERRE_EVALUACION, [assessmentId, cierre]);
      } else {
        if (ev.estado !== 'publicada') throw conflict('Solo una evaluación publicada se puede cerrar');
        await c.query(Q.CERRAR_EVALUACION, [assessmentId]);
      }
      return evaluacionParaDocente(c, await cargarEvaluacion(c, assessmentId));
    });
    res.json(body);
  });

  // v1.12 · Empezar (o retomar) una evaluación con tiempo. Corre el reloj de ESTE estudiante: su plazo es inicio +
  // duración o el cierre de la evaluación, lo que llegue primero. Repetirlo devuelve el mismo intento (200), así que
  // no lleva Idempotency-Key: recargar la página no reinicia el tiempo.
  router.post('/v1/assessments/:assessmentId/attempts', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    if (req.user.rol !== 'estudiante') throw forbidden('Solo los estudiantes rinden evaluaciones');
    const out = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      const curso = await cursoVisible(c, req.user, ev.curso_id);
      if (!curso.matriculado || ev.estado === 'borrador') throw notFound('La evaluación');
      if (ev.estado === 'cerrada') throw conflict('La evaluación ya está cerrada');
      const creado = (await c.query(Q.INICIAR_INTENTO, [assessmentId, req.user.id])).rows[0];
      const intento = (await c.query(Q.INTENTO_DEL_ESTUDIANTE, [assessmentId, req.user.id])).rows[0];
      if (!intento) throw conflict('El plazo de esta evaluación ya terminó');
      if (intento.fecha_envio) throw await yaRendida(c, req.user, assessmentId);
      if (intento.vencido) {
        await c.query(Q.CERRAR_INTENTOS_VENCIDOS, [assessmentId, null]);
        return { status: 409, vencido: true };
      }
      const { now } = (await c.query('SELECT now() AS now')).rows[0];
      return { status: creado ? 201 : 200, body: { ...toAttempt(intento), server_time: now } };
    });
    // Fuera de la transacción: el cierre del intento vencido queda guardado aunque se responda 409.
    if (out.vencido) throw new HttpProblem(409, 'Conflicto', 'Se acabó el tiempo de tu intento', 'attempt-expired');
    res.status(out.status).json(out.body);
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
        if (previo?.fecha_envio) throw await yaRendida(c, req.user, assessmentId);
        // v1.12: con duración por intento hay que empezar antes (POST .../attempts): ahí corre el reloj.
        if (!previo && ev.duracion_min) {
          throw new HttpProblem(409, 'Conflicto', 'Esta evaluación tiene tiempo: empiézala antes de entregar', 'attempt-not-started');
        }

        const preguntas = (await c.query(Q.PREGUNTAS_PARA_RENDIR, [assessmentId])).rows;
        const elegidas = resolverRespuestas(preguntas, respuestas);

        let intento = previo;
        if (previo?.vencido) {
          // Llegó tarde (plazo + margen): el intento se cierra con lo que ya tenía guardado (nada) y no se aceptan estas.
          throw new HttpProblem(409, 'Conflicto', 'Se acabó el tiempo de tu intento: ya no se reciben respuestas', 'attempt-expired');
        }
        if (!intento) intento = (await c.query(Q.CREAR_INTENTO, [assessmentId, req.user.id])).rows[0];
        // Publicada pero vencida (fecha_cierre pasó): la base no abre el intento.
        if (!intento) throw conflict('El plazo de esta evaluación ya terminó');

        const answers = [];
        for (const p of preguntas) {
          const elegida = elegidas.get(p.id);
        const r = (await c.query(Q.INSERTAR_RESPUESTA, [intento.id, p.id, elegida?.alternativaId ?? null, elegida?.texto ?? null])).rows[0];
          if (!r) throw conflict('La evaluación ya no recibe respuestas');
          answers.push({ question_id: p.id, correct: r.es_correcta, pending_review: r.revision_pendiente, feedback: r.retroalimentacion ?? '' });
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
            // v1.11: respuestas escritas que el docente todavía debe revisar (valen 0 hasta entonces: nota provisional).
            pending_review: answers.filter((a) => a.pending_review).length,
            answers,
            submitted_at: enviado.fecha_envio,
          },
        };
      },
    });
  });

  // v1.11 · Revisión docente de las respuestas escritas: la bandeja (por revisar primero) y la decisión por respuesta.
  router.get('/v1/assessments/:assessmentId/text-answers', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const rows = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden('Solo el docente del curso o el administrador revisan respuestas');
      return (await c.query(Q.RESPUESTAS_ESCRITAS, [assessmentId])).rows;
    }, { readOnly: true });
    res.json({
      pending: rows.filter((r) => r.revision_pendiente).length,
      data: rows.map((r) => ({
        id: r.id,
        question_id: r.pregunta_id,
        question_order: r.orden,
        question: r.enunciado,
        accepted_answers: r.respuestas_aceptadas ?? [],
        student_id: r.estudiante_id,
        student_name: r.nombre,
        text_answer: r.respuesta_texto,
        correct: r.es_correcta,
        pending_review: r.revision_pendiente,
        reviewed_at: r.revisada_at,
        submitted_at: r.fecha_envio,
      })),
    });
  });

  router.patch('/v1/assessments/:assessmentId/text-answers/:answerId', async (req, res) => {
    const assessmentId = uuidParam(req.params.assessmentId, 'assessmentId');
    const answerId = uuidParam(req.params.answerId, 'answerId');
    if (typeof req.body?.correct !== 'boolean') throw invalid('"correct" debe ser true o false');
    const fila = await db.withUser(req.user, async (c) => {
      const ev = await cargarEvaluacion(c, assessmentId);
      if (!esStaffDelCurso(req.user, ev)) throw forbidden('Solo el docente del curso o el administrador revisan respuestas');
      await c.query(Q.BLOQUEAR_INTENTO_DE_RESPUESTA, [assessmentId, answerId]);
      const r = (await c.query(Q.REVISAR_RESPUESTA, [assessmentId, answerId, req.body.correct])).rows[0];
      if (!r) throw new HttpProblem(404, 'No encontrado', 'La respuesta escrita no existe en esta evaluación', 'not-found');
      return r;
    });
    res.json({ id: fila.id, correct: fila.es_correcta, pending_review: false, reviewed_at: fila.revisada_at, student_percentage: Number(fila.puntaje), student_grade: Number(fila.nota) });
  });

  return router;
}

/** Crea las preguntas y alternativas de una evaluación (en la transacción de quien llama). */
async function escribirPreguntas(c, evaluacionId, questions) {
  for (const [i, q] of questions.entries()) {
    const pregunta = (await c.query(Q.CREAR_PREGUNTA, [evaluacionId, q.statement, i + 1, q.feedback, q.type === 'text' ? 'texto' : 'alternativas', q.accepted])).rows[0];
    for (const [j, texto] of q.options.entries()) {
      await c.query(Q.CREAR_ALTERNATIVA, [pregunta.id, texto, j === q.correct, j]);
    }
  }
}

/** Cuerpo de submissions (schema SubmissionInput) -> [{ questionId, selected } | { questionId, text }], o 400. */
function leerRespuestas(body) {
  const answers = body?.answers;
  // v1.12: puede venir vacía (entregar sin responder, o la entrega automática al acabarse el tiempo): todo cuenta como incorrecto.
  if (!Array.isArray(answers) || answers.length > MAX_PREGUNTAS) {
    throw invalid(`"answers" debe ser una lista de hasta ${MAX_PREGUNTAS} respuestas`);
  }
  const vistas = new Set();
  return answers.map((a, i) => {
    const questionId = uuidParam(a?.question_id, `answers[${i}].question_id`);
    if (vistas.has(questionId)) throw invalid(`answers[${i}]: la pregunta ya fue respondida en este envío`);
    vistas.add(questionId);
    if (a.text_answer !== undefined) {
      if (a.selected_option !== undefined) throw invalid(`answers[${i}]: envía selected_option (alternativas) o text_answer (texto), no ambos`);
      if (typeof a.text_answer !== 'string' || a.text_answer.length > MAX_RESPUESTA_TEXTO) throw invalid(`answers[${i}].text_answer debe ser un texto de hasta ${MAX_RESPUESTA_TEXTO} caracteres`);
      return { questionId, text: a.text_answer.trim() };
    }
    if (!Number.isInteger(a.selected_option) || a.selected_option < 0) throw invalid(`answers[${i}].selected_option debe ser el índice (desde 0) de la alternativa elegida`);
    return { questionId, selected: a.selected_option };
  });
}

/** Índices -> id de la alternativa, según el MISMO orden que vio el estudiante. 422 si la pregunta o la alternativa no existen. */
function resolverRespuestas(preguntas, respuestas) {
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const elegidas = new Map();
  const invalida = (detalle) => new HttpProblem(422, 'Datos inválidos', detalle, 'validation-error');
  for (const { questionId, selected, text } of respuestas) {
    const pregunta = porId.get(questionId);
    if (!pregunta) throw invalida('Una de las respuestas es de una pregunta que no pertenece a esta evaluación');
    if (pregunta.tipo === 'texto') {
      if (text === undefined) throw invalida(`La pregunta ${pregunta.orden} se responde escribiendo (text_answer), no eligiendo una alternativa`);
      // Una respuesta en blanco cuenta como sin responder.
      if (text) elegidas.set(questionId, { texto: text });
      continue;
    }
    if (text !== undefined) throw invalida(`La pregunta ${pregunta.orden} es de alternativas: envía selected_option`);
    const alternativa = pregunta.alternativas[selected];
    if (!alternativa) throw invalida(`La pregunta ${pregunta.orden} no tiene una alternativa ${selected + 1}`);
    elegidas.set(questionId, { alternativaId: alternativa.id });
  }
  return elegidas;
}

/** 409 de «ya la rendiste», con el resultado anterior en `detail` (contrato: submitAssessment). */
async function yaRendida(c, user, assessmentId) {
  const nota = (await c.query(Q.NOTA_ESTUDIANTE_EVALUACION, [user.id, assessmentId])).rows[0];
  const detalle = nota ? ` Tu resultado anterior: ${nota.puntaje}% de logro, nota ${String(nota.nota).replace('.', ',')}.` : '';
  return conflict(`Ya rendiste esta evaluación: solo se permite un intento.${detalle}`);
}
