import { getMyGrades } from '../../../api/portalApi.js';
import { EmptyState, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { contarNotas, formatNota, periodosDe, promedioGeneral } from '../../utils/notas.js';
import styles from './ProgresoPage.module.css';

const colors=['#0eaaa3','#2d9a65','#7078d7','#df9b34'];
const pct=n=>n==null?null:Math.max(0,Math.min(100,Math.round((n-1)/6*100)));
export function ProgresoPage(){
 const {data,loading,error,reload}=useApiData(getMyGrades,'',{cache:'me/grades'});
 const all=data?.courses??[];const period=periodosDe(all)[0];const courses=period?all.filter(c=>c.period===period):all;
 const avg=promedioGeneral(courses);
 return <section className={styles.page}><header><p className={styles.overline}>Período actual {period||''}</p><h1>Mi progreso</h1><p>Revisa tu rendimiento en las asignaturas del período actual.</p></header>
 <LoadState loading={loading} error={error} onRetry={reload}><div className={styles.cards}><article><small>Promedio general</small><strong>{formatNota(avg)}</strong><span>Escala 1,0–7,0</span></article><article><small>Asignaturas</small><strong>{courses.length}</strong><span>Inscritas este período</span></article><article><small>Evaluaciones</small><strong>{contarNotas(courses)}</strong><span>Notas registradas</span></article></div>
 <div className={styles.section}><h2>Rendimiento por asignatura</h2><p>Comparación de tus promedios actuales.</p></div>
 <div className={styles.subjects}>{courses.map((c,i)=><article key={c.course_id} className={styles.subject}><div><strong>{c.subject||c.course}</strong><span>{c.course}</span></div><b>{formatNota(c.average)}</b><div className={styles.track} aria-label={`Promedio ${formatNota(c.average)}`}><i style={{width:`${pct(c.average)??0}%`,background:colors[i%colors.length]}}/></div></article>)}</div>
 {!courses.length&&<EmptyState>Tu progreso aparecerá cuando tengas cursos asignados.</EmptyState>}
 </LoadState><p className={styles.note}>Las barras muestran el promedio relativo en escala 1,0–7,0; no son porcentajes de avance curricular. Datos de calificaciones del portal.</p></section>;
}