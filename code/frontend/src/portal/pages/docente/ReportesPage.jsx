import { getCourses, getGradebook, getGradesSummary } from '../../../api/portalApi.js';
import { Card, EmptyState, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { normalizarEstado } from '../../utils/evaluaciones.js';
import { formatNota, tonoNota } from '../../utils/notas.js';
import gestion from './Gestion.module.css';
import styles from './Notas.module.css';

/** Por cada curso: su promedio (libro) y su resumen (riesgo y entregas). Dos peticiones por curso, en paralelo. */
async function cargar(token, opts) {
  const cursos = await getCourses(token, opts);
  return Promise.all(cursos.map(async (curso) => {
    const [libro, resumen] = await Promise.all([getGradebook(token, curso.id, opts), getGradesSummary(token, curso.id, opts)]);
    return {
      id: curso.id,
      nombre: curso.subject ?? curso.name,
      grupo: curso.name,
      estudiantes: resumen.enrolled_students,
      promedio: libro.course_average,
      enRiesgo: resumen.at_risk.length,
      evaluaciones: resumen.assessments.filter((a) => normalizarEstado(a.status) !== 'draft').length,
      // Solo las abiertas: en una cerrada ya nadie puede entregar.
      pendientes: resumen.assessments.filter((a) => normalizarEstado(a.status) === 'published').reduce((n, a) => n + a.pending, 0),
    };
  }));
}

/** Docente · Reportes: cómo va cada curso (promedio, estudiantes en riesgo y entregas pendientes) (H3). */
export function DocenteReportesPage() {
  const { data, loading, error, reload } = useApiData(cargar);
  const cursos = data ?? [];
  const totalRiesgo = cursos.reduce((n, c) => n + c.enRiesgo, 0);
  const totalPendientes = cursos.reduce((n, c) => n + c.pendientes, 0);

  return (
    <>
      <PageHead title="Reportes" subtitle="Cómo van tus cursos. Para el detalle de cada estudiante, abre el libro de notas." />
      <LoadState loading={loading} error={error} onRetry={reload}>
        <div className={styles.kpis}>
          <Kpi label="Cursos" value={String(cursos.length)} hint="Que dictas" />
          <Kpi label="En riesgo" value={String(totalRiesgo)} hint="Promedio bajo 4,0, sumando cursos" tone={totalRiesgo > 0 ? 'danger' : 'success'} />
          <Kpi label="Entregas pendientes" value={String(totalPendientes)} hint="En evaluaciones abiertas" tone="warning" />
        </div>

        <Card as="section" aria-labelledby="reporte-titulo">
          <h2 id="reporte-titulo" className={gestion.h2}>Por curso</h2>
          {cursos.length === 0 ? (
            <EmptyState title="Aún no tienes cursos">Cuando tengas cursos con evaluaciones, verás aquí cómo van.</EmptyState>
          ) : (
            <div className={styles.scroll} role="region" aria-label="Reporte por curso" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Curso</th><th scope="col">Estudiantes</th><th scope="col">Promedio</th><th scope="col">En riesgo</th>
                    <th scope="col">Evaluaciones</th><th scope="col">Pendientes</th><th scope="col"><span className={styles.srOnly}>Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cursos.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">{c.nombre}<small className={styles.subFila}>{c.grupo}</small></th>
                      <td>{c.estudiantes}</td>
                      <td className={`${styles.average} ${styles[tonoNota(c.promedio)]}`}>{formatNota(c.promedio)}</td>
                      <td className={c.enRiesgo > 0 ? styles.danger : undefined}>{c.enRiesgo}</td>
                      <td>{c.evaluaciones}</td>
                      <td>{c.pendientes}</td>
                      <td><PortalLink className={gestion.rowLink} to="doc-libro" param={c.id} aria-label={`Libro de notas de ${c.nombre}`}>Libro de notas</PortalLink></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </LoadState>
    </>
  );
}
