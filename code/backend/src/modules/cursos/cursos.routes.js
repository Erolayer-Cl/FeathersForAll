import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../platform/pagination.js';
import { UUID, invalid, uuidParam } from '../../platform/validation.js';
import * as Q from '../../../db/queries.js';

const PERIODO = /^\d{4}-S[12]$/;
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

  router.get('/v1/courses/:courseId', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const row = await read(req.user, async (c) => (await c.query(Q.CURSO_DETALLE, [courseId])).rows[0]);
    // 404 también si el curso existe pero no participas: no se revela qué cursos hay.
    if (!row) throw new HttpProblem(404, 'No encontrado', 'El curso no existe o no participas en él', 'not-found');
    res.json(toCourse(row, req.user));
  });

  return router;
}
