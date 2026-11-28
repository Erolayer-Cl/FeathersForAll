import { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import * as Q from '../../../db/queries.js';

// Panel del apoderado (MVP 5, contrato v1.12, ADR 0018). Solo lectura y solo de los pupilos que el admin le vinculó.
// La API no consulta tablas académicas en su nombre: todo sale de las funciones de 16_apoderado.sql, que la base
// limita al apoderado de la sesión, a su colegio y a sus pupilos activos. Un estudiante no vinculado no existe para él.

const forbidden = () => new HttpProblem(403, 'Prohibido', 'Esta sección es solo para apoderados', 'forbidden');

const toGrade = (n) => ({
  assessment_id: n.evaluacion_id,
  title: n.evaluacion,
  score: n.puntaje,
  grade: n.nota,
  weight: n.ponderacion,
  submitted_at: n.fecha_envio,
  pending_review: n.por_revisar ?? 0,
});

const toPending = (p) => ({ assessment_id: p.evaluacion_id, title: p.titulo, closes_at: p.fecha_cierre, duration_minutes: p.duracion_min ?? null });

/** @param {{ db: ReturnType<import('../../platform/db.js').createDb> }} deps */
export function createApoderadoRouter({ db }) {
  const router = Router();

  // GET /v1/me/wards · avance de cada pupilo: ramos con promedio, notas (provisionales marcadas) y lo que le queda por rendir.
  router.get('/v1/me/wards', async (req, res) => {
    if (req.user.rol !== 'apoderado') throw forbidden();
    const wards = await db.withUser(req.user, async (c) => {
      const pupilos = (await c.query(Q.MIS_PUPILOS)).rows;
      const out = [];
      for (const p of pupilos) {
        const [ramos, notas, pendientes] = [
          (await c.query(Q.RAMOS_PUPILO, [p.estudiante_id])).rows,
          (await c.query(Q.NOTAS_PUPILO, [p.estudiante_id])).rows,
          (await c.query(Q.PENDIENTES_PUPILO, [p.estudiante_id])).rows,
        ];
        out.push({
          student_id: p.estudiante_id,
          name: p.nombre,
          courses: ramos.map((r) => ({
            course_id: r.curso_id,
            course: r.curso,
            subject: r.asignatura,
            period: r.periodo,
            teacher_name: r.docente,
            average: r.promedio,
            grades: notas.filter((n) => n.curso_id === r.curso_id).map(toGrade),
            pending: pendientes.filter((x) => x.curso_id === r.curso_id).map(toPending),
          })),
        });
      }
      return out;
    }, { readOnly: true });
    res.json({ wards });
  });

  return router;
}
