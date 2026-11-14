import { useState } from 'react';
import { createAssessment, getCourse } from '../../../api/portalApi.js';
import { LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { borradorVacio } from '../../utils/evaluaciones.js';
import { EditorEvaluacion } from './EditorEvaluacion.jsx';
import gestion from './Gestion.module.css';

/**
 * Docente · Nueva evaluación (H2, doc-evaluacion-nueva/<curso>): se escribe a mano, se genera con IA, o ambas cosas
 * (la IA propone y el docente edita). Se guarda en borrador; se publica en la pantalla siguiente.
 */
export function DocenteEvaluacionNuevaPage({ param: courseId }) {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const curso = useApiData((t, opts) => getCourse(t, courseId, opts), courseId);
  const key = useIdempotencyKey();
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(cuerpo) {
    setEnviando(true);
    setError(null);
    try {
      const ev = await createAssessment(token, courseId, cuerpo, key.get());
      key.renew();
      navigate('doc-evaluacion', ev.id);
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      if (err.status !== 0) key.renew();
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <>
      <p className={gestion.crumbs}>
        <PortalLink to="doc-cursos">Mis cursos</PortalLink> / <PortalLink to="doc-curso" param={courseId}>{curso.data?.subject ?? curso.data?.name ?? 'Curso'}</PortalLink> / Nueva evaluación
      </p>
      <PageHead title="Nueva evaluación" subtitle="Escríbela tú, pídele un borrador a la IA o combina ambas: siempre puedes editar antes de publicar." />
      <LoadState loading={curso.loading} error={curso.error} onRetry={curso.reload}>
        <EditorEvaluacion
          initial={borradorVacio()}
          courseId={courseId}
          enviando={enviando}
          error={error}
          etiqueta="Guardar borrador"
          cancelarHref={`#/portal/doc-curso/${encodeURIComponent(courseId)}`}
          onGuardar={guardar}
        />
      </LoadState>
    </>
  );
}
