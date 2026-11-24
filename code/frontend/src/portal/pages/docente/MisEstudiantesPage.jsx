import { useState } from 'react';
import { getCourses, getEnrollments } from '../../../api/portalApi.js';
import { Card, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { estudiantesDeCursos, filtrarEstudiantes, paramEstudiante } from '../../utils/libroNotas.js';
import gestion from './Gestion.module.css';
import styles from './Notas.module.css';

/** Mis cursos y los matriculados de cada uno (una petición por curso, en paralelo). */
async function cargar(token, opts) {
  const cursos = await getCourses(token, opts);
  return Promise.all(cursos.map(async (curso) => ({ curso, matriculas: (await getEnrollments(token, curso.id, opts)).data })));
}

/** Docente · Mis estudiantes: todos los estudiantes de sus cursos, con acceso a sus notas en cada uno (H3). */
export function DocenteMisEstudiantesPage() {
  const { data, loading, error, reload } = useApiData(cargar);
  const [busqueda, setBusqueda] = useState('');
  const todos = estudiantesDeCursos(data ?? []);
  const lista = filtrarEstudiantes(todos, busqueda);

  return (
    <>
      <PageHead title="Mis estudiantes" subtitle="Estudiantes matriculados en tus cursos. Elige un curso para ver sus notas.">
        <input
          className={styles.search}
          type="search"
          placeholder="Buscar por nombre o correo…"
          aria-label="Buscar estudiante"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </PageHead>

      <LoadState loading={loading} error={error} onRetry={reload}>
        <Card as="section" aria-label="Estudiantes">
          <p className={gestion.sub} role="status">
            {todos.length} estudiante{todos.length === 1 ? '' : 's'} en {data?.length ?? 0} curso{data?.length === 1 ? '' : 's'}
            {busqueda.trim() && ` · ${lista.length} coincide${lista.length === 1 ? '' : 'n'}`}
          </p>
          {todos.length === 0 && <EmptyState title="Aún no tienes estudiantes">Matricúlalos desde la página de cada curso.</EmptyState>}
          {todos.length > 0 && lista.length === 0 && <EmptyState>Nadie coincide con «{busqueda}».</EmptyState>}
          <ul className={gestion.rows}>
            {lista.map((e) => (
              <li key={e.id} className={gestion.row}>
                <div className={gestion.grow}>
                  <b>{e.nombre}</b>
                  <small>{e.email}</small>
                  <div className={styles.chips}>
                    {e.cursos.map((c) => (
                      <PortalLink key={c.id} className={styles.chipLink} to="doc-estudiante" param={paramEstudiante(c.id, e.id)} aria-label={`Notas de ${e.nombre} en ${c.nombre}`}>
                        {c.nombre}
                      </PortalLink>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </LoadState>
    </>
  );
}
