import { useState } from 'react';
import { getCourse, getGradebook, getGradesSummary, updateGrading } from '../../../api/portalApi.js';
import { Button, Card, EmptyState, Field, FormMessage, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { routeHref } from '../../router/parseRoute.js';
import { useSession } from '../../session/useSession.js';
import { normalizarEstado } from '../../utils/evaluaciones.js';
import { libroACsv, nombreCsv, paramEstudiante, tablaLibro, validarCalificacion } from '../../utils/libroNotas.js';
import { guardarArchivo } from '../../utils/tareas.js';
import { formatFecha, formatNota, formatNumero, tonoNota } from '../../utils/notas.js';
import gestion from './Gestion.module.css';
import styles from './Notas.module.css';

const NO_DISPONIBLE = { title: 'Curso no disponible', action: <Button size="sm" variant="soft" href={routeHref('doc-cursos')}>Volver a Mis cursos</Button> };

/** Exigencia y ponderación de una evaluación. Al guardar, el servidor recalcula las notas y se recarga el libro. */
function FilaCalificacion({ evaluacion, onGuardado }) {
  const { token, expire } = useSession();
  const [exigencia, setExigencia] = useState(String(evaluacion.pass_threshold ?? ''));
  const [ponderacion, setPonderacion] = useState(formatNumero(evaluacion.weight));
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null); // { tone, text }

  async function guardar(e) {
    e.preventDefault();
    if (guardando) return;
    const r = validarCalificacion({ exigencia, ponderacion }, evaluacion);
    if (r.error) {
      setMensaje({ tone: r.error === 'No cambiaste nada.' ? 'info' : 'error', text: r.error });
      return;
    }
    if (r.input.pass_threshold !== undefined
      && !window.confirm(`Cambiar la exigencia a ${r.input.pass_threshold} % recalcula la nota de todos los que ya rindieron «${evaluacion.title}». ¿Continuar?`)) return;
    setGuardando(true);
    setMensaje(null);
    try {
      await updateGrading(token, evaluacion.id, r.input);
      setMensaje({ tone: 'success', text: 'Guardado. Las notas se recalcularon.' });
      onGuardado();
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      setMensaje({ tone: 'error', text: err.message });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className={styles.calif} onSubmit={guardar} aria-label={`Calificación de ${evaluacion.title}`}>
      <div className={styles.califTitulo}>
        <b>{evaluacion.title}</b>
        <small>{normalizarEstado(evaluacion.status) === 'closed' ? 'Cerrada · publicada' : 'Publicada'} el {formatFecha(evaluacion.published_at)}</small>
      </div>
      <Field label="Exigencia (%)" className={styles.num}>
        <input inputMode="numeric" required value={exigencia} onChange={(e) => setExigencia(e.target.value)} />
      </Field>
      <Field label="Ponderación" className={styles.num}>
        <input inputMode="decimal" required value={ponderacion} onChange={(e) => setPonderacion(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="soft" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      {mensaje && <div className={styles.califMsg}><FormMessage tone={mensaje.tone}>{mensaje.text}</FormMessage></div>}
    </form>
  );
}

/** Docente · Libro de notas (doc-libro/<curso>): notas de cada estudiante, en riesgo, resumen por evaluación y calificación (H3). */
export function DocenteLibroNotasPage({ param: courseId }) {
  const curso = useApiData((t, opts) => getCourse(t, courseId, opts), courseId);
  // Con caché: al recargar (después de guardar una calificación) se sigue viendo el libro en vez de «Cargando…».
  const libro = useApiData((t, opts) => getGradebook(t, courseId, opts), courseId, { cache: 'doc-libro' });
  // Umbral de riesgo elegido en pantalla (v1.12): el servidor calcula quiénes quedan bajo esa nota.
  const [umbral, setUmbral] = useState(4);
  const resumen = useApiData((t, opts) => getGradesSummary(t, courseId, { threshold: umbral, ...opts }), `${courseId}|${umbral}`, { cache: 'doc-resumen' });
  const recargar = () => {
    libro.reload();
    resumen.reload();
  };

  const { columnas, filas } = tablaLibro(libro.data);
  const enRiesgo = resumen.data?.at_risk ?? [];
  const nombreCurso = curso.data?.subject ?? curso.data?.name ?? 'Curso';

  return (
    <>
      <p className={gestion.crumbs}>
        <PortalLink to="doc-cursos">Mis cursos</PortalLink> / <PortalLink to="doc-curso" param={courseId}>{nombreCurso}</PortalLink> / Libro de notas
      </p>
      <LoadState loading={libro.loading} error={libro.error} onRetry={libro.reload} notFound={NO_DISPONIBLE}>
        <PageHead title="Libro de notas" subtitle={`${curso.data?.name ?? ''} · Notas en escala 1,0 a 7,0. El promedio pondera cada evaluación según su peso.`}>
          <Button size="sm" variant="soft" onClick={recargar}>Actualizar</Button>
          <Button size="sm" variant="soft" disabled={!libro.data} onClick={() => guardarArchivo({
            blob: new Blob([libroACsv(columnas, filas, { curso: curso.data?.name ?? '' })], { type: 'text/csv;charset=utf-8' }),
            name: nombreCsv(curso.data?.name),
          })}>Exportar CSV</Button>
          <Button size="sm" variant="ghost" href={routeHref('doc-curso', courseId)}>Volver al curso</Button>
        </PageHead>

        <div className={styles.kpis}>
          <Kpi label="Estudiantes" value={String(filas.length)} hint="Matriculados activos" />
          <Kpi label="Promedio del curso" value={formatNota(libro.data?.course_average)} hint="Promedio de los promedios" tone="success" />
          <Kpi label="En riesgo" value={resumen.data ? String(enRiesgo.length) : '—'} hint={`Promedio bajo ${formatNota(resumen.data?.at_risk_threshold ?? 4)}`} tone={enRiesgo.length > 0 ? 'danger' : 'success'} />
          <Kpi label="Evaluaciones" value={String(columnas.length)} hint="Publicadas o cerradas" tone="warning" />
        </div>

        <Card as="section" aria-labelledby="libro-titulo">
          <h2 id="libro-titulo" className={gestion.h2}>Notas por estudiante</h2>
          {filas.some((f) => f.provisionales?.some(Boolean)) && (
            <p className={gestion.sub}>* Nota provisional: tiene respuestas escritas por revisar (cuentan 0 hasta que las revises en la evaluación).</p>
          )}
          {filas.length === 0 ? (
            <EmptyState title="Aún no hay estudiantes">Matricúlalos desde la página del curso.</EmptyState>
          ) : (
            <div className={styles.scroll} role="region" aria-label="Libro de notas" tabIndex={0}>
              <table className={styles.table}>
                <caption className={styles.srOnly}>Notas de cada estudiante por evaluación, en escala de 1,0 a 7,0</caption>
                <thead>
                  <tr>
                    <th scope="col">Estudiante</th>
                    {columnas.map((c) => (
                      <th key={c.id} scope="col" title={c.title}>
                        <span className={styles.colTitulo}>{c.title}</span>
                        <small>Pond. {formatNumero(c.weight)}</small>
                      </th>
                    ))}
                    <th scope="col">Promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <th scope="row"><PortalLink to="doc-estudiante" param={paramEstudiante(courseId, f.id)}>{f.nombre}</PortalLink></th>
                      {f.notas.map((nota, i) => (
                        <td key={columnas[i].id} className={styles[tonoNota(nota)]}>
                          <span className={styles.srOnly}>{columnas[i].title}: </span>
                          {nota === null ? <span aria-label="sin rendir">—</span> : formatNota(nota)}
                          {f.provisionales?.[i] && <span className={styles.provisional} title="Provisional: tiene respuestas escritas por revisar">*<span className={styles.srOnly}> (provisional, por revisar)</span></span>}
                        </td>
                      ))}
                      <td className={`${styles.average} ${styles[tonoNota(f.promedio)]}`}>{formatNota(f.promedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className={gestion.split}>
          <Card as="section" aria-labelledby="riesgo-titulo">
            <h2 id="riesgo-titulo" className={gestion.h2}>Estudiantes en riesgo</h2>
            <p className={gestion.sub}>Promedio bajo {formatNota(resumen.data?.at_risk_threshold ?? umbral)} con las evaluaciones que ya rindieron.</p>
            <label className={styles.umbral}>
              Umbral de riesgo
              <select value={umbral} onChange={(e) => setUmbral(Number(e.target.value))}>
                {[3.5, 4, 4.5, 5, 5.5].map((n) => <option key={n} value={n}>Bajo {formatNota(n)}</option>)}
              </select>
            </label>
            <LoadState loading={resumen.loading} error={resumen.error} onRetry={resumen.reload}>
              {enRiesgo.length === 0 ? (
                <EmptyState title="Nadie en riesgo por ahora">Todos los que rindieron tienen promedio aprobatorio.</EmptyState>
              ) : (
                <ul className={gestion.rows}>
                  {enRiesgo.map((s) => (
                    <li key={s.student_id} className={gestion.row}>
                      <div className={gestion.grow}>
                        <b>{s.name}</b>
                        <small>
                          {s.assessments_taken} evaluaci{s.assessments_taken === 1 ? 'ón rendida' : 'ones rendidas'}
                          {s.provisional_grades > 0 && ` · ${s.provisional_grades} nota${s.provisional_grades === 1 ? '' : 's'} provisional${s.provisional_grades === 1 ? '' : 'es'}: puede cambiar al revisar`}
                        </small>
                      </div>
                      <b className={styles.danger}>{formatNota(s.average)}</b>
                      <PortalLink className={gestion.rowLink} to="doc-estudiante" param={paramEstudiante(courseId, s.student_id)}>Ver notas</PortalLink>
                    </li>
                  ))}
                </ul>
              )}
            </LoadState>
          </Card>

          <Card as="section" aria-labelledby="calif-titulo">
            <h2 id="calif-titulo" className={gestion.h2}>Exigencia y ponderación</h2>
            <p className={gestion.sub}>
              Exigencia: % de logro que equivale al 4,0. Ponderación: peso de la evaluación en el promedio. Al cambiarlas, las notas se recalculan solas.
            </p>
            {columnas.length === 0 ? (
              <EmptyState title="Sin evaluaciones publicadas">Publica una evaluación para ajustar su calificación.</EmptyState>
            ) : (
              <div className={gestion.rows}>
                {columnas.map((c) => (
                  // Key solo con el id: al recargar el libro el formulario no se reinicia y su mensaje se mantiene.
                  <FilaCalificacion key={c.id} evaluacion={c} onGuardado={recargar} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card as="section" aria-labelledby="resumen-titulo">
          <h2 id="resumen-titulo" className={gestion.h2}>Resumen por evaluación</h2>
          <LoadState loading={resumen.loading} error={resumen.error} onRetry={resumen.reload}>
            {(resumen.data?.assessments ?? []).length === 0 ? (
              <EmptyState title="Sin evaluaciones publicadas">Cuando publiques una, verás aquí sus entregas y promedios.</EmptyState>
            ) : (
              <div className={styles.scroll} role="region" aria-label="Resumen por evaluación" tabIndex={0}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Evaluación</th><th scope="col">Entregas</th><th scope="col">Pendientes</th><th scope="col">Promedio</th>
                      <th scope="col">Mínima</th><th scope="col">Máxima</th><th scope="col">Aprobados</th><th scope="col">Reprobados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.data.assessments.map((a) => (
                      <tr key={a.assessment_id}>
                        <th scope="row"><PortalLink to="doc-evaluacion" param={a.assessment_id}>{a.title}</PortalLink></th>
                        <td>{a.submissions}</td>
                        <td>{a.pending}</td>
                        <td className={`${styles.average} ${styles[tonoNota(a.average)]}`}>{formatNota(a.average)}</td>
                        <td className={styles[tonoNota(a.min)]}>{formatNota(a.min)}</td>
                        <td className={styles[tonoNota(a.max)]}>{formatNota(a.max)}</td>
                        <td>{a.passed}</td>
                        <td>{a.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </LoadState>
        </Card>
      </LoadState>
    </>
  );
}
