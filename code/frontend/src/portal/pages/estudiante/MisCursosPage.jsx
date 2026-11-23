import { useMemo, useState } from 'react';
import { getMyGrades } from '../../../api/portalApi.js';
import { EmptyState, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { periodosDe, nombrePeriodo, formatNota } from '../../utils/notas.js';
import styles from './MisCursosPage.module.css';

const searchMatches = (r, q) => [r.subject,r.course,r.teacher_name].some(x => (x ?? '').toLowerCase().includes(q));
export function MisCursosPage(){
 const {data,loading,error,reload}=useApiData(getMyGrades,'',{cache:'me/grades'});
 const [query,setQuery]=useState(''); const [selected,setSelected]=useState('all');
const all = useMemo(
  () => data?.courses ?? [],
  [data?.courses]
);

const periodos = useMemo(
  () => periodosDe(all),
  [all]
);

const rows = useMemo(
  () =>
    all.filter(
      (r) =>
        (selected === 'all' || r.period === selected) &&
        searchMatches(r, query.trim().toLowerCase())
    ),
  [all, selected, query]
);
 return <section className={styles.page}>
  <header className={styles.heading}><div><span className={styles.eyebrow}>Mis cursos</span><h1>Mis cursos</h1><p>Accede a tus asignaturas y continúa con tu aprendizaje.</p></div><span className={styles.date}>Período académico</span></header>
  <div className={styles.sectionTitle}><div><h2>Tus cursos</h2><p>{all.length} asignaturas activas</p></div><div className={styles.controls}><input aria-label="Buscar curso" type="search" placeholder="Buscar curso..." value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filtrar por período" value={selected} onChange={e=>setSelected(e.target.value)}><option value="all">Todos</option>{periodos.map(p=><option key={p} value={p}>{nombrePeriodo(p)}</option>)}</select></div></div>
  <LoadState loading={loading} error={error} onRetry={reload}><div className={styles.scroller}><table className={styles.table}><thead><tr><th>Asignatura</th><th>Docente</th><th>Período</th><th>Promedio</th><th>Acción</th></tr></thead><tbody>{rows.map((r)=>{return <tr key={r.course_id}><td><strong>{r.subject??r.course}</strong><small>{r.course}</small></td><td>{r.teacher_name||'Sin asignar'}</td><td>{r.period||'—'}</td><td><strong>{formatNota(r.average)}</strong></td><td><PortalLink to="est-curso" param={r.course_id} className={styles.enter}>Entrar →</PortalLink> {r.tutor_available && <PortalLink to="est-tutor" param={r.course_id} className={styles.tutorLink}>Tutor IA</PortalLink>}</td></tr>})}</tbody></table></div>{!rows.length&&<EmptyState>{all.length?'No se encontraron cursos.':'Aún no tienes cursos asignados.'}</EmptyState>}</LoadState>
  <div className={styles.lower}><h2>¿Qué puedes hacer en tus cursos?</h2><p>Entrar para rendir evaluaciones pendientes, revisar retroalimentación y acceder al Tutor IA con los apuntes del docente.</p><PortalLink to="est-evaluaciones" className={styles.enter}>Ir a evaluaciones →</PortalLink></div>
 </section>;
}
