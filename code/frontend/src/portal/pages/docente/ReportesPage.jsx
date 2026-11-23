import { useState } from 'react';
import { getCourses, getAssessments, getAssessmentResults } from '../../../api/portalApi.js';
import { LoadState, PageHead, Kpi } from '../../components/ui/index.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useApiData } from '../../hooks/useApiData.js';
import styles from '../administrador/Management.module.css';

async function cargarReportes(token, opts) {
  const cursos = await getCourses(token, opts);
  const grupos = await Promise.all(cursos.map(async (curso) => ({ curso, evaluaciones: (await getAssessments(token, curso.id, opts)).data ?? [] })));
  return grupos;
}
function ReporteEvaluacion({ assessment }) {
  const {data,loading,error,reload}=useApiData((token,opts)=>getAssessmentResults(token,assessment.id,opts),assessment.id);
  const questions=data?.questions??[];
  return <div className={styles.detail}>
    <div className={styles.panelHead}><div><h3>Resultados: {assessment.title}</h3><p>Resumen de entregas y aciertos por pregunta.</p></div><PortalLink to="doc-evaluacion" param={assessment.id}>Abrir evaluación</PortalLink></div>
    <LoadState loading={loading} error={error} onRetry={reload}>
      <div className={styles.miniStats}><div><small>Entregas</small><strong>{data?.submissions_count??0}</strong></div><div><small>Logro promedio</small><strong>{data?.average_score==null?'—':`${Number(data.average_score).toLocaleString('es-CL')} %`}</strong></div><div><small>Nota promedio</small><strong>{data?.average_grade==null?'—':Number(data.average_grade).toLocaleString('es-CL')}</strong></div></div>
      <h4>Porcentaje de acierto por pregunta</h4>
      {questions.length ? questions.map(q=>{const pct=Math.min(100,Math.max(0,Math.round((q.correct_rate??0)*100)));return <div className={styles.question} key={q.question_id}><span>Pregunta {q.order}</span><div className={styles.bar} aria-label={`${pct} por ciento correcto`}><i style={{width:`${pct}%`}}/></div><strong>{pct}%</strong></div>}) : <p className={styles.note}>Sin resultados por pregunta.</p>}
    </LoadState>
  </div>;
}
export function DocenteReportesPage() {
  const {data, loading, error, reload} = useApiData(cargarReportes);
  const [selected,setSelected]=useState(null);
  const lista = data ?? [];
  const evaluaciones = lista.reduce((n, r) => n + r.evaluaciones.length, 0);
  const entregas = lista.reduce((n, r) => n + r.evaluaciones.reduce((k, e) => k + (e.submissions_count ?? 0), 0), 0);
  return <>
    <PageHead title="Reportes" subtitle="Resumen académico de tus cursos y evaluaciones." />
    <LoadState loading={loading} error={error} onRetry={reload}>
      <div className={styles.kpis}><Kpi label="Cursos activos" value={String(lista.length)} /><Kpi label="Evaluaciones" value={String(evaluaciones)} tone="success" /><Kpi label="Entregas registradas" value={String(entregas)} tone="warning" /></div>
      <section className={styles.panel}><div className={styles.panelHead}><div><h2>Actividad por curso</h2><p>Resumen obtenido desde las evaluaciones registradas.</p></div></div>
        {lista.length === 0 ? <p className={styles.empty}>No existen cursos asignados.</p> : <div className={styles.scroll} role="region" tabIndex={0} aria-label="Reportes por curso"><table className={styles.table}><thead><tr><th>Curso</th><th>Evaluaciones</th><th>Entregas</th><th>Acciones</th></tr></thead><tbody>{lista.map(({curso, evaluaciones: ev}) => <tr key={curso.id}><th scope="row">{curso.name}</th><td>{ev.length}</td><td>{ev.reduce((n, e) => n + (e.submissions_count ?? 0), 0)}</td><td><PortalLink to="doc-curso" param={curso.id}>Ver curso</PortalLink> · <PortalLink to="doc-evaluacion-nueva" param={curso.id}>Nueva evaluación</PortalLink></td></tr>)}</tbody></table></div>}
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Resultados por evaluación</h2><p>Selecciona una evaluación publicada o cerrada para consultar sus resultados.</p></div></div>
        <div className={styles.filters}>
          <select aria-label="Seleccionar evaluación" value={selected??''} onChange={e=>setSelected(e.target.value||null)}>
            <option value="">Selecciona una evaluación</option>
            {lista.flatMap(({curso,evaluaciones:ev})=>ev.filter(e=>e.status!=='draft').map(e=><option key={e.id} value={e.id}>{curso.name} · {e.title}</option>))}
          </select>
        </div>
        {selected && <ReporteEvaluacion key={selected} assessment={{...lista.flatMap(g=>g.evaluaciones).find(e=>e.id===selected),id:selected}}/>}
        {!lista.some(g=>g.evaluaciones.some(e=>e.status!=='draft'))&&<p className={styles.note}>No hay evaluaciones publicadas o cerradas.</p>}
      </section>
    </LoadState>
    <section className={styles.panel}><div className={styles.panelHead}><div><h2>Gestión de evaluaciones</h2><p>Desde aquí puedes editar borradores, publicar y consultar resultados.</p></div><PortalLink to="doc-evaluaciones">Ir a evaluaciones</PortalLink></div></section>
    <p className={styles.note}>El backend todavía no entrega asistencia ni tendencias históricas comparables. Este reporte utiliza únicamente datos disponibles.</p>
  </>;
}
