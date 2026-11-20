import { getCourse, getEnrollments, getStudentGrades } from '../../../api/portalApi.js';
import { Button, Card, EmptyState, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { routeHref } from '../../router/parseRoute.js';
import { leerParamEstudiante } from '../../utils/libroNotas.js';
import { formatFecha, formatNota, formatNumero, tonoNota } from '../../utils/notas.js';
import gestion from './Gestion.module.css';
import styles from './Notas.module.css';

const NO_DISPONIBLE = { title: 'Estudiante no disponible', action: <Button size="sm" variant="soft" href={routeHref('doc-estudiantes')}>Volver a Mis estudiantes</Button> };
const NO_ENCONTRADO = Object.assign(new Error('El enlace no indica el curso y el estudiante.'), { status: 404 });

/** Curso, nombre del estudiante (de la lista de matriculados) y sus notas en ese curso. */
async function cargar(token, ids, opts) {
  if (!ids) throw NO_ENCONTRADO;
  const [curso, matriculas, notas] = await Promise.all([
    getCourse(token, ids.courseId, opts),
    getEnrollments(token, ids.courseId, opts),
    getStudentGrades(token, ids.courseId, ids.studentId, opts),
  ]);
  const estudiante = matriculas.data.find((m) => m.student_id === ids.studentId) ?? null;
  return { curso, estudiante, notas };
}

/** Docente · Notas de un estudiante en un curso (doc-estudiante/<curso>/<estudiante>), solo lectura (H3). */
export function DocenteEstudianteNotasPage({ param }) {
  const ids = leerParamEstudiante(param);
  const { data, loading, error, reload } = useApiData((t, opts) => cargar(t, ids, opts), param ?? '');
  const nombreCurso = data?.curso.subject ?? data?.curso.name ?? 'Curso';
  const nombre = data?.estudiante?.name ?? 'Estudiante';
  const notas = data?.notas.grades ?? [];

  return (
    <>
      <p className={gestion.crumbs}>
        <PortalLink to="doc-estudiantes">Mis estudiantes</PortalLink>
        {ids && <> / <PortalLink to="doc-libro" param={ids.courseId}>Libro de {nombreCurso}</PortalLink></>} / {nombre}
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        <PageHead
          title={nombre}
          subtitle={`${nombreCurso} · ${data?.curso.name ?? ''}${data?.estudiante ? ` · ${data.estudiante.email}` : ' · Ya no está matriculado en este curso'}`}
        >
          {ids && <Button size="sm" variant="ghost" href={routeHref('doc-libro', ids.courseId)}>Volver al libro</Button>}
        </PageHead>

        <div className={styles.kpis}>
          <Kpi label="Promedio" value={formatNota(data?.notas.average)} hint="Ponderado, escala 1,0 a 7,0" tone={tonoNota(data?.notas.average) === 'danger' ? 'danger' : 'success'} />
          <Kpi label="Evaluaciones rendidas" value={String(notas.length)} hint="En este curso" />
        </div>

        <Card as="section" aria-labelledby="notas-est-titulo">
          <h2 id="notas-est-titulo" className={gestion.h2}>Notas</h2>
          {notas.length === 0 ? (
            <EmptyState title="Aún no rinde evaluaciones">Cuando entregue una, verás aquí su nota.</EmptyState>
          ) : (
            <div className={styles.scroll} role="region" aria-label={`Notas de ${nombre}`} tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr><th scope="col">Evaluación</th><th scope="col">Logro</th><th scope="col">Nota</th><th scope="col">Ponderación</th><th scope="col">Entregó</th></tr>
                </thead>
                <tbody>
                  {notas.map((n) => (
                    <tr key={n.assessment_id}>
                      <th scope="row"><PortalLink to="doc-evaluacion" param={n.assessment_id}>{n.title}</PortalLink></th>
                      <td>{n.score === null || n.score === undefined ? '—' : `${formatNumero(n.score)} %`}</td>
                      <td className={`${styles.average} ${styles[tonoNota(n.grade)]}`}>{formatNota(n.grade)}</td>
                      <td>{formatNumero(n.weight)}</td>
                      <td>{formatFecha(n.submitted_at)}</td>
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
