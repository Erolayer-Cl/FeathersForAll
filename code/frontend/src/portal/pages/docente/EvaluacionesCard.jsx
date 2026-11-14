import { getAssessments } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { routeHref } from '../../router/parseRoute.js';
import { estadoEvaluacion } from '../../utils/evaluaciones.js';
import styles from './Gestion.module.css';

/** Docente · Evaluaciones de un curso: lista con su estado y cuántos entregaron, y acceso a crear otra (H2). */
export function EvaluacionesCard({ courseId, titulo }) {
  const { data, loading, error, reload } = useApiData((t, opts) => getAssessments(t, courseId, opts), courseId);
  const evaluaciones = data?.data ?? [];
  return (
    <Card as="section" aria-label={`Evaluaciones de ${titulo ?? 'este curso'}`}>
      <div className={styles.head}>
        <h2 className={styles.h2}>{titulo ? `Evaluaciones de ${titulo}` : 'Evaluaciones'}</h2>
        <Button size="sm" href={routeHref('doc-evaluacion-nueva', courseId)}>Nueva evaluación</Button>
      </div>
      <LoadState loading={loading} error={error} onRetry={reload}>
        {evaluaciones.length === 0 ? (
          <EmptyState title="Este curso aún no tiene evaluaciones">Crea la primera: se corrige sola y tus estudiantes ven su nota al terminar.</EmptyState>
        ) : (
          <ul className={styles.rows}>
            {evaluaciones.map((e) => {
              const estado = estadoEvaluacion(e.status);
              return (
                <li key={e.id} className={styles.row}>
                  <div className={styles.grow}>
                    <b>{e.title}</b>
                    <small>
                      {e.questions_count} pregunta{e.questions_count === 1 ? '' : 's'}
                      {e.status !== 'draft' && ` · ${e.submissions_count} entrega${e.submissions_count === 1 ? '' : 's'}`}
                    </small>
                  </div>
                  <Chip tone={estado.tone}>{estado.label}</Chip>
                  <a className={styles.rowLink} href={routeHref('doc-evaluacion', e.id)} aria-label={`Abrir ${e.title}`}>Abrir</a>
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </Card>
  );
}
