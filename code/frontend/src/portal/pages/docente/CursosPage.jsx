import { useState } from 'react';
import { getCourses } from '../../../api/portalApi.js';
import { Button, Chip, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { routeHref } from '../../router/parseRoute.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import styles from './CursosPage.module.css';

const FRANJAS = ['var(--fp-accent)', 'var(--fp-success)', 'var(--fp-warning)'];

const coincide = (curso, texto) => [curso.name, curso.subject, curso.grade_level].some((v) => (v ?? '').toLowerCase().includes(texto));

/** Docente · Mis cursos: las clases que dicta, con cuántos apuntes tiene cada una para el Tutor IA. */
export function DocenteCursosPage() {
  const { data, loading, error, reload } = useApiData(getCourses);
  const [busqueda, setBusqueda] = useState('');
  const cursos = (data ?? []).filter((c) => coincide(c, busqueda.trim().toLowerCase()));

  return (
    <>
      <PageHead title="Mis cursos" subtitle="Crea cursos, matricula a tus estudiantes, arma evaluaciones y sube los apuntes que usa el Tutor IA.">
        <Button size="sm" href={routeHref('doc-curso-nuevo')}>Nuevo curso</Button>
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
        {data?.length === 0 && <EmptyState title="Aún no tienes cursos">Crea el primero con «Nuevo curso» o espera a que tu colegio te asigne una asignatura.</EmptyState>}
        {data?.length > 0 && cursos.length === 0 && <EmptyState>Ningún curso coincide con «{busqueda}».</EmptyState>}

        <div className={styles.grid}>
          {cursos.map((curso, i) => (
            <article key={curso.id} className={styles.course} style={{ '--franja': FRANJAS[i % FRANJAS.length] }} data-fp-surface="" data-fp-lift="">
              <h2>{curso.subject ?? curso.name}</h2>
              <p className={styles.meta}>{curso.name}</p>
              {curso.students_count !== undefined && <p className={styles.meta}>{curso.students_count} estudiantes</p>}
              <div className={styles.foot}>
                <Chip tone={curso.tutor_available ? 'success' : 'neutral'}>
                  {curso.tutor_available ? `${curso.tutor_documents} apunte${curso.tutor_documents === 1 ? '' : 's'} en el tutor` : 'Sin apuntes aún'}
                </Chip>
                <PortalLink to="doc-curso" param={curso.id} className={styles.enter}>
                  Gestionar curso
                </PortalLink>
              </div>
            </article>
          ))}
        </div>
      </LoadState>
    </>
  );
}
