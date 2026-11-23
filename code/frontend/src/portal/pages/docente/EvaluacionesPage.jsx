import { getCourses } from '../../../api/portalApi.js';
import { EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { EvaluacionesCard } from './EvaluacionesCard.jsx';
import gestion from './Gestion.module.css';

/** Docente · Evaluaciones: las de todos sus cursos, con acceso a crear una nueva en cada uno (H2). */
export function DocenteEvaluacionesPage() {
  const { data, loading, error, reload } = useApiData(getCourses);
  return (
    <>
      <PageHead title="Evaluaciones" subtitle="Crea evaluaciones de alternativas que se corrigen solas, publícalas y mira los resultados." />
      <LoadState loading={loading} error={error} onRetry={reload}>
        {data?.length === 0 && <EmptyState title="Aún no tienes cursos">Crea un curso para empezar a armar evaluaciones.</EmptyState>}
        <div className={gestion.rows} style={{ margin: 0, gap: 20 }}>
          {data?.map((curso) => <EvaluacionesCard key={curso.id} courseId={curso.id} titulo={curso.subject ?? curso.name} />)}
        </div>
      </LoadState>
    </>
  );
}
