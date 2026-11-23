import { useState } from 'react';
import { getAssessment, updateAssessment } from '../../../api/portalApi.js';
import { Button, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { borradorDesdeApi } from '../../utils/evaluaciones.js';
import { EditorEvaluacion } from './EditorEvaluacion.jsx';
import gestion from './Gestion.module.css';

const NO_DISPONIBLE = { title: 'Evaluación no disponible', action: <Button size="sm" variant="soft" href="#/portal/doc-evaluaciones">Volver a Evaluaciones</Button> };

/** Docente · Editar un borrador (doc-evaluacion-editar/<id>): cambia título, cierre y preguntas, también si vino de la IA. */
export function DocenteEvaluacionEditarPage({ param: assessmentId }) {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const { data: ev, loading, error: errorCarga, reload } = useApiData((t, opts) => getAssessment(t, assessmentId, opts), assessmentId);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(cuerpo) {
    setEnviando(true);
    setError(null);
    try {
      await updateAssessment(token, assessmentId, cuerpo);
      navigate('doc-evaluacion', assessmentId);
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <>
      <p className={gestion.crumbs}>
        <PortalLink to="doc-evaluaciones">Evaluaciones</PortalLink> / {ev ? <PortalLink to="doc-evaluacion" param={assessmentId}>{ev.title}</PortalLink> : 'Evaluación'} / Editar
      </p>
      <LoadState loading={loading} error={errorCarga} onRetry={reload} notFound={NO_DISPONIBLE}>
        {ev && ev.status !== 'draft' && (
          <EmptyState title="Esta evaluación ya no se puede editar">
            Solo se editan los borradores: una evaluación publicada o cerrada ya tiene entregas y notas.
            <div style={{ marginTop: 12 }}><Button size="sm" href={`#/portal/doc-evaluacion/${encodeURIComponent(assessmentId)}`}>Volver a la evaluación</Button></div>
          </EmptyState>
        )}
        {ev && ev.status === 'draft' && (
          <>
            <PageHead title="Editar borrador" subtitle="Corrige lo que quieras antes de publicar. Al guardar se reemplazan las preguntas." />
            <EditorEvaluacion
              initial={borradorDesdeApi(ev)}
              enviando={enviando}
              error={error}
              etiqueta="Guardar cambios"
              cancelarHref={`#/portal/doc-evaluacion/${encodeURIComponent(assessmentId)}`}
              onGuardar={guardar}
            />
          </>
        )}
      </LoadState>
    </>
  );
}
