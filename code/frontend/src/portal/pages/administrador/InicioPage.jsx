import { getCourses } from '../../../api/portalApi.js';
import { LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useSession } from '../../session/useSession.js';
import styles from './InicioPage.module.css';

/** Panel administrativo: datos reales de cursos visibles para el colegio del administrador. */
export function AdministradorInicioPage() {
  const { user } = useSession();
  const { data, loading, error, reload } = useApiData(getCourses);
  const courses = data ?? [];
  const withCounts = courses.every((c) => Number.isFinite(c.students_count));
  const enrolled = withCounts ? courses.reduce((total, c) => total + c.students_count, 0) : null;
  const subjects = new Set(courses.map((c) => c.subject || c.name).filter(Boolean));
  return <div className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>Administrador · Plataforma</span><h1>Panel de administración</h1><p>Información y gestión académica de tu establecimiento.</p></div><div className={styles.school}>{user?.school?.name || 'Establecimiento'}<small>RBD {user?.school?.rbd || '—'}</small></div></header>
    <LoadState loading={loading} error={error} onRetry={reload}>
      <div className={styles.stats}>
        <article><span>Cursos registrados</span><strong>{courses.length}</strong><small>Visibles en tu establecimiento</small></article>
        <article><span>Asignaturas</span><strong>{subjects.size}</strong><small>Áreas académicas registradas</small></article>
        <article><span>Matrículas en cursos</span><strong>{enrolled ?? '—'}</strong><small>{enrolled === null ? 'Sin información disponible' : 'Puede incluir estudiantes repetidos'}</small></article>
        <article><span>Usuarios registrados</span><strong>—</strong><small>La API actual no expone un listado de usuarios</small></article>
      </div>
      <div className={styles.columns}>
        <section className={styles.card}><div className={styles.cardTitle}><div><h2>Cursos del establecimiento</h2><p>Consulta las asignaturas registradas y su estado de material.</p></div><PortalLink to="adm-cursos" className={styles.action}>Ver cursos →</PortalLink></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Curso</th><th>Asignatura</th><th>Estudiantes</th><th>Material</th></tr></thead><tbody>{courses.slice(0, 7).map((c) => <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.subject || '—'}</td><td>{c.students_count ?? '—'}</td><td>{typeof c.tutor_documents === 'number' ? `${c.tutor_documents} documentos` : c.tutor_available ? 'Disponible' : '—'}</td></tr>)}</tbody></table></div>
          {!courses.length && <p className={styles.empty}>Todavía no hay cursos registrados.</p>}
        </section>
        <section className={styles.card}><div className={styles.cardTitle}><div><h2>Gestión de la plataforma</h2><p>Secciones administrativas</p></div></div>
          <div className={styles.shortcuts}><PortalLink to="adm-cursos">Cursos <span>→</span></PortalLink><PortalLink to="adm-usuarios">Usuarios <span>→</span></PortalLink><PortalLink to="adm-evaluaciones">Evaluaciones <span>→</span></PortalLink><PortalLink to="adm-reportes">Reportes <span>→</span></PortalLink></div>
          <p className={styles.helper}>Las secciones que aún no cuentan con implementación mostrarán la pantalla pendiente del proyecto.</p>
        </section>
      </div>
    </LoadState>
    <footer className={styles.footer}>FeathersForAll · Administración académica</footer>
  </div>;
}
