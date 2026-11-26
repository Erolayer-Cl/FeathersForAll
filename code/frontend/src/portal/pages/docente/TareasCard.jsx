import { useState } from 'react';
import { createTask, getTasks, uploadTaskAttachment } from '../../../api/portalApi.js';
import { ArchivoBoton } from '../../components/ArchivoBoton.jsx';
import { Button, Card, Chip, EmptyState, Field, FormMessage, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { useNow } from '../../hooks/useNow.js';
import { routeHref } from '../../router/parseRoute.js';
import { useSession } from '../../session/useSession.js';
import { aDatetimeLocal, desdeDatetimeLocal, estadoTarea, formatFechaHora, formatTamano, motivoRechazoArchivo } from '../../utils/tareas.js';
import styles from './Gestion.module.css';

const VACIO = { title: '', instructions: '', dueLocal: '' };

/** Formulario de nueva tarea: título, instrucciones, fecha y hora límite y un archivo opcional. */
function NuevaTarea({ courseId, onCreada, onCancelar }) {
  const { token, expire } = useSession();
  const key = useIdempotencyKey();
  const [form, setForm] = useState(VACIO);
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  const ahora = useNow();
  const minimo = aDatetimeLocal(ahora + 60_000);

  function elegir(file) {
    const motivo = motivoRechazoArchivo(file);
    setError(motivo);
    setArchivo(motivo ? null : file);
  }

  async function crear(e) {
    e.preventDefault();
    const due = desdeDatetimeLocal(form.dueLocal);
    if (form.title.trim().length < 3) return setError('El título debe tener al menos 3 caracteres.');
    if (!due || new Date(due).getTime() <= Date.now()) return setError('Elige una fecha y hora límite en el futuro.');
    setEnviando(true);
    setError(null);
    try {
      const tarea = await createTask(token, courseId, { title: form.title.trim(), instructions: form.instructions.trim() || null, due_at: due }, key.get());
      key.renew();
      if (archivo) {
        try {
          await uploadTaskAttachment(token, tarea.id, archivo);
        } catch (err) {
          // La tarea ya existe: se avisa y el archivo se puede adjuntar desde su página.
          setError(`La tarea se creó, pero el archivo no se pudo adjuntar: ${err.message} Ábrela para intentarlo de nuevo.`);
          onCreada(false);
          return;
        }
      }
      setForm(VACIO);
      setArchivo(null);
      onCreada(true);
    } catch (err) {
      if (err.status === 401) return expire();
      if (err.status !== 0) key.renew();
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className={`${styles.form} ${styles.nueva}`} onSubmit={crear}>
      <Field label="Título">
        <input value={form.title} onChange={set('title')} maxLength={150} required placeholder="Ej.: Guía de fracciones" />
      </Field>
      <Field label="Instrucciones (opcional)">
        <textarea value={form.instructions} onChange={set('instructions')} maxLength={4000} placeholder="Qué deben hacer y qué archivo subir." />
      </Field>
      <Field label="Fecha y hora límite" hint="Después de esta hora, tus estudiantes ya no pueden subir nada a esta tarea.">
        <input type="datetime-local" value={form.dueLocal} min={minimo} onChange={set('dueLocal')} required />
      </Field>
      <div className={styles.actions}>
        <ArchivoBoton onFile={elegir} variant="soft" label="Archivo de la tarea">{archivo ? 'Cambiar archivo' : 'Adjuntar archivo (opcional)'}</ArchivoBoton>
        {archivo && <span className={styles.sub}>{archivo.name} · {formatTamano(archivo.size)}</span>}
      </div>
      {error && <FormMessage>{error}</FormMessage>}
      <div className={styles.footer}>
        <Button type="submit" disabled={enviando}>{enviando ? 'Publicando…' : 'Publicar tarea'}</Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
      </div>
    </form>
  );
}

/** Docente · Tareas del curso: crear una con hora límite y ver cuántos entregaron (v1.8). */
export function TareasCard({ courseId }) {
  const { data, loading, error, reload } = useApiData((t, opts) => getTasks(t, courseId, opts), courseId);
  const ahora = useNow();
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const tareas = data?.data ?? [];

  return (
    <Card as="section" aria-labelledby="tareas-doc-titulo">
      <div className={styles.head}>
        <h2 id="tareas-doc-titulo" className={styles.h2}>Tareas</h2>
        {!creando && <Button size="sm" onClick={() => { setCreando(true); setAviso(null); }}>Nueva tarea</Button>}
      </div>
      <p className={styles.sub}>Tus estudiantes suben un archivo antes de la hora límite que elijas. Después, la tarea se cierra sola.</p>
      {aviso && <FormMessage tone="success">{aviso}</FormMessage>}
      {creando && (
        <NuevaTarea
          courseId={courseId}
          onCancelar={() => setCreando(false)}
          onCreada={(completa) => {
            reload();
            if (completa) {
              setCreando(false);
              setAviso('Tarea publicada: tus estudiantes ya la ven en su curso.');
            }
          }}
        />
      )}
      <LoadState loading={loading} error={error} onRetry={reload}>
        {tareas.length === 0 ? (
          !creando && <EmptyState title="Este curso aún no tiene tareas">Crea una con su fecha y hora límite.</EmptyState>
        ) : (
          <ul className={styles.rows}>
            {tareas.map((t) => {
              const estado = estadoTarea(t, ahora);
              return (
                <li key={t.id} className={styles.row}>
                  <div className={styles.grow}>
                    <b>{t.title}</b>
                    <small>Cierra {formatFechaHora(t.due_at)} · {t.submissions_count} de {t.students_count} entregaron</small>
                  </div>
                  <Chip tone={estado.tone}>{estado.label}</Chip>
                  <a className={styles.rowLink} href={routeHref('doc-tarea', t.id)} aria-label={`Abrir ${t.title}`}>Abrir</a>
                </li>
              );
            })}
          </ul>
        )}
      </LoadState>
    </Card>
  );
}
