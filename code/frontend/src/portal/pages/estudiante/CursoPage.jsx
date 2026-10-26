import { useState } from 'react';
import { getCourse, getGradeDetail, getMyGrades } from '../../../api/portalApi.js';
import { Icon } from '../../components/icons.jsx';
import { Button, Card, Chip, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { routeHref } from '../../router/parseRoute.js';
import { formatFecha, formatNota, formatNumero, tonoNota } from '../../utils/notas.js';
import styles from './CursoPage.module.css';

// 404: el curso no existe o no participas en él (la API no distingue, para no revelar nada).
const NO_DISPONIBLE = {
  title: 'Curso no disponible',
  action: (
    <Button size="sm" variant="soft" href={routeHref('est-cursos')}>
      Volver a Mis cursos
    </Button>
  ),
};

/** Curso + mis notas en él, en una sola carga. 404 si el curso no existe o no participo en él. */
async function cargarCurso(token, courseId, opts) {
  const [curso, notas] = await Promise.all([getCourse(token, courseId, opts), getMyGrades(token, opts)]);
  return { curso, ramo: notas.courses.find((c) => c.course_id === courseId) };
}

/** Respuestas de una evaluación entregada, con la retroalimentación del docente (solo lectura). */
function DetalleEvaluacion({ assessmentId }) {
  const { data, loading, error, reload } = useApiData((token, opts) => getGradeDetail(token, assessmentId, opts), assessmentId);
  return (
    <LoadState loading={loading} error={error} onRetry={reload}>
      {data?.answers.length === 0 && (
        <EmptyState>Esta evaluación no tiene preguntas registradas: solo se guardó tu puntaje.</EmptyState>
      )}
      {data?.answers.length > 0 && (
        <ol className={styles.answers}>
          {data.answers.map((a) => (
            <li key={a.order} className={a.correct ? styles.ok : styles.bad}>
              <div className={styles.answerHead}>
                <b>{a.question}</b>
                <Chip tone={a.correct ? 'success' : 'danger'}>{a.correct ? 'Correcta' : 'Incorrecta'}</Chip>
              </div>
              <p className={styles.chosen}>Tu respuesta: {a.selected_option ?? 'Sin responder'}</p>
              {a.feedback && <p className={styles.feedback}>{a.feedback}</p>}
            </li>
          ))}
        </ol>
      )}
    </LoadState>
  );
}

/** Estudiante · Curso: asignatura, profesor, tutor y mis evaluaciones con su nota (est-curso/<id>). */
export function CursoPage({ param: courseId }) {
  const { data, loading, error, reload } = useApiData((token, opts) => cargarCurso(token, courseId, opts), courseId);
  const [abierta, setAbierta] = useState(null);
  const curso = data?.curso;
  const notas = data?.ramo?.grades ?? [];

  return (
    <>
      <nav className={styles.crumbs} aria-label="Ruta">
        <PortalLink to="est-cursos">Mis cursos</PortalLink> / <span>{curso?.subject ?? curso?.name ?? 'Curso'}</span>
      </nav>

      <LoadState loading={loading} error={error} onRetry={reload} notFound={NO_DISPONIBLE}>
        {curso && (
          <>
            <div className={styles.head}>
              <PageHead title={curso.subject ?? curso.name} subtitle={`Docente: ${curso.teacher_name} · ${curso.name}`} />
              <Card tight className={styles.average}>
                <div className={styles.label}>Promedio del ramo</div>
                <b className={`${styles.big} ${styles[tonoNota(data.ramo?.average)]}`}>{formatNota(data.ramo?.average)}</b>
              </Card>
            </div>

            <div className={styles.split}>
              <Card as="section">
                <h2>Evaluaciones de {curso.subject ?? curso.name}</h2>
                <p className={styles.sub}>Solo lectura: las notas se calculan con el puntaje y la exigencia de cada evaluación.</p>
                {notas.length === 0 && <EmptyState>Aún no tienes evaluaciones corregidas en este curso.</EmptyState>}
                <ul className={styles.rows}>
                  {notas.map((n) => {
                    const open = abierta === n.assessment_id;
                    return (
                      <li key={n.assessment_id}>
                        <button
                          type="button"
                          className={styles.row}
                          aria-expanded={open}
                          aria-controls={`fp-detalle-${n.assessment_id}`}
                          onClick={() => setAbierta(open ? null : n.assessment_id)}
                        >
                          <span className={styles.grow}>
                            <b>{n.title}</b>
                            <small>
                              {formatFecha(n.submitted_at)} · Ponderación {formatNumero(n.weight)}
                            </small>
                          </span>
                          <Chip tone={tonoNota(n.grade)}>Corregida · {formatNota(n.grade)}</Chip>
                          <Icon name="chevron" size={18} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
                        </button>
                        {/* El contenedor existe siempre para que aria-controls apunte a algo; el detalle se pide al abrir. */}
                        <div id={`fp-detalle-${n.assessment_id}`} className={styles.detail} hidden={!open}>
                          {open && <DetalleEvaluacion assessmentId={n.assessment_id} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <Card as="aside" className={styles.tutor}>
                <div className={styles.eyebrow}>Tutor IA</div>
                <h2>¿Tienes dudas?</h2>
                {curso.tutor_available ? (
                  <>
                    <p className={styles.sub}>
                      Tu docente subió {curso.tutor_documents} {curso.tutor_documents === 1 ? 'apunte' : 'apuntes'}: el tutor responde con ese material.
                    </p>
                    <Button variant="accent" size="sm" href={routeHref('est-tutor', courseId)}>
                      Preguntar sobre este curso
                    </Button>
                  </>
                ) : (
                  <p className={styles.sub}>Tu docente aún no sube apuntes de este curso. Cuando lo haga, podrás preguntarle al tutor.</p>
                )}
              </Card>
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}
