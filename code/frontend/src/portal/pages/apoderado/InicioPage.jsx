import { getMyWards } from '../../../api/portalApi.js';
import { Card, Chip, EmptyState, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { formatCierre, formatDuracion } from '../../utils/fechas.js';
import { formatFecha, formatNota, tonoNota } from '../../utils/notas.js';
import { resumenPupilo } from '../../utils/apoderado.js';
import styles from './InicioPage.module.css';

/** Un pupilo: KPIs, ramos con promedio, notas (provisionales marcadas) y lo que tiene por rendir. */
function Pupilo({ pupilo }) {
  const r = resumenPupilo(pupilo);
  return (
    <Card as="section" aria-labelledby={`pupilo-${pupilo.student_id}`} className={styles.pupilo}>
      <h2 id={`pupilo-${pupilo.student_id}`} className={styles.h2}>{pupilo.name}</h2>
      <div className={styles.kpis}>
        <Kpi label="Promedio general" value={formatNota(r.promedio)} hint="Promedio de sus asignaturas" tone={tonoNota(r.promedio) === 'danger' ? 'warning' : 'success'} />
        <Kpi label="Asignaturas bajo 4,0" value={String(r.bajoCuatro)} hint="Con el promedio actual" tone={r.bajoCuatro > 0 ? 'danger' : 'success'} />
        <Kpi label="Por rendir" value={String(r.pendientes)} hint="Evaluaciones disponibles" tone={r.pendientes > 0 ? 'warning' : 'success'} />
      </div>
      {!pupilo.courses.length && <EmptyState>Aún no tiene asignaturas este período.</EmptyState>}
      <ul className={styles.ramos}>
        {pupilo.courses.map((c) => (
          <li key={c.course_id} className={styles.ramo}>
            <div className={styles.ramoHead}>
              <div>
                <b>{c.subject ?? c.course}</b>
                <small>{c.course} · {c.teacher_name}</small>
              </div>
              <b className={`${styles.promedio} ${styles[tonoNota(c.average)] ?? ''}`} aria-label={`Promedio ${formatNota(c.average)}`}>{formatNota(c.average)}</b>
            </div>
            {c.grades.length > 0 && (
              <table className={styles.tabla}>
                <caption className={styles.sr}>Notas de {c.subject ?? c.course}</caption>
                <thead><tr><th scope="col">Evaluación</th><th scope="col">Nota</th><th scope="col">Entregada</th></tr></thead>
                <tbody>
                  {c.grades.map((g) => (
                    <tr key={g.assessment_id}>
                      <th scope="row">{g.title}</th>
                      <td className={styles[tonoNota(g.grade)]}>
                        {formatNota(g.grade)}
                        {g.pending_review > 0 && <Chip tone="warning">Provisional</Chip>}
                      </td>
                      <td>{formatFecha(g.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.pending.length > 0 && (
              <p className={styles.pendientes}>
                Por rendir: {c.pending.map((p) => `${p.title}${p.closes_at ? ` (cierra ${formatCierre(p.closes_at)})` : ''}${p.duration_minutes ? ` · ${formatDuracion(p.duration_minutes)}` : ''}`).join('; ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Apoderado · Mis pupilos (MVP 5): seguimiento del avance, solo lectura. */
export function ApoderadoInicioPage() {
  const { data, loading, error, reload } = useApiData(getMyWards, '', { cache: 'apo-pupilos' });
  const pupilos = data?.wards ?? [];
  return (
    <>
      <PageHead title="Mis pupilos" subtitle="Notas, promedios y evaluaciones por rendir de los estudiantes a tu cargo. Solo lectura." />
      <LoadState loading={loading} error={error} onRetry={reload}>
        {!pupilos.length ? (
          <EmptyState title="Aún no tienes pupilos vinculados">Pide al colegio que vincule a tu pupilo con tu cuenta.</EmptyState>
        ) : (
          <div className={styles.lista}>{pupilos.map((p) => <Pupilo key={p.student_id} pupilo={p} />)}</div>
        )}
        <p className={styles.nota}>Las notas provisionales tienen respuestas escritas que el docente aún revisa. Por privacidad, aquí no se muestran las respuestas ni las conversaciones con el tutor.</p>
      </LoadState>
    </>
  );
}
