import { useState } from 'react';
import { deleteAssessment, getAssessment, getAssessmentResults, setAssessmentStatus } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, FormMessage, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useNow } from '../../hooks/useNow.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { estadoEvaluacion } from '../../utils/evaluaciones.js';
import { formatCierre } from '../../utils/fechas.js';
import { CierreEvaluacion } from './CierreEvaluacion.jsx';
import { RevisionRespuestas } from './RevisionRespuestas.jsx';
import { formatFecha, formatNota, formatNumero, tonoNota } from '../../utils/notas.js';
import styles from './EvaluacionPage.module.css';
import gestion from './Gestion.module.css';

const NO_DISPONIBLE = { title: 'Evaluación no disponible', action: <Button size="sm" variant="soft" href="#/portal/doc-evaluaciones">Volver a Evaluaciones</Button> };

/** Resultados de la evaluación (H3): entregas, promedio, notas por estudiante y acierto por pregunta. */
function Resultados({ assessmentId, preguntas }) {
  const { data, loading, error, reload } = useApiData((t, opts) => getAssessmentResults(t, assessmentId, opts), assessmentId);
  return (
    <Card as="section" aria-labelledby="resultados-titulo">
      <div className={gestion.head}>
        <h2 id="resultados-titulo" className={gestion.h2}>Resultados</h2>
        <Button size="sm" variant="soft" onClick={reload}>Actualizar</Button>
      </div>
      <LoadState loading={loading} error={error} onRetry={reload}>
        {data?.submissions_count === 0 ? (
          <EmptyState title="Nadie ha entregado todavía">Cuando tus estudiantes la rindan, verás aquí el promedio y qué preguntas costaron más.</EmptyState>
        ) : (
          data && (
            <>
              <div className={styles.kpis}>
                <Kpi label="Entregas" value={String(data.submissions_count)} hint="Estudiantes que la rindieron" />
                <Kpi label="Logro promedio" value={`${formatNumero(data.average_score)} %`} hint="Respuestas correctas" tone="success" />
                <Kpi label="Nota promedio" value={formatNota(data.average_grade)} hint="Escala 1,0 a 7,0" tone="warning" />
              </div>

              <h3 className={styles.h3}>Acierto por pregunta</h3>
              <ul className={styles.rows}>
                {data.questions.map((p) => {
                  const pct = Math.round(p.correct_rate * 100);
                  return (
                    <li key={p.question_id} className={styles.acierto}>
                      <span className={styles.aciertoTexto}>Pregunta {p.order}: {preguntas?.[p.order - 1]?.statement}</span>
                      <span className={styles.barra} role="img" aria-label={`${pct} % acertó`}><span style={{ width: `${pct}%` }} /></span>
                      <b>{pct} %</b>
                    </li>
                  );
                })}
              </ul>

              <h3 className={styles.h3}>Notas por estudiante</h3>
              <div className={styles.scroll} role="region" aria-label="Notas por estudiante" tabIndex={0}>
                <table className={styles.table}>
                  <thead><tr><th scope="col">Estudiante</th><th scope="col">Logro</th><th scope="col">Nota</th><th scope="col">Entregó</th></tr></thead>
                  <tbody>
                    {data.students.map((s) => (
                      <tr key={s.student_id}>
                        <th scope="row">{s.name}</th>
                        <td>{formatNumero(s.score)} %</td>
                        <td className={styles[tonoNota(s.grade)]}>
                          <b>{formatNota(s.grade)}</b>
                          {s.pending_review > 0 && <small> · provisional ({s.pending_review} por revisar)</small>}
                        </td>
                        <td>{formatFecha(s.submitted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </LoadState>
    </Card>
  );
}

/** Docente · Evaluación (doc-evaluacion/<id>): preguntas con su correcta, publicar o cerrar (H2) y resultados (H3). */
export function DocenteEvaluacionPage({ param: assessmentId }) {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const { data: ev, loading, error, reload } = useApiData((t, opts) => getAssessment(t, assessmentId, opts), assessmentId);
  const [cambiando, setCambiando] = useState(false);
  const [problema, setProblema] = useState(null);
  const ahora = useNow();
  const [panelCierre, setPanelCierre] = useState(null); // 'publicar' | 'cambiar' | null
  const [aviso, setAviso] = useState(null);
  const [revisiones, setRevisiones] = useState(0); // al revisar una respuesta se refrescan los resultados

  // Publicar abre el panel de cierre (CierreEvaluacion); aquí solo queda cerrar a mano.
  async function cambiarEstado(status) {
    if (!window.confirm('¿Cerrar la evaluación ahora? Nadie más podrá rendirla.')) return;
    setCambiando(true);
    setProblema(null);
    try {
      await setAssessmentStatus(token, assessmentId, status);
      reload();
    } catch (err) {
      if (err.status === 401) expire();
      else setProblema(err.message);
    } finally {
      setCambiando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este borrador? Se borran sus preguntas y no se puede deshacer.')) return;
    setCambiando(true);
    setProblema(null);
    try {
      await deleteAssessment(token, assessmentId);
      navigate('doc-curso', ev.course_id);
    } catch (err) {
      if (err.status === 401) expire();
      else setProblema(err.message);
      setCambiando(false);
    }
  }

  const estado = estadoEvaluacion(ev?.status);
  const vencio = ev?.closes_at && new Date(ev.closes_at).getTime() <= ahora;
  const lineaCierre = ev?.closes_at
    ? `${ev.status === 'published' && !vencio ? 'cierra' : ev.status === 'draft' ? 'cierre previsto' : 'cerró'} ${formatCierre(ev.closes_at, ahora)}`
    : ev?.status === 'published' ? 'sin cierre automático' : null;
  const subtitulo = [ev?.published_at ? `Publicada el ${formatFecha(ev.published_at)}` : 'Aún no está publicada: los estudiantes no la ven.', lineaCierre].filter(Boolean).join(' · ');

  function listo(texto) {
    return () => {
      setPanelCierre(null);
      setAviso(texto);
      reload();
    };
  }
  return (
    <>
      <p className={gestion.crumbs}>
        <PortalLink to="doc-evaluaciones">Evaluaciones</PortalLink> / {ev?.title ?? 'Evaluación'}
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        {ev && (
          <>
            <PageHead title={ev.title} subtitle={subtitulo}>
              <span className={styles.estado}><Chip tone={estado.tone}>{estado.label}</Chip></span>
              {ev.status === 'draft' && <Button disabled={cambiando || panelCierre === 'publicar'} onClick={() => { setPanelCierre('publicar'); setAviso(null); }}>Publicar</Button>}
              {ev.status === 'draft' && <Button variant="soft" href={`#/portal/doc-evaluacion-editar/${encodeURIComponent(assessmentId)}`}>Editar</Button>}
              {ev.status === 'draft' && <Button variant="warn" disabled={cambiando} onClick={eliminar}>Eliminar borrador</Button>}
              {ev.status === 'published' && <Button variant="soft" disabled={cambiando || panelCierre === 'cambiar'} onClick={() => { setPanelCierre('cambiar'); setAviso(null); }}>Cambiar cierre</Button>}
              {ev.status === 'published' && <Button variant="warn" disabled={cambiando} onClick={() => cambiarEstado('closed')}>{cambiando ? 'Cerrando…' : 'Cerrar evaluación'}</Button>}
              <Button variant="ghost" href={`#/portal/doc-curso/${encodeURIComponent(ev.course_id)}`}>Volver al curso</Button>
            </PageHead>
            {problema && <FormMessage>{problema}</FormMessage>}
            {aviso && <FormMessage tone="success">{aviso}</FormMessage>}
            {panelCierre && (
              <CierreEvaluacion
                ev={ev}
                modo={panelCierre}
                onCancelar={() => setPanelCierre(null)}
                onListo={(nueva) => listo(panelCierre === 'publicar'
                  ? `Evaluación publicada. ${nueva.closes_at ? `Se cierra ${formatCierre(nueva.closes_at)}` : 'No se cierra sola: ciérrala tú cuando quieras.'}`
                  : nueva.closes_at ? `Nuevo cierre: ${formatCierre(nueva.closes_at)}` : 'Ahora no se cierra sola: ciérrala tú cuando quieras.')()}
              />
            )}

            <Card as="section" aria-labelledby="preguntas-titulo">
              <h2 id="preguntas-titulo" className={gestion.h2}>Preguntas ({ev.questions.length})</h2>
              <ol className={styles.preguntas}>
                {ev.questions.map((q) => (
                  <li key={q.id}>
                    <b>{q.statement}</b>
                    {q.type === 'text' ? (
                      <>
                        {q.accepted_answers?.length > 0 && <p className={styles.tipoTexto}>Respuesta escrita · se acepta:</p>}
                        <ul className={styles.opciones}>
                          {(q.accepted_answers ?? []).map((a) => <li key={a} className={styles.correcta}>{a}<Chip tone="success">Aceptada</Chip></li>)}
                        </ul>
                        {!q.accepted_answers?.length && <p className={styles.tipoTexto}>Sin respuestas aceptadas: tú revisas cada respuesta.</p>}
                      </>
                    ) : (
                      <>
                        <ul className={styles.opciones}>
                          {q.options.map((o, k) => (
                            <li key={k} className={q.correct_option === k ? styles.correcta : undefined}>
                              {o}
                              {q.correct_option === k && <Chip tone="success">Correcta</Chip>}
                            </li>
                          ))}
                        </ul>
                        {q.correct_option === null && <FormMessage tone="info">Falta marcar la alternativa correcta: sin ella no se puede publicar.</FormMessage>}
                      </>
                    )}
                    {q.feedback && <p className={styles.retro}>Retroalimentación: {q.feedback}</p>}
                  </li>
                ))}
              </ol>
            </Card>

            {ev.status !== 'draft' && ev.questions.some((q) => q.type === 'text') && (
              <RevisionRespuestas assessmentId={assessmentId} onRevisada={() => setRevisiones((n) => n + 1)} />
            )}
            {ev.status !== 'draft' && <Resultados key={revisiones} assessmentId={assessmentId} preguntas={ev.questions} />}
          </>
        )}
      </LoadState>
    </>
  );
}
