import { useState } from 'react';
import { getTextAnswers, reviewTextAnswer } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, FormMessage, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useSession } from '../../session/useSession.js';
import { formatNota } from '../../utils/notas.js';
import gestion from './Gestion.module.css';
import styles from './RevisionRespuestas.module.css';

/** Estado de una respuesta escrita para el docente. */
function estado(r) {
  if (r.pending_review) return { label: 'Por revisar', tone: 'warning' };
  const como = r.reviewed_at ? 'tú' : 'automática';
  return r.correct ? { label: `Correcta (${como})`, tone: 'success' } : { label: `Incorrecta (${como})`, tone: 'danger' };
}

/**
 * Docente · Revisar respuestas escritas (v1.11). Las preguntas de texto sin respuestas aceptadas las corrige el
 * docente; las que se corrigieron solas también se pueden cambiar. Cada decisión recalcula la nota del estudiante.
 */
export function RevisionRespuestas({ assessmentId, onRevisada }) {
  const { token, expire } = useSession();
  const { data, loading, error, reload } = useApiData((t, opts) => getTextAnswers(t, assessmentId, opts), assessmentId);
  const [filtro, setFiltro] = useState('pendientes');
  const [ocupada, setOcupada] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [cambios, setCambios] = useState({}); // id -> respuesta ya revisada en esta sesión (sin esperar a recargar)

  const todas = (data?.data ?? []).map((r) => cambios[r.id] ?? r);
  const pendientes = todas.filter((r) => r.pending_review).length;
  const visibles = filtro === 'pendientes' ? todas.filter((r) => r.pending_review || cambios[r.id]) : todas;

  async function decidir(r, correct) {
    setOcupada(r.id);
    setMensaje(null);
    try {
      const res = await reviewTextAnswer(token, assessmentId, r.id, correct);
      setCambios((c) => ({ ...c, [r.id]: { ...r, correct: res.correct, pending_review: false, reviewed_at: res.reviewed_at } }));
      setMensaje(`${r.student_name}: nota actualizada a ${formatNota(res.student_grade)}.`);
      onRevisada?.();
    } catch (err) {
      if (err.status === 401) expire();
      else setMensaje(err.message);
    } finally {
      setOcupada(null);
    }
  }

  if (!loading && !error && todas.length === 0) return null; // sin respuestas escritas entregadas: nada que revisar

  return (
    <Card as="section" aria-labelledby="revision-titulo">
      <div className={gestion.head}>
        <h2 id="revision-titulo" className={gestion.h2}>
          Respuestas escritas {pendientes > 0 && <span className={styles.contador}>{pendientes} por revisar</span>}
        </h2>
        <div className={styles.filtros} role="group" aria-label="Qué respuestas mostrar">
          <Button size="sm" variant={filtro === 'pendientes' ? 'primary' : 'soft'} aria-pressed={filtro === 'pendientes'} onClick={() => setFiltro('pendientes')}>Por revisar</Button>
          <Button size="sm" variant={filtro === 'todas' ? 'primary' : 'soft'} aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>Todas</Button>
          <Button size="sm" variant="ghost" onClick={() => { setCambios({}); reload(); }}>Actualizar</Button>
        </div>
      </div>
      <p className={gestion.sub}>Decide si cada respuesta es correcta. La nota del estudiante se actualiza al instante y puedes cambiar de opinión.</p>
      {mensaje && <FormMessage tone="success">{mensaje}</FormMessage>}
      <LoadState loading={loading} error={error} onRetry={reload}>
        {visibles.length === 0 ? (
          <EmptyState title="Todo revisado">No quedan respuestas escritas por revisar. Mira «Todas» para cambiar alguna.</EmptyState>
        ) : (
          <ul className={styles.lista}>
            {visibles.map((r) => {
              const e = estado(r);
              return (
                <li key={r.id} className={`${styles.item} ${r.pending_review ? styles.pendiente : ''}`}>
                  <div className={styles.cabeza}>
                    <span className={styles.quien}>
                      <b>{r.student_name}</b>
                      <small>Pregunta {r.question_order}: {r.question}</small>
                    </span>
                    <Chip tone={e.tone}>{e.label}</Chip>
                  </div>
                  <blockquote className={styles.respuesta}>{r.text_answer}</blockquote>
                  {r.accepted_answers?.length > 0 && <small className={styles.aceptadas}>Respuestas aceptadas: {r.accepted_answers.join(' · ')}</small>}
                  <div className={styles.acciones}>
                    <Button size="sm" variant={!r.pending_review && r.correct ? 'primary' : 'soft'} disabled={ocupada === r.id}
                      aria-pressed={!r.pending_review && r.correct} onClick={() => decidir(r, true)}>
                      Correcta
                    </Button>
                    <Button size="sm" variant={!r.pending_review && !r.correct ? 'warn' : 'soft'} disabled={ocupada === r.id}
                      aria-pressed={!r.pending_review && !r.correct} onClick={() => decidir(r, false)}>
                      Incorrecta
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </Card>
  );
}
