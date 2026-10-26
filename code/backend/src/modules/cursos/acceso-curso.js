import { HttpProblem } from '../../platform/problem.js';
import * as Q from '../../../db/queries.js';

// Reglas de acceso a un curso que comparten los módulos cursos y notas.
//
//   404 -> el curso no existe en el colegio del token (o no participas en él): no se revela nada.
//   403 -> el curso es de tu colegio, pero tu rol no permite la acción.
//
// La base aplica lo mismo por su lado (RLS de 01, 02 §9 y 04): esto es la primera línea de defensa
// y la que da un mensaje claro al cliente.

/** El docente dueño del curso o el admin del colegio (el RLS ya limita al colegio). */
export const esStaffDelCurso = (user, curso) =>
  user.rol === 'admin_colegio' || (user.rol === 'docente' && curso.docente_id === user.id);

/**
 * El curso con `matriculado` (si el usuario tiene matrícula activa), o 404 si no existe en el
 * colegio de la sesión.
 */
export async function cursoVisible(client, user, courseId) {
  const curso = (await client.query(Q.CURSO_ACCESO, [courseId, user.id])).rows[0];
  if (!curso) throw new HttpProblem(404, 'No encontrado', 'El curso no existe o no es visible', 'not-found');
  return curso;
}
