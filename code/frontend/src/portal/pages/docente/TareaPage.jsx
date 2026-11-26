import { useState } from 'react';
import {
  deleteTask, deleteTaskAttachment, downloadStudentSubmission, downloadTaskAttachment, getCourse, getTask, updateTask, uploadTaskAttachment,
} from '../../../api/portalApi.js';
import { ArchivoBoton } from '../../components/ArchivoBoton.jsx';
import { Button, Card, Chip, EmptyState, Field, FormMessage, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useNow } from '../../hooks/useNow.js';
import { routeHref } from '../../router/parseRoute.js';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { aDatetimeLocal, desdeDatetimeLocal, estadoTarea, formatFechaHora, formatTamano, guardarArchivo, motivoRechazoArchivo, tareaAbierta } from '../../utils/tareas.js';
import styles from './Gestion.module.css';

const NO_DISPONIBLE = {
  title: 'Tarea no disponible',
  action: <Button size="sm" variant="soft" href={routeHref('doc-cursos')}>Volver a Cursos</Button>,
};

/** Docente · Una tarea (doc-tarea/<id>): plazo, archivo del enunciado y quién entregó, con sus archivos (v1.8). */
export function DocenteTareaPage({ param: taskId }) {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const ahora = useNow();
  const { data: tarea, loading, error, reload } = useApiData((t, opts) => getTask(t, taskId, opts), taskId);
  // Nombre del curso para la ruta de migas (se pide cuando ya se sabe de qué curso es la tarea).
  const cursoId = tarea?.course_id ?? '';
  const curso = useApiData((t, opts) => (cursoId ? getCourse(t, cursoId, opts) : Promise.resolve(null)), cursoId);
  const [ocupado, setOcupado] = useState(null); // qué acción está en curso
  const [mensaje, setMensaje] = useState(null); // { tone, text }
  const [nuevaHora, setNuevaHora] = useState('');

  /** Ejecuta una acción con su estado de carga, sesión vencida y mensaje de error/éxito. */
  async function accion(id, fn, exito) {
    setOcupado(id);
    setMensaje(null);
    try {
      await fn();
      if (exito) setMensaje({ tone: 'success', text: exito });
      return true;
    } catch (err) {
      if (err?.status === 401) expire();
      else setMensaje({ tone: 'error', text: err.message });
      return false;
    } finally {
      setOcupado(null);
    }
  }

  const cambiarHora = (iso, texto) => accion('hora', async () => {
    await updateTask(token, taskId, { due_at: iso });
    setNuevaHora('');
    reload();
  }, texto);

  function guardarHora(e) {
    e.preventDefault();
    const iso = desdeDatetimeLocal(nuevaHora);
    if (!iso) return setMensaje({ tone: 'error', text: 'Elige una fecha y hora válidas.' });
    cambiarHora(iso, new Date(iso).getTime() > Date.now() ? `Nueva hora límite: ${formatFechaHora(iso)}.` : 'La tarea quedó cerrada.');
  }

  function adjuntar(file) {
    const motivo = motivoRechazoArchivo(file);
    if (motivo) return setMensaje({ tone: 'error', text: motivo });
    accion('adjunto', async () => {
      await uploadTaskAttachment(token, taskId, file);
      reload();
    }, `Archivo «${file.name}» adjuntado.`);
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar la tarea «${tarea.title}»? También se borran las ${tarea.submissions_count} entregas. No se puede deshacer.`)) return;
    if (await accion('borrar', () => deleteTask(token, taskId))) navigate('doc-curso', tarea.course_id);
  }

  const entregaron = tarea?.students?.filter((s) => s.submission) ?? [];
  const abierta = tarea ? tareaAbierta(tarea, ahora) : false;
  const estado = tarea ? estadoTarea(tarea, ahora) : null;

  return (
    <>
      <p className={styles.crumbs}>
        <a href={routeHref('doc-cursos')}>Cursos</a>
        {tarea && <> / <a href={routeHref('doc-curso', tarea.course_id)}>{curso.data?.subject ?? curso.data?.name ?? 'Curso'}</a></>} / Tarea
      </p>

      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        {tarea && (
          <>
            <PageHead title={tarea.title} subtitle={`Entrega hasta el ${formatFechaHora(tarea.due_at)} (hora de Chile) · ${tarea.submissions_count} de ${tarea.students_count} entregaron`}>
              <span className={styles.estado}><Chip tone={estado.tone}>{estado.label}</Chip></span>
            </PageHead>
            {mensaje && <FormMessage tone={mensaje.tone}>{mensaje.text}</FormMessage>}

            <div className={styles.split}>
              <Card as="section" aria-labelledby="plazo-titulo">
                <h2 id="plazo-titulo" className={styles.h2}>Plazo</h2>
                <p className={styles.sub}>
                  {abierta ? 'Abierta: tus estudiantes pueden subir o reemplazar su archivo hasta la hora límite.' : 'Cerrada: ya nadie puede subir archivos. Si cambias la hora a una futura, se vuelve a abrir.'}
                </p>
                <form className={styles.formRow} onSubmit={guardarHora}>
                  <Field label="Nueva fecha y hora límite">
                    <input type="datetime-local" value={nuevaHora || aDatetimeLocal(tarea.due_at)} onChange={(e) => setNuevaHora(e.target.value)} />
                  </Field>
                  <Button type="submit" size="sm" disabled={ocupado === 'hora' || !nuevaHora}>Guardar</Button>
                  {abierta && (
                    <Button type="button" size="sm" variant="warn" disabled={ocupado === 'hora'}
                      onClick={() => window.confirm('¿Cerrar la tarea ahora? Nadie más podrá entregar.') && cambiarHora(new Date().toISOString(), 'La tarea quedó cerrada.')}>
                      Cerrar ahora
                    </Button>
                  )}
                </form>
                {tarea.instructions && <p className={styles.sub} style={{ whiteSpace: 'pre-wrap' }}>{tarea.instructions}</p>}
              </Card>

              <Card as="section" aria-labelledby="adjunto-titulo">
                <h2 id="adjunto-titulo" className={styles.h2}>Archivo de la tarea</h2>
                <p className={styles.sub}>Guía o enunciado que descargan tus estudiantes (hasta 10 MB).</p>
                <div className={`${styles.actions} ${styles.formRow}`}>
                  {tarea.attachment ? (
                    <>
                      <Button size="sm" variant="soft" disabled={ocupado === 'bajar-adjunto'}
                        onClick={() => accion('bajar-adjunto', async () => guardarArchivo(await downloadTaskAttachment(token, taskId, tarea.attachment.name)))}>
                        {tarea.attachment.name} · {formatTamano(tarea.attachment.size_bytes)}
                      </Button>
                      <ArchivoBoton onFile={adjuntar} variant="ghost" disabled={ocupado === 'adjunto'} label="Reemplazar archivo de la tarea">Reemplazar</ArchivoBoton>
                      <Button size="sm" variant="warn" disabled={ocupado === 'quitar'}
                        onClick={() => accion('quitar', async () => { await deleteTaskAttachment(token, taskId); reload(); }, 'Archivo quitado.')}>
                        Quitar
                      </Button>
                    </>
                  ) : (
                    <ArchivoBoton onFile={adjuntar} disabled={ocupado === 'adjunto'} label="Archivo de la tarea">{ocupado === 'adjunto' ? 'Subiendo…' : 'Adjuntar archivo'}</ArchivoBoton>
                  )}
                </div>
              </Card>
            </div>

            <Card as="section" aria-labelledby="entregas-titulo">
              <div className={styles.head}>
                <h2 id="entregas-titulo" className={styles.h2}>Entregas · {entregaron.length} de {tarea.students?.length ?? 0}</h2>
              </div>
              {tarea.students?.length === 0 ? (
                <EmptyState>Este curso no tiene estudiantes matriculados.</EmptyState>
              ) : (
                <ul className={styles.rows}>
                  {tarea.students.map((s) => (
                    <li key={s.student_id} className={`${styles.row} ${styles.rowAncha}`}>
                      <div className={styles.grow}>
                        <b>{s.name}</b>
                        <small>{s.submission ? `${s.submission.file_name} · ${formatTamano(s.submission.size_bytes)} · ${formatFechaHora(s.submission.submitted_at)}` : abierta ? 'Aún no entrega' : 'No entregó'}</small>
                      </div>
                      <Chip tone={s.submission ? 'success' : abierta ? 'neutral' : 'danger'}>{s.submission ? 'Entregó' : 'Sin entrega'}</Chip>
                      {s.submission && (
                        <Button size="sm" variant="soft" disabled={ocupado === s.student_id} aria-label={`Descargar la entrega de ${s.name}`}
                          onClick={() => accion(s.student_id, async () => guardarArchivo(await downloadStudentSubmission(token, taskId, s.student_id, s.submission.file_name)))}>
                          Descargar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className={styles.footer}>
              <Button variant="warn" size="sm" disabled={ocupado === 'borrar'} onClick={borrar}>Borrar tarea</Button>
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}
