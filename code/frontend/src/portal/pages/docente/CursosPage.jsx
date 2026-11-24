import { useState } from 'react';
import { getCourses } from '../../../api/portalApi.js';
import { Button, EmptyState, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { routeHref } from '../../router/parseRoute.js';
import styles from './CursosPage.module.css';

const matches=(c,q)=>[c.name,c.subject,c.grade_level].some(x=>(x??'').toLowerCase().includes(q));
export function DocenteCursosPage(){
 const {data,loading,error,reload}=useApiData(getCourses); const [search,setSearch]=useState('');
 const courses=(data??[]).filter(c=>matches(c,search.toLowerCase().trim()));
 return <section className={styles.page}><div className={styles.head}><div><p className={styles.breadcrumb}>Mis cursos</p><h1>Mis cursos</h1><p>Gestiona las asignaturas, estudiantes y contenidos de tus cursos.</p></div><Button size="sm" href={routeHref('doc-curso-nuevo')}>+ Nuevo curso</Button></div>
 <div className={styles.titleBar}><div><h2>Tus cursos</h2><p>{data?.length??0} asignaturas activas</p></div><input type="search" aria-label="Buscar curso" placeholder="Buscar curso..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <LoadState loading={loading} error={error} onRetry={reload}><div className={styles.scroll}><table className={styles.table}><thead><tr><th>Asignatura</th><th>Curso</th><th>Estudiantes</th><th>Material de tutor IA</th><th>Acción</th></tr></thead><tbody>{courses.map(c=><tr key={c.id}><td><strong>{c.subject||c.name}</strong><small>{c.grade_level||'Asignatura'}</small></td><td>{c.name}</td><td>{c.students_count??'—'}</td><td>{c.tutor_documents!=null?`${c.tutor_documents} documentos`:c.tutor_available?'Disponible':'Sin apuntes'}</td><td><PortalLink to="doc-curso" param={c.id} className={styles.enter}>Entrar →</PortalLink></td></tr>)}</tbody></table></div>{!courses.length&&<EmptyState>{data?.length?'Ningún curso coincide con tu búsqueda.':'No hay cursos asignados.'}</EmptyState>}</LoadState>
 <div className={styles.bottom}><h2>Tus cursos</h2><p>Selecciona una asignatura para ver su contenido.</p></div></section>
}
