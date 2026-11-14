import { useState } from 'react';
import { createAssessment, getCourse } from '../../../api/portalApi.js';
import { Button, Card, Field, FormMessage, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { MAX_OPCIONES, MIN_OPCIONES, borradorACuerpo, borradorVacio, preguntaVacia, quitarOpcion, revisarBorrador } from '../../utils/evaluaciones.js';
import styles from './EvaluacionNuevaPage.module.css';
import gestion from './Gestion.module.css';

/**
 * Docente · Nueva evaluación (H2, doc-evaluacion-nueva/<curso>): título, preguntas de alternativas con la correcta
 * marcada y la retroalimentación que verá el estudiante. Se guarda en borrador; se publica en la pantalla siguiente.
 */
export function DocenteEvaluacionNuevaPage({ param: courseId }) {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const curso = useApiData((t, opts) => getCourse(t, courseId, opts), courseId);
  const key = useIdempotencyKey();
  const [draft, setDraft] = useState(borradorVacio);
  const [error, setError] = useState(null);
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const { errores, avisos } = revisarBorrador(draft);

  const cambiarPregunta = (i, cambios) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...cambios } : q)) }));
  const cambiarOpcion = (i, k, texto) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, options: q.options.map((o, m) => (m === k ? texto : o)) } : q)) }));

  async function guardar(e) {
    e.preventDefault();
    if (enviando) return;
    setIntentado(true);
    if (errores.length > 0) return;
    setEnviando(true);
    setError(null);
    try {
      const ev = await createAssessment(token, courseId, borradorACuerpo(draft), key.get());
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
      <PageHead title="Nueva evaluación" subtitle="Preguntas de alternativas que se corrigen solas. Marca la correcta y escribe lo que el estudiante verá al responder." />

      <LoadState loading={curso.loading} error={curso.error} onRetry={curso.reload}>
        <form className={gestion.form} onSubmit={guardar} aria-busy={enviando} noValidate>
          <Card as="section">
            <Field label="Título de la evaluación">
              <input name="title" maxLength={150} placeholder="Prueba de fracciones" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </Field>
          </Card>

          {draft.questions.map((q, i) => (
            <Card as="fieldset" key={q.key} className={styles.pregunta}>
              <legend className={styles.legend}>Pregunta {i + 1}</legend>
              <Field label="Enunciado">
                <textarea name={`enunciado-${i}`} maxLength={1000} value={q.statement} onChange={(e) => cambiarPregunta(i, { statement: e.target.value })} />
              </Field>

              <div role="radiogroup" aria-label={`Alternativas de la pregunta ${i + 1}`} className={styles.opciones}>
                {q.options.map((texto, k) => (
                  <div key={k} className={styles.opcion}>
                    <input
                      type="radio"
                      name={`correcta-${q.key}`}
                      checked={q.correct === k}
                      onChange={() => cambiarPregunta(i, { correct: k })}
                      aria-label={`Marcar la alternativa ${k + 1} como correcta`}
                    />
                    <Field label={`Alternativa ${k + 1}${q.correct === k ? ' (correcta)' : ''}`} className={styles.opcionCampo}>
                      <input maxLength={300} value={texto} onChange={(e) => cambiarOpcion(i, k, e.target.value)} />
                    </Field>
                    {q.options.length > MIN_OPCIONES && (
                      <Button size="sm" variant="ghost" aria-label={`Quitar la alternativa ${k + 1}`} onClick={() => cambiarPregunta(i, quitarOpcion(q, k))}>Quitar</Button>
                    )}
                  </div>
                ))}
              </div>
              {q.options.length < MAX_OPCIONES && (
                <div><Button size="sm" variant="soft" onClick={() => cambiarPregunta(i, { options: [...q.options, ''] })}>Agregar alternativa</Button></div>
              )}

              <Field label="Retroalimentación (opcional)" hint="El estudiante la ve apenas entrega la evaluación.">
                <textarea name={`retro-${i}`} maxLength={1000} value={q.feedback} onChange={(e) => cambiarPregunta(i, { feedback: e.target.value })} />
              </Field>

              {draft.questions.length > 1 && (
                <div><Button size="sm" variant="warn" onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))}>Quitar la pregunta {i + 1}</Button></div>
              )}
            </Card>
          ))}

          <div><Button variant="soft" onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, preguntaVacia()] }))}>Agregar pregunta</Button></div>

          {intentado && errores.length > 0 && (
            <FormMessage>
              Revisa antes de guardar:
              <ul className={gestion.list}>{errores.map((m) => <li key={m}>{m}</li>)}</ul>
            </FormMessage>
          )}
          {avisos.length > 0 && (
            <FormMessage tone="info">
              Puedes guardar como borrador, pero no publicar todavía:
              <ul className={gestion.list}>{avisos.map((m) => <li key={m}>{m}</li>)}</ul>
            </FormMessage>
          )}
          {error && <FormMessage>{error}</FormMessage>}

          <div className={gestion.footer}>
            <Button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar borrador'}</Button>
            <Button variant="ghost" href={`#/portal/doc-curso/${encodeURIComponent(courseId)}`}>Cancelar</Button>
          </div>
        </form>
      </LoadState>
    </>
  );
}
