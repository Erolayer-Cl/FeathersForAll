import { useState } from 'react';
import { clearCache } from '../../../api/cache.js';
import { getAssessment, getAssessments, submitAssessment } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, FormMessage, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useNow } from '../../hooks/useNow.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useSession } from '../../session/useSession.js';
import { respondida, respuestasACuerpo, sinResponder } from '../../utils/evaluaciones.js';
import { formatCierre, tiempoRestante, tonoPlazo } from '../../utils/fechas.js';
import { formatFecha, formatNota, formatNumero, tonoNota } from '../../utils/notas.js';
import styles from './EvaluacionPage.module.css';

const LETRAS = 'ABCDEF';

/** "4 preguntas de alternativas", "1 pregunta de respuesta escrita" o "3 preguntas (2 de alternativas y 1 escrita)". */
function describirPreguntas(questions) {
  const n = questions.length;
  const escritas = questions.filter((q) => q.type === 'text').length;
  const total = `${n} pregunta${n === 1 ? '' : 's'}`;
  if (escritas === 0) return `${total} de alternativas`;
  if (escritas === n) return `${total} de respuesta escrita`;
  return `${total} (${n - escritas} de alternativas y ${escritas} escrita${escritas === 1 ? '' : 's'})`;
}

const NO_DISPONIBLE = { title: 'Evaluación no disponible', action: <Button size="sm" variant="soft" href="#/portal/est-cursos">Volver a Mis cursos</Button> };

/** La evaluación y, si ya la rindió, su entrada en la lista del curso (nota y fecha). */
async function cargar(token, assessmentId, opts) {
  const ev = await getAssessment(token, assessmentId, opts);
  const lista = await getAssessments(token, ev.course_id, opts);
  return { ev, mia: lista.data.find((e) => e.id === assessmentId) ?? null };
}

/** Resultado al instante: puntaje, nota y la retroalimentación de cada pregunta (H4). */
function Resultado({ ev, resultado }) {
  const porPregunta = new Map(ev.questions.map((q, i) => [q.id, { ...q, n: i + 1 }]));
  return (
    <>
      {resultado.pending_review > 0 && (
        <FormMessage tone="info">
          Tu nota es provisional: {resultado.pending_review === 1 ? '1 respuesta escrita espera' : `${resultado.pending_review} respuestas escritas esperan`} la
          revisión de tu docente. Mientras tanto cuenta{resultado.pending_review === 1 ? '' : 'n'} como incorrecta{resultado.pending_review === 1 ? '' : 's'}; la verás actualizada en Mis notas.
        </FormMessage>
      )}
      <div className={styles.kpis} role="status" aria-label="Tu resultado">
        <Kpi label="Tu nota" value={formatNota(resultado.grade)} hint="Escala 1,0 a 7,0" tone={tonoNota(resultado.grade) === 'danger' ? 'warning' : 'success'} />
        <Kpi label="Respuestas correctas" value={`${resultado.score} de ${resultado.max_score}`} hint={`${formatNumero(resultado.percentage)} % de logro`} />
      </div>
      <Card as="section" aria-labelledby="retro-titulo">
        <h2 id="retro-titulo" className={styles.h2}>Retroalimentación</h2>
        <ol className={styles.answers}>
          {resultado.answers.map((a) => {
            const q = porPregunta.get(a.question_id);
            return (
              <li key={a.question_id} className={a.correct ? styles.ok : styles.bad}>
                <div className={styles.answerHead}>
                  <b>{q ? `${q.n}. ${q.statement}` : 'Pregunta'}</b>
                  {a.pending_review
                    ? <Chip tone="warning">Por revisar</Chip>
                    : <Chip tone={a.correct ? 'success' : 'danger'}>{a.correct ? 'Correcta' : 'Incorrecta'}</Chip>}
                </div>
                {a.feedback && <p className={styles.feedback}>{a.feedback}</p>}
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}

/** Estudiante · Rendir una evaluación (est-evaluacion/<id>): responde, entrega y ve su nota y retroalimentación al instante (H4). */
export function EvaluacionPage({ param: assessmentId }) {
  const { token, expire } = useSession();
  const { data, loading, error, reload } = useApiData((t, opts) => cargar(t, assessmentId, opts), assessmentId);
  const key = useIdempotencyKey();
  const [elegidas, setElegidas] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [problema, setProblema] = useState(null);
  const [resultado, setResultado] = useState(null);
  const ev = data?.ev;
  const mia = data?.mia;
  // Se refresca cada 15 s: el aviso de tiempo baja solo y, al llegar la hora, el formulario se bloquea.
  const ahora = useNow(15_000);
  const vencida = Boolean(ev?.closes_at) && new Date(ev.closes_at).getTime() <= ahora;
  const respondidas = ev ? ev.questions.length - sinResponder(ev.questions, elegidas) : 0;

  async function entregar(e) {
    e.preventDefault();
    if (enviando) return;
    const faltan = sinResponder(ev.questions, elegidas);
    const aviso = faltan > 0
      ? `Te falta responder ${faltan} pregunta${faltan === 1 ? '' : 's'}: contarán como incorrectas. Solo tienes un intento. ¿Entregar de todos modos?`
      : 'Solo tienes un intento. ¿Entregar tus respuestas?';
    if (!window.confirm(aviso)) return;
    setEnviando(true);
    setProblema(null);
    try {
      setResultado(await submitAssessment(token, assessmentId, respuestasACuerpo(elegidas), key.get()));
      key.renew();
      clearCache(); // Inicio, Curso y Mis notas guardados tienen la evaluación sin nota: que no se vean así al volver

    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      if (err.status !== 0) key.renew();
      setProblema(err.message);
      if (err.status === 409) reload(); // ya la había rendido o se cerró: se muestra el estado real
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <p className={styles.crumbs}>
        <PortalLink to="est-cursos">Mis cursos</PortalLink> / {ev ? <PortalLink to="est-curso" param={ev.course_id}>Curso</PortalLink> : 'Curso'} / {ev?.title ?? 'Evaluación'}
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        {ev && (
          <>
            <PageHead title={ev.title} subtitle={`${describirPreguntas(ev.questions)} · un solo intento${ev.closes_at ? ` · ${vencida ? 'cerró' : 'cierra'} ${formatCierre(ev.closes_at, ahora)}` : ''}`}>
              {ev.closes_at && ev.status === 'published' && !mia?.submitted && !resultado && (
                <span className={styles.estado}><Chip tone={tonoPlazo(ev.closes_at, ahora)}>{vencida ? 'Tiempo terminado' : tiempoRestante(ev.closes_at, ahora)}</Chip></span>
              )}
            </PageHead>

            {resultado && (
              <>
                <FormMessage tone="success">Entregaste tu evaluación. Este es tu resultado:</FormMessage>
                <Resultado ev={ev} resultado={resultado} />
                <div><Button variant="soft" href={`#/portal/est-curso/${encodeURIComponent(ev.course_id)}`}>Volver al curso</Button></div>
              </>
            )}

            {!resultado && mia?.submitted && (
              <EmptyState title={`Ya rendiste esta evaluación · nota ${formatNota(mia.grade)}`}>
                La entregaste el {formatFecha(mia.submitted_at)}. Solo se permite un intento: puedes ver tus respuestas y la retroalimentación en el curso.
                <div style={{ marginTop: 12 }}><Button size="sm" href={`#/portal/est-curso/${encodeURIComponent(ev.course_id)}`}>Ver en el curso</Button></div>
              </EmptyState>
            )}

            {!resultado && !mia?.submitted && (ev.status === 'closed' || (ev.status === 'published' && vencida)) && (
              <EmptyState title={vencida && ev.status === 'published' ? 'Se acabó el tiempo' : 'Esta evaluación ya está cerrada'}>
                {ev.closes_at ? `Cerró ${formatCierre(ev.closes_at, ahora)} y ya no se puede rendir.` : 'Ya no se puede rendir.'} Si crees que es un error, habla con tu docente.
              </EmptyState>
            )}

            {!resultado && !mia?.submitted && ev.status === 'published' && !vencida && (
              <form onSubmit={entregar} aria-busy={enviando} className={styles.form}>
                {ev.questions.map((q, i) => {
                  const lista = respondida(elegidas[q.id]);
                  return (
                    <Card as="fieldset" key={q.id} className={styles.pregunta}>
                      <legend className={styles.legend}>
                        <span className={styles.numero}>Pregunta {i + 1} <span>de {ev.questions.length}</span></span>
                        {lista && <span className={styles.respondida}>Respondida</span>}
                      </legend>
                      <p className={styles.enunciado} id={`enunciado-${q.id}`}>{q.statement}</p>
                      {q.type === 'text' ? (
                        <div className={styles.escrita}>
                          <textarea
                            className={styles.respuesta}
                            aria-labelledby={`enunciado-${q.id}`}
                            maxLength={1000}
                            rows={3}
                            placeholder="Escribe tu respuesta"
                            value={elegidas[q.id] ?? ''}
                            onChange={(e) => setElegidas((x) => ({ ...x, [q.id]: e.target.value }))}
                          />
                          <small className={styles.contador}>{(elegidas[q.id] ?? '').length} / 1000</small>
                        </div>
                      ) : (
                      <div className={styles.opciones}>
                        {q.options.map((texto, k) => (
                          <label key={k} className={`${styles.opcion} ${elegidas[q.id] === k ? styles.elegida : ''}`}>
                            <input
                              type="radio"
                              className={styles.radio}
                              name={`pregunta-${q.id}`}
                              checked={elegidas[q.id] === k}
                              onChange={() => setElegidas((x) => ({ ...x, [q.id]: k }))}
                            />
                            <span className={styles.letra} aria-hidden="true">{LETRAS[k]}</span>
                            <span className={styles.texto}>{texto}</span>
                          </label>
                        ))}
                      </div>
                      )}
                    </Card>
                  );
                })}
                {problema && <FormMessage>{problema}</FormMessage>}
                <div className={styles.footer}>
                  <Button type="submit" disabled={enviando}>{enviando ? 'Entregando…' : 'Entregar evaluación'}</Button>
                  <div className={styles.avance}>
                    <span className={styles.progreso} aria-live="polite">{respondidas} de {ev.questions.length} respondidas</span>
                    <span className={styles.barra} aria-hidden="true"><span style={{ width: `${(respondidas / ev.questions.length) * 100}%` }} /></span>
                  </div>
                </div>
              </form>
            )}
          </>
        )}
      </LoadState>
    </>
  );
}
