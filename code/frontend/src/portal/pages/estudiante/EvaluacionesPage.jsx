import { useState } from 'react';
import { LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { formatCierre, tiempoRestante } from '../../utils/fechas.js';
import { formatNota } from '../../utils/notas.js';
import { assessmentCategory, getStudentAssessmentDashboard, sortAssessments } from './studentAssessments.js';
import styles from './EvaluacionesPage.module.css';

const CATEGORIES = [
  { id: 'todas', name: 'Todas' },
  { id: 'pendiente', name: 'Por rendir' },
  { id: 'entregada', name: 'Entregadas' },
  { id: 'cerrada', name: 'Cerradas' },
];

export function EstudianteEvaluacionesPage() {
  const { data, loading, error, reload } = useApiData(getStudentAssessmentDashboard, '', { cache: 'est/assessments/all' });
  const [filter, setFilter] = useState('todas');
  const [courseFilter, setCourseFilter] = useState('todos');
  const [search, setSearch] = useState('');
  const all = data?.assessments ?? [];
  const counts = {
    pendientes: all.filter((ev) => assessmentCategory(ev) === 'pendiente').length,
    entregadas: all.filter((ev) => assessmentCategory(ev) === 'entregada').length,
    cerradas: all.filter((ev) => assessmentCategory(ev) === 'cerrada').length,
  };
  const visible = all.filter((ev) =>
    (filter === 'todas' || assessmentCategory(ev) === filter) &&
    (courseFilter === 'todos' || ev.courseId === courseFilter) &&
    `${ev.title} ${ev.subject}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))
  ).sort(sortAssessments);

  return <div className={styles.page}>
    <header className={styles.head}>
      <div><p className={styles.overline}>Estudiante · Actividad académica</p><h1>Mis evaluaciones</h1><p>Encuentra tus pruebas, revisa tus resultados y continúa aprendiendo.</p></div>
      <PortalLink to="est-cursos" className={styles.ghost}>Ver mis cursos</PortalLink>
    </header>
    <LoadState loading={loading} error={error} onRetry={reload}>
      <section className={styles.metrics} aria-label="Resumen de evaluaciones">
        <div><small>Por rendir</small><strong>{counts.pendientes}</strong><span>Evaluaciones disponibles</span></div>
        <div><small>Entregadas</small><strong>{counts.entregadas}</strong><span>Con respuesta registrada</span></div>
        <div><small>Cerradas sin entregar</small><strong>{counts.cerradas}</strong><span>Ya no disponibles</span></div>
      </section>
      {data?.partialErrors > 0 && <p className={styles.alert} role="status">No se pudieron consultar las evaluaciones de {data.partialErrors} curso(s). <button type="button" onClick={reload}>Reintentar</button></p>}
      <section className={styles.panel}>
        <div className={styles.sectionTop}><div><h2>Evaluaciones por curso</h2><p>Selecciona una evaluación para rendirla o revisar su detalle.</p></div><button className={styles.refresh} type="button" onClick={reload}>Actualizar</button></div>
        <div className={styles.filters}>
          <label className={styles.search}><span>Buscar</span><input type="search" placeholder="Buscar evaluación…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label className={styles.search}><span>Asignatura</span><select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}><option value="todos">Todas las asignaturas</option>{(data?.courses ?? []).map((course) => <option key={course.course_id} value={course.course_id}>{course.subject ?? course.course}</option>)}</select></label>
        </div>
        <div className={styles.tabs} role="group" aria-label="Filtrar por estado">
          {CATEGORIES.map((category) => <button key={category.id} type="button" className={filter === category.id ? styles.active : ''} aria-pressed={filter === category.id} onClick={() => setFilter(category.id)}>{category.name}</button>)}
        </div>
        <div className={styles.scroll} role="region" aria-label="Listado de evaluaciones" tabIndex={0}>
          <table className={styles.table}><thead><tr><th scope="col">Evaluación</th><th scope="col">Asignatura</th><th scope="col">Cierre</th><th scope="col">Estado</th><th scope="col">Acción</th></tr></thead>
            <tbody>{visible.map((ev) => { const category = assessmentCategory(ev); return <tr key={ev.id}>
              <th scope="row">{ev.title}<small>{ev.questions_count ?? '—'} preguntas</small></th>
              <td>{ev.subject}</td><td className={styles.cierre}>{ev.closes_at ? <>{formatCierre(ev.closes_at)}{category === 'pendiente' && <small>{tiempoRestante(ev.closes_at)}</small>}</> : 'Sin fecha de cierre'}</td>
              <td><span className={`${styles.status} ${styles[category]}`}>{category === 'pendiente' ? 'Por rendir' : category === 'entregada' ? `Entregada${ev.grade != null ? ` · ${formatNota(ev.grade)}` : ''}` : 'Cerrada'}</span></td>
              <td>{category === 'pendiente' ? <PortalLink className={styles.action} to="est-evaluacion" param={ev.id}>Rendir evaluación</PortalLink> : <PortalLink className={styles.action} to="est-curso" param={ev.courseId}>{category === 'entregada' ? 'Ver resultado' : 'Ver curso'}</PortalLink>}</td>
            </tr>; })}</tbody></table>
          {visible.length === 0 && <p className={styles.empty}>{all.length ? 'No hay evaluaciones que coincidan con los filtros.' : 'Todavía no tienes evaluaciones publicadas.'}</p>}
        </div>
      </section>
      <section className={styles.helper}><div><h2>¿Necesitas preparar una prueba?</h2><p>Usa el Tutor IA para repasar el contenido de tus cursos o practicar con preguntas.</p></div><PortalLink to="est-tutor" className={styles.action}>Abrir Tutor IA</PortalLink></section>
    </LoadState>
  </div>;
}
