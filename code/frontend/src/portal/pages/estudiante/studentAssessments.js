import { getAssessments, getMyGrades } from '../../../api/portalApi.js';

/** Consulta los cursos matriculados y sus evaluaciones reales (solo rol estudiante).
 * Las evaluaciones publicadas o cerradas se leen según las reglas de acceso del backend.
 */
export async function getStudentAssessmentDashboard(token, opts = {}) {
  const grades = await getMyGrades(token, opts);
  const courses = grades.courses ?? [];
  if (!courses.length) return { courses, assessments: [], partialErrors: 0 };
  const responses = await Promise.allSettled(
    courses.map((course) => getAssessments(token, course.course_id, opts)),
  );
  const rejected = responses.filter((result) => result.status === 'rejected');
  const invalidSession = rejected.find((result) => result.reason?.status === 401);
  if (invalidSession) throw invalidSession.reason;
  if (rejected.length === responses.length) throw rejected[0].reason;
  const assessments = responses.flatMap((result, index) => {
    if (result.status !== 'fulfilled') return [];
    const course = courses[index];
    return (result.value.data ?? [])
      .filter((ev) => ev.status !== 'draft')
      .map((ev) => ({ ...ev, subject: course.subject ?? course.course, courseName: course.course, courseId: course.course_id }));
  });
  return { courses, assessments, partialErrors: rejected.length };
}

export function assessmentCategory(ev) {
  if (ev.submitted) return 'entregada';
  if (ev.status === 'published' && (!ev.closes_at || new Date(ev.closes_at).getTime() > Date.now())) return 'pendiente';
  return 'cerrada';
}

export function sortAssessments(a, b) {
  const aTime = a.closes_at ? new Date(a.closes_at).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b.closes_at ? new Date(b.closes_at).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}
