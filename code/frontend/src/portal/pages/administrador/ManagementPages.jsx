import { useState } from 'react';
import {
  createCourse, getCourse, getCourses, getEnrollments, getAssessments,
  getAssessment, getAssessmentResults, enrollStudent,
} from '../../../api/portalApi.js';
import { Kpi, PageHead, LoadState, EmptyState } from '../../components/ui/index.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useApiData } from '../../hooks/useApiData.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import styles from './Management.module.css';

const subject = (c) => c.subject || c.name;
const status = (s) => ({ draft: 'Borrador', published: 'Publicada', closed: 'Cerrada' })[s] ?? (s || 'Sin estado');
const num = (n) => Number.isFinite(Number(n)) ? String(n) : '—';
const readable = (value) => value ? new Date(value).toLocaleDateString('es-CL') : '—';

async function loadAdminData(token, opts) {
  const cursos = await getCourses(token, opts);
  const res = await Promise.all(cursos.map(async (curso) => {
    const [matriculas, evaluaciones] = await Promise.all([
      getEnrollments(token, curso.id, opts), getAssessments(token, curso.id, opts),
    ]);
    return { curso, matriculas: matriculas.data ?? [], evaluaciones: evaluaciones.data ?? [] };
  }));
  return res;
}
const matches = (obj, q) => !q || Object.values(obj).some((v) => String(v ?? '').toLocaleLowerCase().includes(q.toLocaleLowerCase()));
function Section({title, subtitle, children, action}) {
  return <section className={styles.panel}><div className={styles.panelHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function AdminData({children}) {
  const data = useApiData(loadAdminData);
  return <LoadState loading={data.loading} error={data.error} onRetry={data.reload}>{data.data && children(data.data, data.reload)}</LoadState>;
}
function Action({to, param, children}) { return <PortalLink className={styles.action} to={to} param={param}>{children}</PortalLink>; }

/** El backend es multi-tenant: el administrador del colegio solo ve su establecimiento. */
export function AdminColegiosPage() {
  const {user} = useSession();
  return <><PageHead title="Colegios" subtitle="Información del establecimiento asociado a tu sesión." />
    <div className={styles.grid}><Section title={user?.school?.name || 'Mi colegio'} subtitle="Establecimiento actual">
      <p>RBD: <strong>{user?.school?.rbd ?? '—'}</strong></p>
      <p className={styles.note}>Los datos de otros colegios no están disponibles para esta cuenta. El aislamiento entre establecimientos se mantiene activo.</p>
    </Section><Section title="Administración del colegio" subtitle="Accesos disponibles"><div className={styles.actions}><Action to="adm-usuarios">Usuarios</Action><Action to="adm-cursos">Cursos</Action><Action to="adm-evaluaciones">Evaluaciones</Action></div></Section></div>
  </>;
}
export function AdminColegioPage() { return <AdminColegiosPage />; }
export function AdminColegioNuevoPage() {
  return <><PageHead title="Agregar colegio" subtitle="Registro de establecimientos." /><Section title="Operación no disponible"><p>La API de esta versión no expone un endpoint para crear colegios. Este formulario no se puede habilitar sin un servicio administrativo seguro.</p></Section></>;
}

export function AdminUsuariosPage() {
  const [search, setSearch] = useState('');
  return <><PageHead title="Usuarios" subtitle="Estudiantes identificados mediante las matrículas de tus cursos." />
    <AdminData>{(grupos) => {
      const users = [...new Map(grupos.flatMap(({matriculas,curso}) => matriculas.map(e => [e.student_id || e.id,{...e, curso: curso.name, courseId:curso.id}]))).values()];
      const filtrados = users.filter(e => matches({name:e.name,email:e.email,course:e.curso},search));
      return <><div className={styles.kpis}><Kpi label="Estudiantes matriculados (únicos)" value={String(users.length)} /><Kpi label="Cursos visibles" value={String(grupos.length)} tone="success" /></div>
      <Section title="Usuarios registrados" subtitle="Listado parcial: estudiantes con matrícula en cursos del colegio.">
        <div className={styles.filters}><input type="search" placeholder="Buscar por nombre o correo..." aria-label="Buscar usuario" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        {!filtrados.length ? <EmptyState>No se encontraron estudiantes matriculados.</EmptyState> : <div className={styles.scroll} role="region" tabIndex={0} aria-label="Tabla de estudiantes"><table className={styles.table}><thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Curso</th><th>Acción</th></tr></thead><tbody>{filtrados.map(u=><tr key={u.student_id || u.id}><th scope="row">{u.name}</th><td>{u.email}</td><td><span className={styles.pill}>Estudiante</span></td><td>{u.curso}</td><td><PortalLink to="adm-usuario" param={u.student_id || u.id}>Ver</PortalLink></td></tr>)}</tbody></table></div>}
      </Section><p className={styles.note}>No existe un endpoint general de administración de usuarios en la API. Docentes, cuentas sin matrícula y estados de cuenta no se pueden consultar desde aquí.</p></>;
    }}</AdminData>
  </>;
}
export function AdminUsuarioPage({param}) {
  return <><PageHead title="Detalle de usuario" subtitle="Información disponible para consulta." /><AdminData>{(grupos)=>{
    const registros=grupos.flatMap(({curso,matriculas})=>matriculas.filter(u=>(u.student_id||u.id)===param).map(u=>({...u,curso:curso.name})));
    const user=registros[0];
    return <Section title={user?.name||'Usuario no encontrado'} action={<Action to="adm-usuarios">Volver a usuarios</Action>}>{user?<><p>Correo: {user.email}</p><p>Rol: Estudiante</p><p>Inscrito en: {registros.map(r=>r.curso).join(', ')}</p><p className={styles.note}>No hay endpoint de perfil académico del estudiante para el administrador.</p></>:<EmptyState>No existe una matrícula visible para este identificador.</EmptyState>}</Section>;
  }}</AdminData></>;
}
export function AdminUsuarioNuevoPage(){return <><PageHead title="Agregar usuario" subtitle="Registro de cuentas institucionales."/><Section title="Creación no disponible"><p>El backend todavía no implementa un endpoint seguro para crear usuarios. Mantuvimos el acceso a esta página sin incluir un formulario que no podría guardar datos.</p></Section></>;}

export function AdminCursosPage(){
  const [search,setSearch]=useState('');
  return <><PageHead title="Cursos" subtitle="Supervisa los cursos de tu colegio y su actividad académica." ><Action to="adm-curso-nuevo">+ Crear curso</Action></PageHead>
    <AdminData>{grupos=><><div className={styles.cards}>{grupos.slice(0,3).map(({curso,matriculas})=><div className={styles.mini} key={curso.id}><h3>{subject(curso)}</h3><p>{curso.name} · {matriculas.length} estudiantes</p><PortalLink to="adm-curso" param={curso.id}>Ver curso</PortalLink></div>)}</div>
      <Section title="Todos los cursos" subtitle="Listado de cursos del establecimiento."><div className={styles.filters}><input type="search" aria-label="Buscar curso" placeholder="Buscar curso..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className={styles.scroll} role="region" tabIndex={0} aria-label="Tabla de cursos"><table className={styles.table}><thead><tr><th>Curso</th><th>Asignatura</th><th>Período</th><th>Estudiantes</th><th>Acción</th></tr></thead><tbody>{grupos.filter(({curso})=>matches({name:curso.name,subject:curso.subject},search)).map(({curso,matriculas})=><tr key={curso.id}><th scope="row">{curso.name}</th><td>{subject(curso)}</td><td>{curso.period}</td><td>{matriculas.length}</td><td><PortalLink to="adm-curso" param={curso.id}>Ver curso</PortalLink></td></tr>)}</tbody></table></div></Section>
    </>}</AdminData></>;
}
/** Matrícula real: POST /courses/{id}/enrollments con clave idempotente. */
function AdminMatricular({courseId, onEnrolled}) {
  const {token,expire}=useSession();
  const key=useIdempotencyKey();
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState(null);
  async function submit(event){
    event.preventDefault();
    if(busy || !email.trim()) return;
    setBusy(true);setMessage(null);
    try {
      await enrollStudent(token,courseId,email.trim(),key.get());
      key.renew();setEmail('');onEnrolled();
      setMessage({kind:'ok',text:'Estudiante matriculado correctamente.'});
    }catch(err){
      if(err.status===401){expire();return;}
      if(err.status!==0) key.renew();
      setMessage({kind:'error',text:err.message||'No se pudo matricular.'});
    }finally{setBusy(false);}
  }
  return <form className={styles.enrollForm} onSubmit={submit} aria-busy={busy}>
    <label htmlFor="adm-enroll-email">Matricular por correo institucional</label>
    <div className={styles.inlineForm}>
      <input id="adm-enroll-email" type="email" required maxLength={150} autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)} placeholder="estudiante@colegio.cl" />
      <button type="submit" className={styles.action} disabled={busy}>{busy?'Matriculando…':'+ Matricular'}</button>
    </div>
    {message && <p role="status" className={message.kind==='error'?styles.error:styles.successMessage}>{message.text}</p>}
  </form>;
}

export function AdminCursoPage({param}){
  const curso=useApiData((token,opts)=>getCourse(token,param,opts),param);
  const matriculados=useApiData((token,opts)=>getEnrollments(token,param,opts),param);
  const evaluaciones=useApiData((token,opts)=>getAssessments(token,param,opts),param);
  return <><PageHead title="Detalle del curso" subtitle="Información y actividad académica." ><Action to="adm-cursos">Volver a cursos</Action></PageHead>
    <LoadState loading={curso.loading} error={curso.error} onRetry={curso.reload}><div className={styles.grid}><Section title={curso.data?.name||'Curso'}><p>Asignatura: {curso.data?.subject||'Sin especificar'}</p><p>Período: {curso.data?.period||'—'}</p><p>Nivel: {curso.data?.grade_level||'—'}</p></Section>
    <Section title="Acciones"><div className={styles.actions}><Action to="adm-evaluaciones">Ver evaluaciones</Action><Action to="adm-usuarios">Consultar estudiantes</Action><Action to="adm-cursos">Todos los cursos</Action></div><p className={styles.note}>La creación y edición de evaluaciones corresponde al docente. El administrador consulta sus estados y resultados.</p></Section>
    <Section title="Estudiantes inscritos"><AdminMatricular courseId={param} onEnrolled={matriculados.reload}/><LoadState loading={matriculados.loading} error={matriculados.error} onRetry={matriculados.reload}>{(matriculados.data?.data??[]).length ? <ul>{matriculados.data.data.map(s=><li key={s.id}>{s.name} · {s.email}</li>)}</ul>:<p>No hay estudiantes matriculados.</p>}</LoadState></Section>
    <Section title="Evaluaciones registradas"><LoadState loading={evaluaciones.loading} error={evaluaciones.error} onRetry={evaluaciones.reload}>{(evaluaciones.data?.data??[]).length ? <ul>{evaluaciones.data.data.map(e=><li key={e.id}><PortalLink to="adm-evaluacion" param={e.id}>{e.title}</PortalLink> · {status(e.status)}</li>)}</ul>:<p>No existen evaluaciones.</p>}</LoadState></Section></div></LoadState>
  </>;
}
export function AdminCursoNuevoPage(){
  const {token,expire}=useSession();const {navigate}=usePortalRoute();const key=useIdempotencyKey();
  const [form,setForm]=useState({name:'',period:'2026-S2',subject:'',grade_level:'',teacher_id:''});
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
    const data={...form,name:form.name.trim(),subject:form.subject.trim(),grade_level:form.grade_level.trim(),teacher_id:form.teacher_id.trim()};
    const curso=await createCourse(token,data,key.get());key.renew();navigate('adm-curso',curso.id);
  }catch(err){if(err.status===401){expire();return;}if(err.status!==0)key.renew();setError(err.message||'No se pudo crear el curso.');}finally{setBusy(false);}}
  return <><PageHead title="Agregar curso" subtitle="Registra un curso para el colegio de tu sesión."/><Section title="Datos del curso"><form className={styles.form} onSubmit={submit}>
    <label>Nombre del curso<input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required minLength={3} maxLength={120} placeholder="Ej. Matemática 2° Medio A"/></label>
    <label>Período<input value={form.period} onChange={e=>setForm(f=>({...f,period:e.target.value}))} required placeholder="2026-S2" pattern="[0-9]{4}-S[12]"/></label>
    <label>Asignatura<input value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} maxLength={80} placeholder="Matemática"/></label>
    <label>Nivel educativo<input value={form.grade_level} onChange={e=>setForm(f=>({...f,grade_level:e.target.value}))} maxLength={10} placeholder="2M"/></label>
    <label>ID del docente asignado (UUID)<input value={form.teacher_id} onChange={e=>setForm(f=>({...f,teacher_id:e.target.value}))} required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" placeholder="UUID del docente"/></label>
    <p className={styles.note}>La API requiere un identificador del docente. No existe todavía un selector de docentes en el backend.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button className={styles.action} type="submit" disabled={busy}>{busy?'Creando…':'Agregar curso'}</button><Action to="adm-cursos">Cancelar</Action></div>
  </form></Section></>;
}

export function AdminEvaluacionesPage(){
  const [search,setSearch]=useState('');return <><PageHead title="Evaluaciones" subtitle="Supervisa las evaluaciones de los cursos del establecimiento." />
    <AdminData>{grupos=>{const rows=grupos.flatMap(({curso,evaluaciones})=>evaluaciones.map(e=>({...e,curso:curso.name})));const pub=rows.filter(e=>e.status==='published'||e.status==='closed').length;
      return <><div className={styles.kpis}><Kpi label="Total evaluaciones" value={String(rows.length)}/><Kpi label="Publicadas o cerradas" value={String(pub)} tone="success"/><Kpi label="Borradores" value={String(rows.length-pub)} tone="warning"/></div>
      <Section title="Evaluaciones recientes" subtitle="Estado de evaluaciones registradas en tus cursos. Las nuevas evaluaciones se crean desde el portal docente."><div className={styles.filters}><input type="search" placeholder="Buscar evaluación..." aria-label="Buscar evaluación" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className={styles.scroll} role="region" tabIndex={0} aria-label="Tabla de evaluaciones"><table className={styles.table}><thead><tr><th>Evaluación</th><th>Curso</th><th>Estado</th><th>Entregas</th><th>Acción</th></tr></thead><tbody>{rows.filter(e=>matches({title:e.title,course:e.curso},search)).map(e=><tr key={e.id}><th scope="row">{e.title}</th><td>{e.curso}</td><td><span className={styles.pill}>{status(e.status)}</span></td><td>{num(e.submissions_count)}</td><td><PortalLink to="adm-evaluacion" param={e.id}>Ver</PortalLink></td></tr>)}</tbody></table></div></Section></>;
    }}</AdminData>
  </>;
}
export function AdminEvaluacionPage({param}){
  const ev=useApiData((token,opts)=>getAssessment(token,param,opts),param);
  return <><PageHead title="Detalle de evaluación" subtitle="Consulta informativa, sin edición de preguntas." ><Action to="adm-evaluaciones">Volver a evaluaciones</Action></PageHead>
    <LoadState loading={ev.loading} error={ev.error} onRetry={ev.reload}>{ev.data && <><Section title={ev.data.title}><p>Estado: <span className={styles.pill}>{status(ev.data.status)}</span></p><p>Fecha publicación: {readable(ev.data.published_at)}</p><p>Preguntas: {ev.data.questions?.length??'—'}</p></Section>{ev.data.status!=='draft'&&<ResultadosEvaluacion id={param}/>}</>}</LoadState></>;
}
function ResultadosEvaluacion({id}){
  const res=useApiData((token,opts)=>getAssessmentResults(token,id,opts),id);
  return <LoadState loading={res.loading} error={res.error} onRetry={res.reload}>{res.data&&<><div className={styles.kpis}><Kpi label="Participación (entregas)" value={num(res.data.submissions_count)}/><Kpi label="Promedio de logro" value={res.data.average_score==null?'—':`${res.data.average_score} %`} tone="success"/><Kpi label="Promedio calificación" value={num(res.data.average_grade)} tone="warning"/></div><Section title="Resultados por estudiante"><div className={styles.scroll} role="region" tabIndex={0} aria-label="Resultados de estudiantes"><table className={styles.table}><thead><tr><th>Estudiante</th><th>Nota</th><th>Logro</th><th>Entrega</th></tr></thead><tbody>{(res.data.students??[]).map(s=><tr key={s.student_id}><th scope="row">{s.name}</th><td>{num(s.grade)}</td><td>{num(s.score)} %</td><td>{readable(s.submitted_at)}</td></tr>)}</tbody></table></div></Section></>}</LoadState>;
}
export function AdminReportesPage(){
  return <><PageHead title="Reportes" subtitle="Resumen de actividad académica del colegio."/><AdminData>{grupos=>{
    const evs=grupos.flatMap(g=>g.evaluaciones);const matriculas=new Set(grupos.flatMap(g=>g.matriculas.map(s=>s.student_id||s.id)));
    return <><div className={styles.kpis}><Kpi label="Cursos" value={String(grupos.length)}/><Kpi label="Estudiantes matriculados" value={String(matriculas.size)} tone="success"/><Kpi label="Evaluaciones" value={String(evs.length)} tone="warning"/></div>
    <div className={styles.grid}><Section title="Reportes disponibles" subtitle="Consultas según los datos de la API."><div className={styles.cards}><div className={styles.mini}><h3>Rendimiento académico</h3><p>Evaluaciones y entregas de los cursos.</p><Action to="adm-reportes-rend">Consultar</Action></div><div className={styles.mini}><h3>Uso del Tutor IA</h3><p>Información de disponibilidad de métricas.</p><Action to="adm-reportes-tutor">Consultar</Action></div></div></Section><Section title="Actividad por curso"><div className={styles.scroll} role="region" tabIndex={0} aria-label="Actividad por curso"><table className={styles.table}><thead><tr><th>Curso</th><th>Evaluaciones</th><th>Entregas</th></tr></thead><tbody>{grupos.map(g=><tr key={g.curso.id}><th scope="row">{g.curso.name}</th><td>{g.evaluaciones.length}</td><td>{g.evaluaciones.reduce((n,e)=>n+(e.submissions_count??0),0)}</td></tr>)}</tbody></table></div></Section></div></>;
  }}</AdminData></>;
}
export function AdminRendimientoPage(){
  return <><PageHead title="Rendimiento académico" subtitle="Resumen de evaluaciones y entregas registradas."/><AdminData>{grupos=>{
    const ev=grupos.flatMap(g=>g.evaluaciones), tot=ev.reduce((n,e)=>n+(e.submissions_count??0),0);
    return <><div className={styles.kpis}><Kpi label="Evaluaciones" value={String(ev.length)}/><Kpi label="Entregas" value={String(tot)} tone="success"/><Kpi label="Cursos" value={String(grupos.length)} tone="warning"/></div><Section title="Evaluaciones por curso"><div className={styles.scroll} role="region" tabIndex={0} aria-label="Evaluaciones por curso"><table className={styles.table}><thead><tr><th>Curso</th><th>Evaluaciones</th><th>Entregas</th></tr></thead><tbody>{grupos.map(g=><tr key={g.curso.id}><th scope="row">{g.curso.name}</th><td>{g.evaluaciones.length}</td><td>{g.evaluaciones.reduce((n,e)=>n+(e.submissions_count??0),0)}</td></tr>)}</tbody></table></div></Section><p className={styles.note}>El promedio institucional, la asistencia y la cantidad de estudiantes en riesgo del diseño requieren endpoints adicionales.</p></>;
  }}</AdminData></>;
}
export function AdminTutorReportePage(){
  return <><PageHead title="Uso del Tutor IA" subtitle="Indicadores de actividad y calidad del asistente."/><Section title="Estadísticas no disponibles"><p>Esta versión de la API no expone métricas agregadas de consultas del Tutor IA. No se muestran porcentajes, consultas ni usuarios ficticios.</p><p className={styles.note}>Se necesita un endpoint autorizado y agregado por colegio para consultas, usuarios activos, resolución y distribución por asignatura.</p><div className={styles.actions}><Action to="adm-reportes">Volver a reportes</Action></div></Section></>;
}
