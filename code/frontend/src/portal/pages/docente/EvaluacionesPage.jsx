import { useState } from 'react';
import { getAssessments, getCourses } from '../../../api/portalApi.js';
import { Button, Chip, EmptyState, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { estadoEvaluacion } from '../../utils/evaluaciones.js';
import styles from './EvaluacionesPage.module.css';

/** Reúne las evaluaciones de los cursos que el docente tiene permiso de consultar. */
async function obtenerEvaluaciones(token, opts) {
  const cursos = await getCourses(token, opts);
  const grupos = await Promise.all(cursos.map(async (curso) => ({
    curso,
    evaluaciones: (await getAssessments(token, curso.id, opts)).data ?? [],
  })));
  return grupos;
}

function AccionCrear({ cursos }) {
  const [id, setId] = useState(cursos[0]?.id ?? '');
  return <section className={styles.create} aria-label="Crear una evaluación">
    <div>
      <span className={styles.eyebrow}>NUEVA EVALUACIÓN</span>
      <h2>Comienza con un curso</h2>
      <p>Podrás crear preguntas manualmente o generar un borrador con IA usando sus apuntes.</p>
    </div>
    {cursos.length ? <div className={styles.createActions}>
      <label htmlFor="curso-para-evaluacion">Curso</label>
      <select id="curso-para-evaluacion" value={cursos.some(c => c.id === id) ? id : cursos[0].id} onChange={e => setId(e.target.value)}>
        {cursos.map(c => <option key={c.id} value={c.id}>{c.subject || c.name} · {c.name}</option>)}
      </select>
      <Button href={`#/portal/doc-evaluacion-nueva/${encodeURIComponent(cursos.some(c => c.id === id) ? id : cursos[0].id)}`}>
        + Crear evaluación
      </Button>
    </div> : <p>Primero debes crear o recibir la asignación de un curso.</p>}
  </section>;
}

export function DocenteEvaluacionesPage() {
  const { data, loading, error, reload } = useApiData(obtenerEvaluaciones);
  const [busqueda, setBusqueda] = useState('');
  const [filtrarCurso, setFiltrarCurso] = useState('');
  const [filtrarEstado, setFiltrarEstado] = useState('');
  const grupos = data ?? [];
  const cursos = grupos.map(g => g.curso);
  const evaluaciones = grupos.flatMap(g => g.evaluaciones.map(e => ({ ...e, curso: g.curso })));
  const visibles = evaluaciones.filter(e =>
    (!filtrarCurso || e.curso.id === filtrarCurso) &&
    (!filtrarEstado || e.status === filtrarEstado) &&
    `${e.title} ${e.curso.subject || ''} ${e.curso.name}`.toLowerCase().includes(busqueda.trim().toLowerCase())
  );
  const borradores = evaluaciones.filter(e => e.status === 'draft').length;
  const publicadas = evaluaciones.filter(e => e.status === 'published').length;
  const cerradas = evaluaciones.filter(e => e.status === 'closed').length;

  return <>
    <PageHead title="Evaluaciones" subtitle="Crea, edita, publica y revisa las evaluaciones de tus cursos." />
    <LoadState loading={loading} error={error} onRetry={reload}>
      <AccionCrear cursos={cursos} />
      <div className={styles.kpis}>
        <Kpi label="Evaluaciones" value={String(evaluaciones.length)} hint="Total registrado" />
        <Kpi label="Borradores" value={String(borradores)} hint="Se pueden editar" tone="warning" />
        <Kpi label="Publicadas" value={String(publicadas)} hint="Disponibles para rendir" tone="success" />
        <Kpi label="Cerradas" value={String(cerradas)} hint="Consultar resultados" />
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><h2>Mis evaluaciones</h2><p>Accede directamente a la edición, publicación y resultados.</p></div>
          <Button variant="soft" size="sm" onClick={reload}>Actualizar</Button>
        </div>
        <div className={styles.filters}>
          <input type="search" aria-label="Buscar evaluación" placeholder="Buscar por título o curso..." value={busqueda} onChange={e=>setBusqueda(e.target.value)}/>
          <select aria-label="Filtrar por curso" value={filtrarCurso} onChange={e=>setFiltrarCurso(e.target.value)}><option value="">Todos los cursos</option>{cursos.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select aria-label="Filtrar por estado" value={filtrarEstado} onChange={e=>setFiltrarEstado(e.target.value)}><option value="">Todos los estados</option><option value="draft">Borrador</option><option value="published">Publicada</option><option value="closed">Cerrada</option></select>
        </div>
        {!evaluaciones.length ? <EmptyState title="No hay evaluaciones">Selecciona un curso y crea la primera evaluación.</EmptyState> : !visibles.length ? <EmptyState>No hay resultados para los filtros elegidos.</EmptyState> :
          <div className={styles.scroll} role="region" aria-label="Lista de evaluaciones" tabIndex={0}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Evaluación</th><th scope="col">Curso</th><th scope="col">Estado</th><th scope="col">Entregas</th><th scope="col">Acciones</th></tr></thead>
              <tbody>{visibles.map(e => {const estado = estadoEvaluacion(e.status);return <tr key={e.id}>
                <th scope="row"><strong>{e.title}</strong><small>{e.questions_count ?? '—'} preguntas</small></th>
                <td>{e.curso.subject || e.curso.name}<small>{e.curso.name}</small></td>
                <td><Chip tone={estado.tone}>{estado.label}</Chip></td>
                <td>{e.status === 'draft' ? '—' : (e.submissions_count ?? '—')}</td>
                <td><div className={styles.actions}>
                  {e.status === 'draft' && <PortalLink to="doc-evaluacion-editar" param={e.id}>Editar</PortalLink>}
                  <PortalLink to="doc-evaluacion" param={e.id}>{e.status === 'draft' ? 'Revisar y publicar' : 'Ver resultados'}</PortalLink>
                </div></td>
              </tr>})}</tbody>
            </table>
          </div>}
      </section>
      <section className={styles.help}>
        <h2>Flujo de trabajo</h2>
        <ol><li>Selecciona un curso y crea el borrador.</li><li>Escribe preguntas o utiliza «Generar con IA» dentro del editor.</li><li>Revisa respuestas correctas, guarda y publica.</li><li>Consulta resultados y retroalimentación desde esta misma página.</li></ol>
      </section>
    </LoadState>
  </>;
}
