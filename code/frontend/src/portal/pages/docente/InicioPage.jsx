import { getCourses, getAssessments } from '../../../api/portalApi.js';
import { LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { estadoEvaluacion, normalizarEstado } from '../../utils/evaluaciones.js';
import styles from './InicioPage.module.css';

async function getDashboard(token, opts) {
  const courses = await getCourses(token, opts);
  const result = await Promise.allSettled(courses.map((c) => getAssessments(token, c.id, opts)));
  const assessments = result.flatMap((res, index) => res.status === 'fulfilled' ? (res.value?.data ?? []).map((a) => ({ ...a, courseName: courses[index].subject || courses[index].name, courseId: courses[index].id })) : []);
  const partial = result.some((res) => res.status === 'rejected');
  return { courses, assessments, partial };
}

export function DocenteInicioPage() {
  const { data, loading, error, reload } = useApiData(getDashboard);
  const courses = data?.courses ?? [];
  const assessments = data?.assessments ?? [];
  const pending = assessments.filter((a) => normalizarEstado(a.status) === 'draft');
  const uniqueStudents = courses.every((c) => typeof c.students_count === 'number') ? courses.reduce((sum, c) => sum + c.students_count, 0) : null;
  return <div className={styles.page}>
    <header className={styles.heading}><span className={styles.eyebrow}>Docente · Inicio</span><h1>Inicio</h1><p>Resumen de tus cursos, estudiantes y evaluaciones.</p></header>
    <LoadState loading={loading} error={error} onRetry={reload}>
      {data?.partial && <p className={styles.warning}>No fue posible consultar las evaluaciones de todos los cursos. El resumen puede estar incompleto.</p>}
      <div className={styles.stats}>
        <article><span>Cursos activos</span><strong>{courses.length}</strong><small>Cursos asignados</small></article>
        <article><span>Matrículas en tus cursos</span><strong>{uniqueStudents ?? '—'}</strong><small>{uniqueStudents === null ? 'Dato no disponible' : 'Incluye matrículas de cada curso'}</small></article>
        <article><span>Evaluaciones registradas</span><strong>{data?.partial ? '—' : assessments.length}</strong><small>{data?.partial ? 'Consulta incompleta' : 'En los cursos asignados'}</small></article>
        <article><span>Borradores</span><strong>{data?.partial ? '—' : pending.length}</strong><small>Evaluaciones por publicar</small></article>
      </div>
      <div className={styles.columns}>
        <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Actividad de evaluaciones</h2><p>Evaluaciones registradas en tus cursos.</p></div><PortalLink to="doc-evaluaciones" className={styles.link}>Ver evaluaciones →</PortalLink></div>
          {assessments.length ? assessments.slice(0, 5).map((a) => <div className={styles.listRow} key={a.id}><div><strong>{a.title ?? a.titulo ?? 'Evaluación'}</strong><small>{a.courseName}</small></div><span className={styles.pill}>{estadoEvaluacion(a.status).label}</span></div>) : <p className={styles.empty}>No se registran evaluaciones disponibles.</p>}
        </section>
        <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Mis cursos</h2><p>Acceso rápido a tus asignaturas.</p></div><PortalLink to="doc-cursos" className={styles.link}>Ver todos →</PortalLink></div>
          {courses.length ? courses.slice(0, 5).map((c) => <div className={styles.listRow} key={c.id}><div><strong>{c.subject || c.name}</strong><small>{c.name}</small></div><PortalLink to="doc-curso" param={c.id} className={styles.link}>Entrar →</PortalLink></div>) : <p className={styles.empty}>No tienes cursos asignados.</p>}
        </section>
      </div>
      <footer className={styles.footer}>FeathersForAll · Espacio de aprendizaje</footer>
    </LoadState>
  </div>;
}
