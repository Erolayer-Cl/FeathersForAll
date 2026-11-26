import { useState } from 'react';
import { downloadCourseMaterial, downloadMySubmission, downloadTaskAttachment, getCourseMaterials, getTasks, uploadSubmission } from '../../../api/portalApi.js';
import { ArchivoBoton } from '../../components/ArchivoBoton.jsx';
import { Button, Card, Chip, EmptyState, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useNow } from '../../hooks/useNow.js';
import { useSession } from '../../session/useSession.js';
import { formatFecha } from '../../utils/notas.js';
import { estadoTarea, formatFechaHora, formatTamano, guardarArchivo, motivoRechazoArchivo, tareaAbierta } from '../../utils/tareas.js';
import styles from './ContenidoCurso.module.css';

const TIPO_CORTO = { 'application/pdf': 'PDF', 'text/markdown': 'Texto', 'text/plain': 'Texto' };

/** Descarga con manejo de sesión vencida y errores; `bajando` marca qué botón está ocupado. */
function useDescarga() {
  const { token, expire } = useSession();
  const [bajando, setBajando] = useState(null);
  const [error, setError] = useState(null);
  async function descargar(id, pedir) {
    setBajando(id);
    setError(null);
    try {
      guardarArchivo(await pedir(token));
    } catch (err) {
      if (err?.status === 401) expire();
      else setError(err.message);
    } finally {
      setBajando(null);
    }
  }
  return { bajando, error, descargar };
}

/** Estudiante · Material del curso: lo que sube el docente, para verlo y descargarlo (v1.8). */
export function MaterialCard({ courseId }) {
  const { data, loading, error, reload } = useApiData((t, opts) => getCourseMaterials(t, courseId, opts), courseId);
  const { bajando, error: errorDescarga, descargar } = useDescarga();
  const materiales = data?.data ?? [];
  return (
    <Card as="section" aria-labelledby="material-titulo">
      <h2 id="material-titulo">Material del curso</h2>
      <p className={styles.sub}>Lo que sube tu docente aparece aquí apenas lo publica.</p>
      {errorDescarga && <p role="alert" className={styles.alerta}>{errorDescarga}</p>}
      <LoadState loading={loading} error={error} onRetry={reload}>
        {materiales.length === 0 ? (
          <EmptyState>Tu docente aún no sube material a este curso.</EmptyState>
        ) : (
          <ul className={styles.lista}>
            {materiales.map((m) => (
              <li key={m.name} className={styles.item}>
                <span className={styles.grow}>
                  <b>{m.name}</b>
                  <small>
                    {m.original ? (TIPO_CORTO[m.content_type] ?? 'Archivo') : 'Texto del apunte'} · {formatTamano(m.size_bytes)} · {formatFecha(m.uploaded_at)}
                  </small>
                </span>
                <Button size="sm" variant="soft" disabled={bajando === m.name} onClick={() => descargar(m.name, (t) => downloadCourseMaterial(t, courseId, m.name))} aria-label={`Descargar ${m.name}`}>
                  {bajando === m.name ? 'Descargando…' : 'Descargar'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LoadState>
    </Card>
  );
}

/** Una tarea del estudiante: enunciado, plazo y su entrega (subir o reemplazar mientras esté abierta). */
function TareaEstudiante({ tarea, ahora, onCambio }) {
  const { token, expire } = useSession();
  const { bajando, error: errorDescarga, descargar } = useDescarga();
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const abierta = tareaAbierta(tarea, ahora);
  const estado = estadoTarea(tarea, ahora);
  const entrega = tarea.my_submission;

  async function entregar(file) {
    const motivo = motivoRechazoArchivo(file);
    setOk(null);
    if (motivo) {
      setError(motivo);
      return;
    }
    if (entrega && !window.confirm(`¿Reemplazar «${entrega.file_name}» por «${file.name}»?`)) return;
    setSubiendo(true);
    setError(null);
    try {
      const r = await uploadSubmission(token, tarea.id, file);
      setOk(`Entregaste «${r.file_name}» el ${formatFechaHora(r.submitted_at)}.`);
      onCambio();
    } catch (err) {
      if (err?.status === 401) expire();
      else {
        setError(err.message);
        if (err?.status === 409) onCambio(); // se cerró: refresca para mostrarla cerrada
      }
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <li className={`${styles.tarea} ${abierta ? '' : styles.cerrada}`}>
      <div className={styles.tareaHead}>
        <span className={styles.grow}>
          <b>{tarea.title}</b>
          <small>Entrega hasta el {formatFechaHora(tarea.due_at)} (hora de Chile)</small>
        </span>
        <Chip tone={estado.tone}>{estado.label}</Chip>
      </div>
      {tarea.instructions && <p className={styles.instrucciones}>{tarea.instructions}</p>}
      {tarea.attachment && (
        <Button size="sm" variant="ghost" disabled={bajando === 'enunciado'} onClick={() => descargar('enunciado', (t) => downloadTaskAttachment(t, tarea.id, tarea.attachment.name))}>
          {bajando === 'enunciado' ? 'Descargando…' : `Descargar ${tarea.attachment.name} (${formatTamano(tarea.attachment.size_bytes)})`}
        </Button>
      )}

      <div className={styles.entrega}>
        {entrega ? (
          <span className={styles.grow}>
            <b>Entregaste «{entrega.file_name}»</b>
            <small>{formatFechaHora(entrega.submitted_at)} · {formatTamano(entrega.size_bytes)}</small>
          </span>
        ) : (
          <span className={styles.grow}>
            <b>{abierta ? 'Aún no entregas' : 'No entregaste esta tarea'}</b>
            <small>{abierta ? 'Sube un archivo (PDF, Word, foto…, hasta 10 MB). Puedes reemplazarlo hasta la hora límite.' : 'El plazo terminó: ya no se pueden subir archivos.'}</small>
          </span>
        )}
        {entrega && (
          <Button size="sm" variant="soft" disabled={bajando === 'mia'} onClick={() => descargar('mia', (t) => downloadMySubmission(t, tarea.id, entrega.file_name))}>
            {bajando === 'mia' ? 'Descargando…' : 'Ver mi entrega'}
          </Button>
        )}
        {abierta && (
          <ArchivoBoton onFile={entregar} disabled={subiendo} variant={entrega ? 'soft' : 'primary'} label={`Archivo para ${tarea.title}`}>
            {subiendo ? 'Subiendo…' : entrega ? 'Reemplazar' : 'Subir mi entrega'}
          </ArchivoBoton>
        )}
      </div>
      {error && <p role="alert" className={styles.alerta}>{error}</p>}
      {errorDescarga && <p role="alert" className={styles.alerta}>{errorDescarga}</p>}
      {ok && <p role="status" className={styles.ok}>{ok}</p>}
    </li>
  );
}

/** Estudiante · Tareas del curso con su hora límite (v1.8). */
export function TareasCard({ courseId }) {
  const { data, loading, error, reload } = useApiData((t, opts) => getTasks(t, courseId, opts), courseId);
  const ahora = useNow();
  const tareas = data?.data ?? [];
  const abiertas = tareas.filter((t) => tareaAbierta(t, ahora));
  const cerradas = tareas.filter((t) => !tareaAbierta(t, ahora)).reverse();
  return (
    <Card as="section" aria-labelledby="tareas-titulo">
      <h2 id="tareas-titulo">Tareas</h2>
      <p className={styles.sub}>Sube tu archivo antes de la hora límite. Después, la tarea se cierra y no acepta entregas.</p>
      <LoadState loading={loading} error={error} onRetry={reload}>
        {tareas.length === 0 ? (
          <EmptyState>No hay tareas en este curso.</EmptyState>
        ) : (
          <ul className={styles.lista}>
            {[...abiertas, ...cerradas].map((t) => <TareaEstudiante key={t.id} tarea={t} ahora={ahora} onCambio={reload} />)}
          </ul>
        )}
      </LoadState>
    </Card>
  );
}
