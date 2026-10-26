import { useState } from 'react';
import { getMyGrades } from '../../../api/portalApi.js';
import { Chip, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { formatNota, tonoNota } from '../../utils/notas.js';
import styles from './MisCursosPage.module.css';

// Color de la franja de cada tarjeta, como en el prototipo (azul, verde, naranja…).
const FRANJAS = ['var(--fp-accent)', 'var(--fp-success)', 'var(--fp-warning)'];

const coincide = (ramo, texto) =>
  [ramo.subject, ramo.course, ramo.teacher_name].some((v) => (v ?? '').toLowerCase().includes(texto));

/** Estudiante · Mis cursos: sus asignaturas, con profesor, promedio y si el tutor tiene apuntes. */
export function MisCursosPage() {
  const { data, loading, error, reload } = useApiData(getMyGrades);
  const [busqueda, setBusqueda] = useState('');
  const ramos = (data?.courses ?? []).filter((r) => coincide(r, busqueda.trim().toLowerCase()));

  return (
    <>
      <PageHead title="Mis cursos" subtitle="Accede a tus asignaturas y continúa con tu aprendizaje.">
        <input
          className={styles.search}
          type="search"
          placeholder="Buscar curso…"
          aria-label="Buscar curso"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </PageHead>

      <LoadState loading={loading} error={error} onRetry={reload}>
        {data?.courses.length === 0 && (
          <EmptyState title="Aún no tienes cursos">Aparecerán aquí cuando tu colegio te matricule en una asignatura.</EmptyState>
        )}
        {data?.courses.length > 0 && ramos.length === 0 && (
          <EmptyState>Ningún curso coincide con «{busqueda}».</EmptyState>
        )}

        <div className={styles.grid}>
          {ramos.map((ramo, i) => (
            <article
              key={ramo.course_id}
              className={styles.course}
              style={{ '--franja': FRANJAS[i % FRANJAS.length] }}
              data-fp-surface=""
              data-fp-lift=""
            >
              <h2>{ramo.subject ?? ramo.course}</h2>
              <p className={styles.meta}>Docente: {ramo.teacher_name}</p>
              <p className={styles.meta}>{ramo.course}</p>

              <div className={styles.promedio}>
                <span>Promedio</span>
                <b className={styles[tonoNota(ramo.average)]}>{formatNota(ramo.average)}</b>
              </div>
              {/* Barra del promedio en la escala 1,0–7,0: un 1,0 queda vacía y un 7,0 llena (en el prototipo es el progreso del curso). */}
              <div className={styles.track} aria-hidden="true">
                <i style={{ width: `${ramo.average ? ((ramo.average - 1) / 6) * 100 : 0}%` }} />
              </div>

              <div className={styles.foot}>
                <Chip tone={ramo.tutor_available ? 'success' : 'neutral'}>
                  {ramo.tutor_available ? 'Tutor IA disponible' : 'Sin apuntes aún'}
                </Chip>
                <PortalLink to="est-curso" param={ramo.course_id} className={styles.enter}>
                  Entrar al curso
                </PortalLink>
              </div>
            </article>
          ))}
        </div>
      </LoadState>
    </>
  );
}
