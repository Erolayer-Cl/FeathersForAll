import { useState } from 'react';
import { generateAssessment } from '../../../api/portalApi.js';
import { Button, Card, Field, FormMessage } from '../../components/ui/index.js';
import { useSession } from '../../session/useSession.js';
import {
  MAX_ACEPTADAS, MAX_OPCIONES, MIN_OPCIONES, borradorACuerpo, borradorDesdeIa, borradorTieneTexto, preguntaVacia, quitarOpcion, revisarBorrador,
} from '../../utils/evaluaciones.js';
import styles from './EvaluacionNuevaPage.module.css';
import gestion from './Gestion.module.css';

const CANTIDADES = [3, 5, 8, 10];

/** Panel «Generar con IA»: pide un borrador a partir de un tema y de los apuntes del curso. No guarda nada. */
function PanelIa({ courseId, onGenerado, hayTexto }) {
  const { token, expire } = useSession();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({ topic: '', count: 5, useNotes: true });
  const [generando, setGenerando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function generar(e) {
    e.preventDefault();
    if (generando) return;
    if (hayTexto && !window.confirm('La IA reemplazará lo que ya escribiste en este formulario. ¿Continuar?')) return;
    setGenerando(true);
    setMensaje(null);
    try {
      const r = await generateAssessment(token, courseId, { topic: form.topic.trim(), questions_count: form.count, use_notes: form.useNotes });
      onGenerado(borradorDesdeIa(r));
      const origen = r.source === 'apuntes' ? ` Basadas en: ${r.sources.join(', ')}.` : ' Basadas solo en el tema (no en tus apuntes).';
      const menos = r.questions.length < r.requested_questions ? ` Pediste ${r.requested_questions}, pero solo ${r.questions.length} salieron bien.` : '';
      setMensaje({ tone: 'success', text: `La IA propuso ${r.questions.length} pregunta${r.questions.length === 1 ? '' : 's'}.${origen}${menos} Revisa la alternativa correcta y la retroalimentación de cada una: la IA puede equivocarse.` });
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      setMensaje({ tone: 'error', text: err.message });
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="ia-titulo">
      <div className={gestion.head}>
        <div>
          <h2 id="ia-titulo" className={gestion.h2}>Generar con IA</h2>
          <p className={gestion.sub}>Pide un borrador a partir de un tema y de tus apuntes; después lo editas como quieras.</p>
        </div>
        <Button size="sm" variant="soft" aria-expanded={abierto} aria-controls="ia-panel" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Ocultar' : 'Generar con IA'}
        </Button>
      </div>
      <div id="ia-panel" hidden={!abierto}>
        <form className={gestion.form} style={{ marginTop: 14 }} onSubmit={generar} aria-busy={generando}>
          <Field label="Tema de la evaluación" hint="Por ejemplo: suma de fracciones con igual denominador.">
            <input name="ia-tema" required minLength={3} maxLength={200} value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} />
          </Field>
          <div className={gestion.grid2}>
            <Field label="Número de preguntas">
              <select name="ia-cantidad" value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: Number(e.target.value) }))}>
                {CANTIDADES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <label className={styles.usarApuntes}>
              <input type="checkbox" checked={form.useNotes} onChange={(e) => setForm((f) => ({ ...f, useNotes: e.target.checked }))} />
              <span>Basar las preguntas en los apuntes del curso</span>
            </label>
          </div>
          <div className={gestion.footer}>
            <Button type="submit" variant="accent" disabled={generando}>{generando ? 'Generando…' : 'Generar borrador'}</Button>
            {generando && <span className={gestion.sub} role="status">Puede tardar hasta un minuto. No cierres esta página.</span>}
          </div>
          {mensaje && <FormMessage tone={mensaje.tone}>{mensaje.text}</FormMessage>}
        </form>
      </div>
    </Card>
  );
}

/**
 * Editor de una evaluación en borrador, para crearla desde cero o editarla: título, cierre y preguntas de alternativas
 * (con la correcta marcada) o de respuesta escrita (con las respuestas aceptadas, v1.10). Con `courseId` ofrece generar el borrador con IA (el docente siempre puede editarlo).
 * @param {{initial: object, courseId?: string, enviando: boolean, error: string | null, etiqueta: string, cancelarHref: string,
 *   onGuardar: (cuerpo: object) => void}} props
 */
export function EditorEvaluacion({ initial, courseId, enviando, error, etiqueta, cancelarHref, onGuardar }) {
  const [draft, setDraft] = useState(initial);
  const [intentado, setIntentado] = useState(false);
  const { errores, avisos } = revisarBorrador(draft);

  const cambiarPregunta = (i, cambios) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...cambios } : q)) }));
  const cambiarOpcion = (i, k, texto) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, options: q.options.map((o, m) => (m === k ? texto : o)) } : q)) }));
  const cambiarAceptada = (i, k, texto) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, accepted: q.accepted.map((a, m) => (m === k ? texto : a)) } : q)) }));

  function guardar(e) {
    e.preventDefault();
    if (enviando) return;
    setIntentado(true);
    if (errores.length === 0) onGuardar(borradorACuerpo(draft));
  }

  return (
    <>
      {courseId && <PanelIa courseId={courseId} hayTexto={borradorTieneTexto(draft)} onGenerado={(d) => { setDraft(d); setIntentado(false); }} />}
      <form className={gestion.form} onSubmit={guardar} aria-busy={enviando} noValidate>
        <Card as="section">
          <div className={gestion.grid2}>
            <Field label="Título de la evaluación">
              <input name="title" maxLength={150} placeholder="Prueba de fracciones" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </Field>
            <Field label="Día y hora de cierre (opcional)" hint="Puedes dejarlo vacío y elegirlo al publicar, también como duración (por ejemplo, 90 minutos).">
              <input type="datetime-local" name="closes_at" value={draft.closesAt} onChange={(e) => setDraft((d) => ({ ...d, closesAt: e.target.value }))} />
            </Field>
            <Field label="Tiempo por estudiante, en minutos (opcional)" hint="Cada estudiante tiene este tiempo desde que empieza, sin pasar del cierre. Al acabarse se entrega solo lo que respondió.">
              <input type="number" inputMode="numeric" min={1} max={600} step={1} name="duration_minutes" placeholder="Sin límite" value={draft.durationMin ?? ''} onChange={(e) => setDraft((d) => ({ ...d, durationMin: e.target.value }))} />
            </Field>
          </div>
        </Card>

        {draft.questions.map((q, i) => (
          <Card as="fieldset" key={q.key} className={styles.pregunta}>
            <legend className={styles.legend}>Pregunta {i + 1}</legend>
            <div className={styles.tipos} role="radiogroup" aria-label={`Tipo de la pregunta ${i + 1}`}>
              {[['multiple_choice', 'Alternativas'], ['text', 'Respuesta escrita']].map(([valor, nombre]) => (
                <label key={valor} className={`${styles.tipo} ${q.type === valor ? styles.tipoActivo : ''}`}>
                  <input type="radio" name={`tipo-${q.key}`} checked={q.type === valor} onChange={() => cambiarPregunta(i, { type: valor })} />
                  {nombre}
                </label>
              ))}
            </div>

            <Field label="Enunciado">
              <textarea name={`enunciado-${i}`} maxLength={1000} value={q.statement} onChange={(e) => cambiarPregunta(i, { statement: e.target.value })} />
            </Field>

            {q.type === 'text' ? (
              <div className={styles.opciones}>
                <p className={styles.ayuda}>
                  <b>Con respuestas aceptadas</b>, se corrige sola si coincide con alguna (no importan mayúsculas, tildes ni el
                  punto final, y en números da igual «7», «7,0» o «7.0»). <b>Si las dejas vacías</b>, tú revisas cada respuesta
                  en la página de la evaluación. En los dos casos puedes cambiar la corrección después.
                </p>
                {q.accepted.map((texto, k) => (
                  <div key={k} className={styles.opcion}>
                    <Field label={`Respuesta aceptada ${k + 1}`} className={styles.opcionCampo}>
                      <input maxLength={300} value={texto} placeholder={k === 0 ? 'Ej.: 7 (vacío = la reviso yo)' : 'Otra forma válida'} onChange={(e) => cambiarAceptada(i, k, e.target.value)} />
                    </Field>
                    {q.accepted.length > 1 && (
                      <Button size="sm" variant="ghost" aria-label={`Quitar la respuesta aceptada ${k + 1}`} onClick={() => cambiarPregunta(i, { accepted: q.accepted.filter((_, m) => m !== k) })}>Quitar</Button>
                    )}
                  </div>
                ))}
                {q.accepted.length < MAX_ACEPTADAS && (
                  <div><Button size="sm" variant="soft" onClick={() => cambiarPregunta(i, { accepted: [...q.accepted, ''] })}>Agregar otra respuesta aceptada</Button></div>
                )}
              </div>
            ) : (<>
            <div role="radiogroup" aria-label={`Alternativas de la pregunta ${i + 1}`} className={styles.opciones}>
              {q.options.map((texto, k) => (
                <div key={k} className={styles.opcion}>
                  <input type="radio" name={`correcta-${q.key}`} checked={q.correct === k} onChange={() => cambiarPregunta(i, { correct: k })} aria-label={`Marcar la alternativa ${k + 1} como correcta`} />
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
            </>)}

            <Field label="Retroalimentación (opcional)" hint="El estudiante la ve apenas entrega la evaluación.">
              <textarea name={`retro-${i}`} maxLength={1000} value={q.feedback} onChange={(e) => cambiarPregunta(i, { feedback: e.target.value })} />
            </Field>

            {draft.questions.length > 1 && (
              <div><Button size="sm" variant="warn" onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))}>Quitar la pregunta {i + 1}</Button></div>
            )}
          </Card>
        ))}

        <div className={gestion.actions}>
          <Button variant="soft" onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, preguntaVacia()] }))}>Agregar pregunta de alternativas</Button>
          <Button variant="soft" onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, preguntaVacia('text')] }))}>Agregar pregunta de respuesta escrita</Button>
        </div>

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
          <Button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : etiqueta}</Button>
          <Button variant="ghost" href={cancelarHref}>Cancelar</Button>
        </div>
      </form>
    </>
  );
}
