import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../platform/pagination.js';
import { withIdempotency } from '../../platform/idempotency.js';
import { UUID, invalid, uuidParam } from '../../platform/validation.js';
import * as Q from '../../../db/queries.js';
import { cursoVisible, esStaffDelCurso } from './acceso-curso.js';

const PERIODO = /^\d{4}-S[12]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const forbidden = (detail) => new HttpProblem(403, 'Prohibido', detail, 'forbidden');

/** Texto opcional: ausente -> null; si viene, debe ser un texto de hasta `max` caracteres. */
function textoOpcional(value, nombre, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length > max) throw invalid(`"${nombre}" debe ser un texto de hasta ${max} caracteres`);
  return value.trim() || null;
}

/** Cuerpo de POST /v1/courses (schema CourseInput) -> valores para CREAR_CURSO, o 400. */
function leerCurso(body, user) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length < 3 || name.length > 120) throw invalid('"name" debe ser un texto de 3 a 120 caracteres');
  if (typeof body?.period !== 'string' || !PERIODO.test(body.period)) throw invalid('"period" debe tener el formato AAAA-S1 o AAAA-S2');
  const subject = textoOpcional(body.subject, 'subject', 80);
  const gradeLevel = textoOpcional(body.grade_level, 'grade_level', 10);
  // El docente solo crea cursos propios. El admin elige quién dicta el curso (`teacher_id`, solo para él).
  let teacherId = user.id;
  if (body.teacher_id !== undefined) {
    teacherId = uuidParam(body.teacher_id, 'teacher_id');
    if (user.rol === 'docente' && teacherId !== user.id) throw forbidden('Un docente solo puede crear cursos a su nombre');
  } else if (user.rol === 'admin_colegio') {
    throw invalid('El administrador debe indicar "teacher_id": el docente que dicta el curso');
  }
  return { teacherId, name, period: body.period, subject, gradeLevel };
}
const esPersonal = (rol) => rol === 'docente' || rol === 'admin_colegio';

// El cursor de la lista guarda (periodo, nombre, id) de la última fila: ver CURSOS_VISIBLES.
const cursorValido = (v) => v.length === 3 && PERIODO.test(v[0]) && typeof v[1] === 'string' && UUID.test(v[2]);

/** Fila de la base -> schema Course del contrato. El tamaño del curso solo lo ve el personal. */
function toCourse(row, user) {
  return {
    id: row.id,
    name: row.nombre,
    period: row.periodo,
    subject: row.asignatura,
    grade_level: row.nivel,
    teacher_id: row.docente_id,
    teacher_name: row.docente,
    ...(esPersonal(user.rol) && { students_count: row.matriculados }),
    tutor_available: row.tutor_disponible,
    tutor_documents: row.apuntes,
    created_at: row.created_at,
  };
}

/**
 * Gestión académica, lectura (contrato S05: listCourses, getCourse).
 * Requiere req.user (requireAuth). Qué cursos ve cada rol lo decide puede_ver_curso() en la base
 * (04_privacidad_login.sql): el estudiante ve sus asignaturas; el docente, las que dicta; el admin,
 * todas las de su colegio.
 */
export function createCursosRouter({ db }) {
  const router = Router();
  const read = (user, fn) => db.withUser(user, fn, { readOnly: true });

  router.get('/v1/courses', async (req, res) => {
    const { period } = req.query;
    if (period !== undefined && !(typeof period === 'string' && PERIODO.test(period))) {
      throw invalid('"period" debe tener el formato AAAA-S1 o AAAA-S2');
    }
    const limit = parseLimit(req.query.limit);
    const after = req.query.cursor === undefined ? [null, null, null] : decodeCursor(req.query.cursor, cursorValido);

    // Se pide una fila de más para saber si hay otra página.
    const rows = await read(req.user, async (c) => (await c.query(Q.CURSOS_VISIBLES, [period ?? null, limit + 1, ...after])).rows);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    res.json({
      data: page.map((row) => toCourse(row, req.user)),
      next_cursor: rows.length > limit ? encodeCursor([last.periodo, last.nombre, last.id]) : null,
    });
  });

  // H1 · Crear un curso en el colegio del token. Docente (a su nombre) o admin (indicando el docente).
  router.post('/v1/courses', async (req, res) => {
    if (req.user.rol === 'estudiante') throw forbidden('Solo docentes y administradores crean cursos');
    const input = leerCurso(req.body, req.user);
    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const creado = (await c.query(Q.CREAR_CURSO, [input.teacherId, input.name, input.period, input.subject, input.gradeLevel])).rows[0];
        const row = (await c.query(Q.CURSO_DETALLE, [creado.id])).rows[0];
        return { status: 201, body: toCourse(row, req.user) };
      },
    });
  });

  // H1 · Matricular a un estudiante del MISMO colegio por su correo institucional.
  router.post('/v1/courses/:courseId/enrollments', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const email = typeof req.body?.student_email === 'string' ? req.body.student_email.trim() : '';
    if (!EMAIL.test(email) || email.length > 150) throw invalid('"student_email" debe ser un correo válido');
    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const curso = await cursoVisible(c, req.user, courseId);
        if (!esStaffDelCurso(req.user, curso)) throw forbidden('Solo el docente del curso o el administrador matriculan estudiantes');
        const m = (await c.query(Q.MATRICULAR_POR_EMAIL, [courseId, email])).rows[0];
        // Sin fila: no hay un estudiante activo con ese correo en ESTE colegio (otro colegio = no existe, RLS).
        if (!m) throw new HttpProblem(404, 'No encontrado', 'No hay un estudiante con ese correo en tu colegio', 'not-found');
        return { status: 201, body: { id: m.id, course_id: m.curso_id, student_id: m.estudiante_id, enrolled_at: m.fecha_matricula } };
      },
    });
  });

  // Matriculados del curso (el docente verifica quién quedó dentro). 403 al estudiante.
  router.get('/v1/courses/:courseId/enrollments', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const rows = await read(req.user, async (c) => {
      const curso = await cursoVisible(c, req.user, courseId);
      if (!esStaffDelCurso(req.user, curso)) throw forbidden('Solo el docente del curso o el administrador ven a los matriculados');
      return (await c.query(Q.ESTUDIANTES_CURSO, [courseId])).rows;
    });
    res.json({
      data: rows.map((r) => ({ id: r.matricula_id, student_id: r.estudiante_id, name: r.nombre, email: r.email, enrolled_at: r.fecha_matricula })),
    });
  });

  router.get('/v1/courses/:courseId', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const row = await read(req.user, async (c) => (await c.query(Q.CURSO_DETALLE, [courseId])).rows[0]);
    // 404 también si el curso existe pero no participas: no se revela qué cursos hay.
    if (!row) throw new HttpProblem(404, 'No encontrado', 'El curso no existe o no participas en él', 'not-found');
    res.json(toCourse(row, req.user));
  });

  return router;
}
