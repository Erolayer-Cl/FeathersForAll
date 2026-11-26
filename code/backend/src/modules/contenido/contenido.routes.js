import express, { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { withIdempotency } from '../../platform/idempotency.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import { esStaffDelCurso } from '../cursos/acceso-curso.js';
import * as Q from '../../../db/queries.js';
import { MAX_ARCHIVO_BYTES, enviarArchivo, leerCuerpoArchivo, leerNombreArchivo, soloBinario } from './archivos.js';

// Contenido del curso (contrato v1.8):
//   - Material: los apuntes que sube el docente, visibles y descargables para sus estudiantes.
//   - Tareas: el docente publica una tarea con hora límite; cada estudiante entrega un archivo (lo puede reemplazar)
//     hasta esa hora. Después, ni la API ni la base (RLS de 10_material_y_tareas.sql) aceptan entregas.
//
// Igual que el resto de la API: 404 si el curso o la tarea no existen o no participas; 403 si participas pero tu
// rol no permite la acción. El contenido de los archivos nunca va a los logs.

const MAX_TITULO = 150;
const MAX_INSTRUCCIONES = 4000;
const MAX_DIAS_PLAZO = 366;
const DIA_MS = 24 * 60 * 60 * 1000;

const forbidden = (detail) => new HttpProblem(403, 'Prohibido', detail, 'forbidden');
const notFound = (what) => new HttpProblem(404, 'No encontrado', `${what} no existe o no es visible`, 'not-found');

const fechaChile = (d) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' }).format(d);
const tareaCerrada = (fechaLimite) => new HttpProblem(409, 'Tarea cerrada',
  `La tarea cerró el ${fechaChile(fechaLimite)} (hora de Chile): ya no se pueden subir entregas`, 'task-closed');

// ---------------------------------------------------------------- validación

const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/;

/** Fecha y hora límite: ISO 8601 CON zona horaria (si no, sería ambigua) y a menos de un año. */
export function leerFechaLimite(valor, { futura }) {
  if (typeof valor !== 'string' || !ISO_CON_ZONA.test(valor) || Number.isNaN(new Date(valor).getTime())) {
    throw invalid('"due_at" debe ser una fecha y hora ISO 8601 con zona horaria (por ejemplo 2026-12-01T23:59:00-03:00)');
  }
  const fecha = new Date(valor);
  if (futura && fecha.getTime() <= Date.now()) throw invalid('"due_at" debe ser una fecha y hora futuras');
  if (fecha.getTime() > Date.now() + MAX_DIAS_PLAZO * DIA_MS) throw invalid(`"due_at" no puede estar a más de ${MAX_DIAS_PLAZO} días`);
  return fecha.toISOString();
}

function leerTitulo(valor) {
  const title = typeof valor === 'string' ? valor.trim() : '';
  if (title.length < 3 || title.length > MAX_TITULO) throw invalid(`"title" debe ser un texto de 3 a ${MAX_TITULO} caracteres`);
  return title;
}

function leerInstrucciones(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || valor.length > MAX_INSTRUCCIONES) throw invalid(`"instructions" debe ser un texto de hasta ${MAX_INSTRUCCIONES} caracteres`);
  return valor.trim() || null;
}

/** Cuerpo de POST /v1/courses/{id}/tasks (schema TaskInput). */
export function leerTarea(body) {
  return {
    title: leerTitulo(body?.title),
    instructions: leerInstrucciones(body?.instructions),
    dueAt: leerFechaLimite(body?.due_at, { futura: true }),
  };
}

/** Cuerpo de PATCH /v1/tasks/{id} (schema TaskPatch): al menos un campo. Mover la hora al pasado cierra la tarea. */
export function leerCambiosTarea(body) {
  const cambios = {};
  if (body?.title !== undefined) cambios.title = leerTitulo(body.title);
  if (body?.instructions !== undefined) cambios.instructions = leerInstrucciones(body.instructions);
  if (body?.due_at !== undefined) cambios.dueAt = leerFechaLimite(body.due_at, { futura: false });
  if (Object.keys(cambios).length === 0) throw invalid('Envía al menos uno de "title", "instructions" o "due_at"');
  return cambios;
}

// ---------------------------------------------------------------- respuestas

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

/** Fila de TAREAS_CURSO / TAREA_ACCESO -> schema Task. El estudiante ve su entrega; el personal, los conteos. */
export function aTarea(row, { staff }) {
  return {
    id: row.id,
    course_id: row.curso_id,
    title: row.titulo,
    instructions: row.instrucciones,
    due_at: iso(row.fecha_limite),
    is_open: row.abierta,
    attachment: row.archivo_nombre ? { name: row.archivo_nombre, size_bytes: row.archivo_bytes, content_type: row.archivo_tipo } : null,
    created_at: iso(row.created_at),
    ...(staff
      ? { submissions_count: row.entregas, students_count: row.estudiantes }
      : { my_submission: row.entrega_nombre ? { file_name: row.entrega_nombre, size_bytes: row.entrega_bytes, submitted_at: iso(row.entregada_at) } : null }),
  };
}

/** Apunte sin archivo original (subido antes de v1.8 o por `npm run ingest`): se entrega su texto como .txt. */
function nombreTexto(titulo) {
  return /\.(txt|md|markdown)$/i.test(titulo) ? titulo : `${titulo.replace(/\.[^.]+$/, '')}.txt`;
}

// ---------------------------------------------------------------- router

export function createContenidoRouter({ db }) {
  const router = Router();
  const cuerpoBinario = express.raw({ type: () => true, limit: MAX_ARCHIVO_BYTES });
  const idEstudiante = (user) => (user.rol === 'estudiante' ? user.id : null);

  /** ¿Participa en el curso? 404 si no. Devuelve { staff }. */
  async function participacion(c, user, courseId) {
    const curso = (await c.query(Q.CURSO_PARTICIPACION, [courseId])).rows[0];
    if (!curso?.visible) throw notFound('El curso');
    return { staff: esStaffDelCurso(user, curso) };
  }

  /** La tarea (si participas en su curso) con { staff }. 404 si no existe o no participas. */
  async function cargarTarea(c, user, taskId) {
    const tarea = (await c.query(Q.TAREA_ACCESO, [taskId, idEstudiante(user)])).rows[0];
    if (!tarea) throw notFound('La tarea');
    return { ...tarea, staff: esStaffDelCurso(user, tarea) };
  }

  const leer = (req, fn) => db.withUser(req.user, fn, { readOnly: true });

  // ------------------------------------------------------------ material del curso

  router.get('/v1/courses/:courseId/materials', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const rows = await leer(req, async (c) => {
      await participacion(c, req.user, courseId);
      return (await c.query(Q.MATERIALES_CURSO, [courseId])).rows;
    });
    res.json({
      data: rows.map((r) => ({ name: r.name, content_type: r.content_type, size_bytes: r.size_bytes, original: r.original, uploaded_at: iso(r.uploaded_at) })),
    });
  });

  router.get('/v1/courses/:courseId/materials/:name/file', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const name = (req.params.name ?? '').trim();
    const row = await leer(req, async (c) => {
      await participacion(c, req.user, courseId);
      return (await c.query(Q.MATERIAL_ARCHIVO, [courseId, name])).rows[0];
    });
    if (!row) throw notFound('El material');
    if (row.contenido) enviarArchivo(res, { nombre: row.nombre, tipo: row.tipo, contenido: row.contenido });
    else enviarArchivo(res, { nombre: nombreTexto(row.titulo), tipo: 'text/plain; charset=utf-8', contenido: Buffer.from(row.texto, 'utf8') });
  });

  // ------------------------------------------------------------ tareas

  router.get('/v1/courses/:courseId/tasks', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const { staff, rows } = await leer(req, async (c) => {
      const p = await participacion(c, req.user, courseId);
      return { ...p, rows: (await c.query(Q.TAREAS_CURSO, [courseId, idEstudiante(req.user)])).rows };
    });
    res.json({ data: rows.map((r) => aTarea(r, { staff })) });
  });

  router.post('/v1/courses/:courseId/tasks', async (req, res) => {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    const input = leerTarea(req.body);
    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const { staff } = await participacion(c, req.user, courseId);
        if (!staff) throw forbidden('Solo el docente del curso o el administrador crean tareas');
        const { id } = (await c.query(Q.CREAR_TAREA, [courseId, input.title, input.instructions, input.dueAt])).rows[0];
        return { status: 201, body: aTarea(await cargarTarea(c, req.user, id), { staff: true }) };
      },
    });
  });

  router.get('/v1/tasks/:taskId', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    const body = await leer(req, async (c) => {
      const tarea = await cargarTarea(c, req.user, taskId);
      const out = aTarea(tarea, { staff: tarea.staff });
      if (tarea.staff) {
        const rows = (await c.query(Q.ENTREGAS_TAREA, [taskId, tarea.curso_id])).rows;
        out.students = rows.map((r) => ({
          student_id: r.estudiante_id,
          name: r.nombre,
          submission: r.archivo_nombre ? { file_name: r.archivo_nombre, size_bytes: r.archivo_bytes, submitted_at: iso(r.entregada_at) } : null,
        }));
      }
      return out;
    });
    res.json(body);
  });

  router.patch('/v1/tasks/:taskId', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    const cambios = leerCambiosTarea(req.body);
    const body = await db.withUser(req.user, async (c) => {
      const tarea = await cargarTarea(c, req.user, taskId);
      if (!tarea.staff) throw forbidden('Solo el docente del curso o el administrador editan tareas');
      await c.query(Q.ACTUALIZAR_TAREA, [taskId, cambios.title ?? null, cambios.instructions ?? null, cambios.dueAt ?? null,
        'instructions' in cambios && cambios.instructions === null]);
      return aTarea(await cargarTarea(c, req.user, taskId), { staff: true });
    });
    res.json(body);
  });

  router.delete('/v1/tasks/:taskId', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    await db.withUser(req.user, async (c) => {
      const tarea = await cargarTarea(c, req.user, taskId);
      if (!tarea.staff) throw forbidden('Solo el docente del curso o el administrador borran tareas');
      await c.query(Q.BORRAR_TAREA, [taskId]);
    });
    res.status(204).end();
  });

  // Archivo de la tarea (lo sube el docente; lo descargan todos los del curso).

  /** Verifica el acceso ANTES de leer el cuerpo: quien no puede subir no alcanza a mandar 10 MB. */
  const precheck = (validar) => async (req, _res, next) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    req.archivo = leerNombreArchivo(req.params.fileName);
    req.tarea = await leer(req, (c) => cargarTarea(c, req.user, taskId));
    validar(req.tarea, req.user);
    next();
  };

  router.put(
    '/v1/tasks/:taskId/attachment/:fileName',
    precheck((tarea) => { if (!tarea.staff) throw forbidden('Solo el docente del curso o el administrador adjuntan archivos a una tarea'); }),
    soloBinario,
    cuerpoBinario,
    async (req, res) => {
      const contenido = leerCuerpoArchivo(req.body, req.archivo);
      const body = await db.withUser(req.user, async (c) => {
        await c.query(Q.GUARDAR_ARCHIVO_TAREA, [req.tarea.id, req.archivo.nombre, req.archivo.tipo, contenido.length, contenido]);
        return aTarea(await cargarTarea(c, req.user, req.tarea.id), { staff: true });
      });
      res.json(body);
    },
  );

  router.delete('/v1/tasks/:taskId/attachment', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    await db.withUser(req.user, async (c) => {
      const tarea = await cargarTarea(c, req.user, taskId);
      if (!tarea.staff) throw forbidden('Solo el docente del curso o el administrador quitan el archivo de una tarea');
      const r = await c.query(Q.QUITAR_ARCHIVO_TAREA, [taskId]);
      if (r.rowCount === 0) throw notFound('El archivo de la tarea');
    });
    res.status(204).end();
  });

  router.get('/v1/tasks/:taskId/attachment', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    const archivo = await leer(req, async (c) => {
      await cargarTarea(c, req.user, taskId);
      return (await c.query(Q.ARCHIVO_TAREA, [taskId])).rows[0];
    });
    if (!archivo) throw notFound('El archivo de la tarea');
    enviarArchivo(res, archivo);
  });

  // Entregas (las sube el estudiante; las descarga él mismo o el docente del curso).

  router.put(
    '/v1/tasks/:taskId/submission/:fileName',
    precheck((tarea, user) => {
      if (user.rol !== 'estudiante') throw forbidden('Solo los estudiantes del curso entregan tareas');
      if (!tarea.abierta) throw tareaCerrada(tarea.fecha_limite);
    }),
    soloBinario,
    cuerpoBinario,
    async (req, res) => {
      const contenido = leerCuerpoArchivo(req.body, req.archivo);
      const { tarea, archivo } = req;
      let fila;
      try {
        fila = await db.withUser(req.user, async (c) => (await c.query(Q.GUARDAR_ENTREGA,
          [tarea.curso_id, tarea.id, archivo.nombre, archivo.tipo, contenido.length, contenido])).rows[0]);
      } catch (err) {
        // 42501 = el RLS rechazó la fila: la hora límite pasó mientras el archivo se subía.
        if (err?.code === '42501') throw tareaCerrada(tarea.fecha_limite);
        throw err;
      }
      res.status(fila.creada ? 201 : 200).json({ file_name: fila.archivo_nombre, size_bytes: fila.archivo_bytes, submitted_at: iso(fila.entregada_at) });
    },
  );

  router.get('/v1/tasks/:taskId/submission', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    const archivo = await leer(req, async (c) => {
      await cargarTarea(c, req.user, taskId);
      if (req.user.rol !== 'estudiante') throw forbidden('Esta ruta es para el estudiante; el docente usa /submissions/{studentId}/file');
      return (await c.query(Q.ARCHIVO_ENTREGA, [taskId, req.user.id])).rows[0];
    });
    if (!archivo) throw notFound('Tu entrega');
    enviarArchivo(res, archivo);
  });

  router.get('/v1/tasks/:taskId/submissions/:studentId/file', async (req, res) => {
    const taskId = uuidParam(req.params.taskId, 'taskId');
    const studentId = uuidParam(req.params.studentId, 'studentId');
    const archivo = await leer(req, async (c) => {
      const tarea = await cargarTarea(c, req.user, taskId);
      if (!tarea.staff) throw forbidden('Solo el docente del curso o el administrador descargan las entregas');
      return (await c.query(Q.ARCHIVO_ENTREGA, [taskId, studentId])).rows[0];
    });
    if (!archivo) throw notFound('La entrega');
    enviarArchivo(res, archivo);
  });

  return router;
}
