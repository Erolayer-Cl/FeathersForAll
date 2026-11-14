import { useState } from 'react';
import { getAssessment, getAssessmentResults, setAssessmentStatus } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, FormMessage, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useSession } from '../../session/useSession.js';
import { estadoEvaluacion } from '../../utils/evaluaciones.js';
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
                        <td className={styles[tonoNota(s.grade)]}><b>{formatNota(s.grade)}</b></td>
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
  const { data: ev, loading, error, reload } = useApiData((t, opts) => getAssessment(t, assessmentId, opts), assessmentId);
  const [cambiando, setCambiando] = useState(false);
  const [problema, setProblema] = useState(null);

  async function cambiarEstado(status) {
    const texto = status === 'published'
      ? '¿Publicar la evaluación? Tus estudiantes podrán rendirla y ya no podrás editar sus preguntas.'
      : '¿Cerrar la evaluación? Nadie más podrá rendirla.';
    if (!window.confirm(texto)) return;
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

  const estado = estadoEvaluacion(ev?.status);
  return (
    <>
      <p className={gestion.crumbs}>
        <PortalLink to="doc-evaluaciones">Evaluaciones</PortalLink> / {ev?.title ?? 'Evaluación'}
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        {ev && (
          <>
            <PageHead title={ev.title} subtitle={ev.published_at ? `Publicada el ${formatFecha(ev.published_at)}` : 'Aún no está publicada: los estudiantes no la ven.'}>
              <Chip tone={estado.tone}>{estado.label}</Chip>
              {ev.status === 'draft' && <Button disabled={cambiando} onClick={() => cambiarEstado('published')}>{cambiando ? 'Publicando…' : 'Publicar'}</Button>}
              {ev.status === 'published' && <Button variant="warn" disabled={cambiando} onClick={() => cambiarEstado('closed')}>{cambiando ? 'Cerrando…' : 'Cerrar evaluación'}</Button>}
              <Button variant="ghost" href={`#/portal/doc-curso/${encodeURIComponent(ev.course_id)}`}>Volver al curso</Button>
            </PageHead>
            {problema && <FormMessage>{problema}</FormMessage>}

            <Card as="section" aria-labelledby="preguntas-titulo">
              <h2 id="preguntas-titulo" className={gestion.h2}>Preguntas ({ev.questions.length})</h2>
              <ol className={styles.preguntas}>
                {ev.questions.map((q) => (
                  <li key={q.id}>
                    <b>{q.statement}</b>
                    <ul className={styles.opciones}>
                      {q.options.map((o, k) => (
                        <li key={k} className={q.correct_option === k ? styles.correcta : undefined}>
                          {o}
                          {q.correct_option === k && <Chip tone="success">Correcta</Chip>}
                        </li>
                      ))}
                    </ul>
                    {q.correct_option === null && <FormMessage tone="info">Falta marcar la alternativa correcta: sin ella no se puede publicar.</FormMessage>}
                    {q.feedback && <p className={styles.retro}>Retroalimentación: {q.feedback}</p>}
                  </li>
                ))}
              </ol>
            </Card>

            {ev.status !== 'draft' && <Resultados assessmentId={assessmentId} preguntas={ev.questions} />}
          </>
        )}
      </LoadState>
    </>
  );
}
