import { useEffect, useRef, useState } from 'react';
import { clearCache } from '../../../api/cache.js';
import { getAssessment, getAssessments, startAttempt, submitAssessment } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, FormMessage, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useNow } from '../../hooks/useNow.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useSession } from '../../session/useSession.js';
import { respondida, respuestasACuerpo, sinResponder } from '../../utils/evaluaciones.js';
import { formatCierre, formatDuracion, tiempoRestante, tonoPlazo } from '../../utils/fechas.js';
import { ENTREGA_ANTICIPADA_MS, borrarBorrador, desfaseReloj, guardarBorrador, leerBorrador, plazoDe, relojRestante, tonoReloj } from '../../utils/intento.js';
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

/** La evaluación y, si ya la rindió, su entrada en la lista del curso (nota y fecha). `desfase`: reloj del servidor − equipo. */
async function cargar(token, assessmentId, opts) {
  const ev = await getAssessment(token, assessmentId, opts);
  const desfase = desfaseReloj(ev.server_time);
  const lista = await getAssessments(token, ev.course_id, opts);
  return { ev, desfase, mia: lista.data.find((e) => e.id === assessmentId) ?? null };
}

/** Antes de empezar una evaluación con tiempo: cuánto dura y qué pasa al acabarse. */
function Empezar({ ev, onEmpezar, empezando, problema }) {
  return (
    <Card as="section" aria-labelledby="empezar-titulo" className={styles.empezar}>
      <h2 id="empezar-titulo" className={styles.h2}>Evaluación con tiempo</h2>
      <p>
        Tienes <b>{formatDuracion(ev.duration_minutes)}</b> desde que empieces para responder {ev.questions_count === 1 ? 'la pregunta' : `las ${ev.questions_count} preguntas`}
        {ev.closes_at ? `, y la evaluación cierra ${formatCierre(ev.closes_at)}: lo que llegue primero` : ''}.
      </p>
      <p>El reloj corre aunque cierres la página. Cuando se acabe el tiempo, se entregará solo lo que alcanzaste a responder. Tienes un solo intento.</p>
      {problema && <FormMessage>{problema}</FormMessage>}
      <div><Button onClick={onEmpezar} disabled={empezando}>{empezando ? 'Empezando…' : 'Empezar ahora'}</Button></div>
    </Card>
  );
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
  const { token, user, expire } = useSession();
  const { data, loading, error, reload } = useApiData((t, opts) => cargar(t, assessmentId, opts), assessmentId);
  const key = useIdempotencyKey();
  // Las respuestas se recuperan del borrador local (recarga, corte de luz) y se guardan en cada cambio.
  const [elegidas, setElegidasState] = useState(() => leerBorrador(assessmentId, user?.id));
  const setElegidas = (fn) => setElegidasState((x) => {
    const next = fn(x);
    guardarBorrador(assessmentId, user?.id, next);
    return next;
  });
  const [enviando, setEnviando] = useState(false);
  const [empezando, setEmpezando] = useState(false);
  const [problema, setProblema] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [automatica, setAutomatica] = useState(false);
  const autoEnviada = useRef(false);
  const ev = data?.ev;
  const mia = data?.mia;
  const conTiempo = Boolean(ev?.duration_minutes);
  const plazo = plazoDe(ev);
  const formularioPosible = ev?.status === 'published' && !mia?.submitted && !resultado && (!conTiempo || ev.attempt);
  // Con un plazo a la vista, el reloj avanza cada segundo; si no, cada 15 s. Siempre con la hora del SERVIDOR.
  const ahora = useNow(formularioPosible && plazo ? 1_000 : 15_000) + (data?.desfase ?? 0);
  const queda = plazo === null ? null : plazo - ahora;
  const vencida = queda !== null && queda <= 0;
  const respondidas = ev ? ev.questions.length - sinResponder(ev.questions, elegidas) : 0;

  async function empezar() {
    if (empezando) return;
    setEmpezando(true);
    setProblema(null);
    try {
      await startAttempt(token, assessmentId);
      reload(); // ahora sí llegan las preguntas y el plazo del intento
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      setProblema(err.message);
      if (err.status === 409) reload();
    } finally {
      setEmpezando(false);
    }
  }

  async function entregar(e, { auto = false } = {}) {
    e?.preventDefault();
    if (enviando) return;
    if (!auto) {
      const faltan = sinResponder(ev.questions, elegidas);
      const aviso = faltan > 0
        ? `Te falta responder ${faltan} pregunta${faltan === 1 ? '' : 's'}: contarán como incorrectas. Solo tienes un intento. ¿Entregar de todos modos?`
        : 'Solo tienes un intento. ¿Entregar tus respuestas?';
      if (!window.confirm(aviso)) return;
    }
    setEnviando(true);
    setProblema(null);
    try {
      setResultado(await submitAssessment(token, assessmentId, respuestasACuerpo(elegidas), key.get()));
      setAutomatica(auto);
      key.renew();
      borrarBorrador(assessmentId, user?.id);
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

  // Entrega automática unos segundos antes del plazo (el servidor da 30 s de margen): lo respondido no se pierde.
  const debeEntregarSola = formularioPosible && queda !== null && queda <= ENTREGA_ANTICIPADA_MS;
  useEffect(() => {
    if (!debeEntregarSola || autoEnviada.current) return;
    autoEnviada.current = true;
    entregar(null, { auto: true });
    // entregar cambia en cada render; la condición la decide debeEntregarSola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debeEntregarSola]);

  return (
    <>
      <p className={styles.crumbs}>
        <PortalLink to="est-cursos">Mis cursos</PortalLink> / {ev ? <PortalLink to="est-curso" param={ev.course_id}>Curso</PortalLink> : 'Curso'} / {ev?.title ?? 'Evaluación'}
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        {ev && (
          <>
            <PageHead title={ev.title} subtitle={`${conTiempo && !ev.attempt ? `${ev.questions_count} pregunta${ev.questions_count === 1 ? '' : 's'} · ${formatDuracion(ev.duration_minutes)}` : describirPreguntas(ev.questions)} · un solo intento${ev.closes_at ? ` · ${vencida && !ev.attempt ? 'cerró' : 'cierra'} ${formatCierre(ev.closes_at, ahora)}` : ''}`}>
              {plazo !== null && ev.status === 'published' && !mia?.submitted && !resultado && (
                formularioPosible && conTiempo
                  ? <span className={styles.estado} role="timer" aria-live="off" aria-label={`Tiempo restante ${relojRestante(queda)}`}><Chip tone={tonoReloj(queda)}>⏱ {relojRestante(queda)}</Chip></span>
                  : <span className={styles.estado}><Chip tone={tonoPlazo(plazo, ahora)}>{vencida ? 'Tiempo terminado' : tiempoRestante(plazo, ahora)}</Chip></span>
              )}
            </PageHead>

            {resultado && (
              <>
                <FormMessage tone={automatica ? 'info' : 'success'}>
                  {automatica ? 'Se acabó el tiempo: entregamos automáticamente lo que alcanzaste a responder. Este es tu resultado:' : 'Entregaste tu evaluación. Este es tu resultado:'}
                </FormMessage>
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

            {!resultado && !mia?.submitted && (ev.status === 'closed' || (ev.status === 'published' && vencida && !enviando)) && (
              <EmptyState title={vencida && ev.status === 'published' ? 'Se acabó el tiempo' : 'Esta evaluación ya está cerrada'}>
                {ev.attempt
                  ? 'Tu intento se cerró con lo que alcanzaste a entregar: tu nota aparecerá en el curso y en Mis notas.'
                  : ev.closes_at ? `Cerró ${formatCierre(ev.closes_at, ahora)} y ya no se puede rendir.` : 'Ya no se puede rendir.'} Si crees que es un error, habla con tu docente.
                {problema && <div style={{ marginTop: 12 }}><FormMessage>{problema}</FormMessage></div>}
              </EmptyState>
            )}

            {!resultado && !mia?.submitted && ev.status === 'published' && conTiempo && !ev.attempt && !vencida && (
              <Empezar ev={ev} onEmpezar={empezar} empezando={empezando} problema={problema} />
            )}

            {formularioPosible && (!vencida || enviando) && (
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
                {conTiempo && queda !== null && queda <= 60_000 && !enviando && (
                  <FormMessage tone="info">Queda menos de un minuto: si no entregas, se entregará solo lo que respondiste.</FormMessage>
                )}
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
