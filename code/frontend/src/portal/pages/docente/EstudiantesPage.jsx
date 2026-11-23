import { useState } from 'react';
import { getCourses, getEnrollments } from '../../../api/portalApi.js';
import { LoadState, PageHead, EmptyState } from '../../components/ui/index.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useApiData } from '../../hooks/useApiData.js';
import styles from '../administrador/Management.module.css';

async function cargarEstudiantes(token, opts) {
  const cursos = await getCourses(token, opts);
  const matriculas = await Promise.all(cursos.map(async (curso) => {
    const resultado = await getEnrollments(token, curso.id, opts);
    return (resultado.data ?? []).map((est) => ({ ...est, cursoId: curso.id, curso: curso.name }));
  }));
  return matriculas.flat();
}

export function DocenteEstudiantesPage() {
  const { data, loading, error, reload } = useApiData(cargarEstudiantes);
  const [texto, setTexto] = useState('');
  const [curso, setCurso] = useState('');
  const registros = data ?? [];
  const cursos = [...new Set(registros.map((r) => r.curso))].sort();
  const filas = registros.filter((r) => (!curso || r.curso === curso) &&
    [r.name, r.email, r.curso].some((v) => String(v ?? '').toLocaleLowerCase().includes(texto.toLocaleLowerCase())));
  return <>
    <PageHead title="Mis estudiantes" subtitle="Estudiantes matriculados en tus cursos, según la información del colegio." />
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>Listado de estudiantes</h2><p>Busca por nombre, correo o curso.</p></div></div>
      <div className={styles.filters}>
        <input value={texto} type="search" onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre o curso..." aria-label="Buscar estudiantes" />
        <select aria-label="Filtrar por curso" value={curso} onChange={(e) => setCurso(e.target.value)}><option value="">Todos los cursos</option>{cursos.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      <LoadState loading={loading} error={error} onRetry={reload}>
        {!filas.length ? <EmptyState title="Sin estudiantes coincidentes">Los estudiantes aparecerán cuando estén matriculados en tus cursos.</EmptyState> :
          <div className={styles.scroll} role="region" tabIndex={0} aria-label="Estudiantes matriculados"><table className={styles.table}>
            <thead><tr><th>Estudiante</th><th>Curso</th><th>Correo institucional</th><th>Progreso</th><th>Acciones</th></tr></thead>
            <tbody>{filas.map((e) => <tr key={`${e.cursoId}-${e.student_id ?? e.id}`}><th scope="row">{e.name}</th><td>{e.curso}</td><td>{e.email}</td><td className={styles.muted}>No disponible</td><td><PortalLink to="doc-curso" param={e.cursoId}>Ver curso</PortalLink> · <PortalLink to="doc-evaluacion-nueva" param={e.cursoId}>Crear evaluación</PortalLink></td></tr>)}</tbody>
          </table></div>}
      </LoadState>
    </section>
    <p className={styles.note}>Las métricas de asistencia y progreso individual del Figma aún no están disponibles en la API. No se generan valores de ejemplo.</p>
  </>;
}
