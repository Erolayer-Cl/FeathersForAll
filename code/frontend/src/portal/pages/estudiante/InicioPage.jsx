import { LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useSession } from '../../session/useSession.js';
import { contarNotas, formatFecha, formatNota, periodosDe, primerNombre, promedioGeneral } from '../../utils/notas.js';
import { assessmentCategory, getStudentAssessmentDashboard, sortAssessments } from './studentAssessments.js';
import styles from './InicioPage.module.css';

export function EstudianteInicioPage() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiData(getStudentAssessmentDashboard, '', { cache: 'est/assessments/all' });
  const all = data?.courses ?? [];
  const period = periodosDe(all)[0];
  const courses = period ? all.filter((course) => course.period === period) : all;
  const upcoming = (data?.assessments ?? []).filter((ev) => assessmentCategory(ev) === 'pendiente').sort(sortAssessments);
  const today = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return <div className={styles.page}>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}>Estudiante · Inicio</span><h1>Hola, {primerNombre(user?.name) || 'estudiante'}</h1><p>Continúa avanzando en tu aprendizaje.</p></div>
      <div className={styles.date}><b>{today}</b><small>Mi espacio de aprendizaje</small></div>
    </header>
    <div className={styles.shortcuts}>
      <PortalLink to="est-evaluaciones" className={styles.shortcut}>Mis evaluaciones <span>Revisar pendientes →</span></PortalLink>
      <PortalLink to="est-tutor" className={styles.shortcut}>Tutor IA <span>Estudiar o practicar →</span></PortalLink>
      <PortalLink to="est-notas" className={styles.shortcut}>Mis notas <span>Consultar resultados →</span></PortalLink>
      <PortalLink to="est-progreso" className={styles.shortcut}>Mi progreso <span>Ver rendimiento →</span></PortalLink>
    </div>
    <div className={styles.columns}>
      <section className={styles.panel} aria-labelledby="mis-cursos-titulo">
        <div className={styles.sectionHeading}><div><h2 id="mis-cursos-titulo">Mis cursos</h2><p>Accede a tus asignaturas y actividades</p></div><PortalLink to="est-cursos" className={styles.link}>Ver todos →</PortalLink></div>
        <LoadState loading={loading} error={error} onRetry={reload}>
          {courses.length ? <div className={styles.courseList}>{courses.slice(0, 5).map((course) => <div className={styles.course} key={course.course_id}><div className={styles.courseHeading}><div><strong>{course.subject || course.course}</strong><small>{course.course} · {course.teacher_name || 'Docente sin asignar'}</small></div><PortalLink to="est-curso" param={course.course_id} className={styles.link}>Entrar →</PortalLink></div><div className={styles.barRow}><span>Promedio {formatNota(course.average)}</span><span>{course.tutor_available ? 'Tutor IA con apuntes' : 'Sin apuntes del docente'}</span></div></div>)}</div> : <p className={styles.empty}>Todavía no tienes cursos asignados.</p>}
          <p className={styles.summary}>Promedio general: <b>{formatNota(promedioGeneral(courses))}</b> · {contarNotas(courses)} notas registradas</p>
        </LoadState>
      </section>
      <div className={styles.stack}>
        <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Evaluaciones por rendir</h2><p>Pruebas que puedes realizar</p></div><PortalLink to="est-evaluaciones" className={styles.link}>Ver todas →</PortalLink></div>
          <LoadState loading={loading} error={error} onRetry={reload}>
            {upcoming.length ? <ul className={styles.evaluationList}>{upcoming.slice(0,4).map((ev) => <li key={ev.id}><div><b>{ev.title}</b><small>{ev.subject}{ev.closes_at ? ` · Hasta ${formatFecha(ev.closes_at)}` : ''}</small></div><PortalLink to="est-evaluacion" param={ev.id} className={styles.link}>Rendir →</PortalLink></li>)}</ul> : <p className={styles.empty}>No tienes evaluaciones pendientes.</p>}
          </LoadState>
        </section>
        <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>Practica con Pluma</h2><p>Aprendizaje y preparación</p></div></div><p className={styles.empty}>Elige un curso en Tutor IA y selecciona «Practicar una prueba» para entrenar con preguntas.</p><PortalLink to="est-tutor" className={styles.link}>Abrir el tutor →</PortalLink></section>
      </div>
    </div>
    <section className={styles.panel} aria-label="Horario"><div className={styles.sectionHeading}><div><h2>Mi horario</h2><p>Próximamente</p></div></div><p className={styles.empty}>El backend todavía no ofrece un servicio de horario. Tus asignaturas y evaluaciones sí están disponibles en las secciones anteriores.</p></section>
    <footer className={styles.footer}>FeathersForAll · Espacio de aprendizaje</footer>
  </div>;
}
