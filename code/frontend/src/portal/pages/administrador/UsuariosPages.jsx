import { useState } from 'react';
import {
  addUserWard, createUser, getAuditLog, getUser, getUsers, removeUserWard, resetUserPassword, updateUser,
} from '../../../api/portalApi.js';
import { EmptyState, FormMessage, Kpi, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { ACCION_LABEL, MIN_CLAVE, ROL_LABEL, fechaHora, generarClave, problemaClaveInicial } from '../../utils/usuarios.js';
import styles from './Management.module.css';

// Gestión de usuarios del administrador (contrato v1.12, ADR 0017): cuentas reales del colegio de la sesión.

function Section({ title, subtitle, children, action }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
      {children}
    </section>
  );
}

function Estado({ activo }) {
  return <span className={styles.pill} data-tone={activo ? 'ok' : 'off'}>{activo ? 'Activa' : 'Desactivada'}</span>;
}

/** Campo de contraseña inicial con «Generar» y la clave visible para copiarla y entregarla. */
function CampoClave({ id, value, onChange }) {
  return (
    <label htmlFor={id}>
      Contraseña inicial
      <div className={styles.inlineForm}>
        <input id={id} type="text" autoComplete="new-password" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} minLength={MIN_CLAVE} maxLength={256} required />
        <button type="button" className={styles.action} onClick={() => onChange(generarClave())}>Generar</button>
      </div>
      <small className={styles.note}>Entrégala a la persona por un canal seguro: no se vuelve a mostrar ni queda guardada en texto.</small>
    </label>
  );
}

// ---------------------------------------------------------------------------------- lista

export function AdminUsuariosPage() {
  const [filtro, setFiltro] = useState({ q: '', role: '', active: '' });
  const consulta = { q: filtro.q.trim() || undefined, role: filtro.role || undefined, active: filtro.active === '' ? undefined : filtro.active === 'true' };
  const clave = JSON.stringify(consulta);
  const { data, loading, error, reload } = useApiData((t, opts) => getUsers(t, consulta, opts), clave);
  const todos = useApiData((t, opts) => getUsers(t, {}, opts), 'todos');
  const lista = data ?? [];
  const conteo = (rol) => (todos.data ?? []).filter((u) => u.role === rol && u.active).length;

  return (
    <>
      <PageHead title="Usuarios" subtitle="Cuentas de docentes, estudiantes y administradores de tu colegio.">
        <PortalLink className={styles.action} to="adm-usuario-nuevo">+ Agregar usuario</PortalLink>
      </PageHead>
      <div className={styles.kpis}>
        <Kpi label="Docentes activos" value={todos.data ? String(conteo('docente')) : '—'} />
        <Kpi label="Estudiantes activos" value={todos.data ? String(conteo('estudiante')) : '—'} tone="success" />
        <Kpi label="Cuentas desactivadas" value={todos.data ? String(todos.data.filter((u) => !u.active).length) : '—'} tone="warning" />
      </div>
      <Section title="Cuentas del colegio" subtitle="Busca por nombre o correo, o filtra por rol y estado." action={<PortalLink className={styles.link} to="adm-auditoria">Ver bitácora →</PortalLink>}>
        <div className={styles.filters}>
          <input type="search" placeholder="Buscar por nombre o correo…" aria-label="Buscar usuario" maxLength={100} value={filtro.q} onChange={(e) => setFiltro((f) => ({ ...f, q: e.target.value }))} />
          <select aria-label="Filtrar por rol" value={filtro.role} onChange={(e) => setFiltro((f) => ({ ...f, role: e.target.value }))}>
            <option value="">Todos los roles</option>
            <option value="docente">Docentes</option>
            <option value="estudiante">Estudiantes</option>
            <option value="admin_colegio">Administradores</option>
            <option value="apoderado">Apoderados</option>
          </select>
          <select aria-label="Filtrar por estado" value={filtro.active} onChange={(e) => setFiltro((f) => ({ ...f, active: e.target.value }))}>
            <option value="">Activas y desactivadas</option>
            <option value="true">Solo activas</option>
            <option value="false">Solo desactivadas</option>
          </select>
        </div>
        <LoadState loading={loading} error={error} onRetry={reload}>
          {!lista.length ? <EmptyState>No hay cuentas que coincidan con la búsqueda.</EmptyState> : (
            <div className={styles.scroll} role="region" tabIndex={0} aria-label="Tabla de usuarios">
              <table className={styles.table}>
                <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead>
                <tbody>
                  {lista.map((u) => (
                    <tr key={u.id}>
                      <th scope="row">{u.name}</th>
                      <td>{u.email}</td>
                      <td>{ROL_LABEL[u.role] ?? u.role}</td>
                      <td><Estado activo={u.active} /></td>
                      <td><PortalLink to="adm-usuario" param={u.id}>Gestionar</PortalLink></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------- alta

export function AdminUsuarioNuevoPage() {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const key = useIdempotencyKey();
  const [form, setForm] = useState({ name: '', email: '', role: 'estudiante', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (campo) => (v) => setForm((f) => ({ ...f, [campo]: typeof v === 'string' ? v : v.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problema = form.name.trim().length < 3 ? 'El nombre debe tener al menos 3 caracteres.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? 'Escribe un correo válido (nombre@colegio.cl).'
        : problemaClaveInicial(form.password, form.email);
    if (problema) {
      setError(problema);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const creada = await createUser(token, { ...form, name: form.name.trim(), email: form.email.trim() }, key.get());
      key.renew();
      navigate('adm-usuario', creada.id);
    } catch (err) {
      if (err.status === 401) { expire(); return; }
      if (err.status !== 0) key.renew();
      setError(err.status === 409 ? 'Ya existe una cuenta con ese correo en tu colegio.' : err.message || 'No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Agregar usuario" subtitle="Crea la cuenta de un docente, un estudiante u otro administrador de tu colegio." />
      <Section title="Datos de la cuenta">
        <form className={styles.form} onSubmit={submit} aria-busy={busy} noValidate>
          <label>Nombre completo<input value={form.name} onChange={set('name')} required minLength={3} maxLength={150} autoComplete="off" placeholder="Ej. Rosa Vidal" /></label>
          <label>Correo institucional<input type="email" value={form.email} onChange={set('email')} required maxLength={150} autoComplete="off" placeholder="nombre@colegio.cl" /></label>
          <label>Rol
            <select value={form.role} onChange={set('role')}>
              <option value="estudiante">Estudiante</option>
              <option value="docente">Docente</option>
              <option value="admin_colegio">Administrador</option>
              <option value="apoderado">Apoderado</option>
            </select>
          </label>
          <CampoClave id="adm-nueva-clave" value={form.password} onChange={set('password')} />
          <p className={styles.note}>El rol no se puede cambiar después: si alguien cambia de rol, se le crea otra cuenta. Solo usa datos sintéticos en ambientes de prueba.</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button className={styles.action} type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear cuenta'}</button>
            <PortalLink className={styles.link} to="adm-usuarios">Cancelar</PortalLink>
          </div>
        </form>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------- detalle

function EditarDatos({ usuario, onSaved }) {
  const { token, expire } = useSession();
  const [form, setForm] = useState({ name: usuario.name, email: usuario.email });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const cambios = {};
  if (form.name.trim() !== usuario.name) cambios.name = form.name.trim();
  if (form.email.trim().toLowerCase() !== usuario.email.toLowerCase()) cambios.email = form.email.trim();

  async function submit(e) {
    e.preventDefault();
    if (busy || !Object.keys(cambios).length) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateUser(token, usuario.id, cambios);
      setMsg({ tone: 'success', text: 'Datos guardados.' });
      onSaved();
    } catch (err) {
      if (err.status === 401) { expire(); return; }
      setMsg({ tone: 'error', text: err.status === 409 ? 'Ese correo ya lo usa otra cuenta del colegio.' : err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={busy}>
      <label>Nombre<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} minLength={3} maxLength={150} required /></label>
      <label>Correo<input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} maxLength={150} required /></label>
      {msg && <FormMessage tone={msg.tone}>{msg.text}</FormMessage>}
      <div className={styles.actions}><button className={styles.action} type="submit" disabled={busy || !Object.keys(cambios).length}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  );
}

function RestablecerClave({ usuario }) {
  const { token, expire } = useSession();
  const [clave, setClave] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problema = problemaClaveInicial(clave, usuario.email);
    if (problema) { setMsg({ tone: 'error', text: problema }); return; }
    if (!window.confirm(`¿Restablecer la contraseña de ${usuario.name}? Se cerrarán sus sesiones abiertas.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await resetUserPassword(token, usuario.id, clave);
      setMsg({ tone: 'success', text: 'Contraseña restablecida. Entrégasela por un canal seguro: sus sesiones abiertas ya se cerraron.' });
    } catch (err) {
      if (err.status === 401) { expire(); return; }
      setMsg({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={busy} noValidate>
      <CampoClave id="adm-reset-clave" value={clave} onChange={setClave} />
      {msg && <FormMessage tone={msg.tone}>{msg.text}</FormMessage>}
      <div className={styles.actions}><button className={styles.action} type="submit" disabled={busy}>{busy ? 'Restableciendo…' : 'Restablecer contraseña'}</button></div>
    </form>
  );
}

/** Pupilos de un apoderado (MVP 5): el admin los vincula por correo y los puede quitar. */
function Pupilos({ usuario, onSaved }) {
  const { token, expire } = useSession();
  const key = useIdempotencyKey();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function vincular(e) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await addUserWard(token, usuario.id, email.trim(), key.get());
      key.renew();
      setEmail('');
      onSaved();
    } catch (err) {
      if (err.status === 401) { expire(); return; }
      if (err.status !== 0) key.renew();
      setMsg(err.status === 404 ? 'No hay un estudiante activo con ese correo en tu colegio.' : err.status === 409 ? 'Ese estudiante ya está vinculado.' : err.message);
    } finally {
      setBusy(false);
    }
  }
  async function quitar(w) {
    if (!window.confirm(`¿Desvincular a ${w.name}? ${usuario.name} dejará de ver su avance.`)) return;
    try {
      await removeUserWard(token, usuario.id, w.student_id);
      onSaved();
    } catch (err) {
      if (err.status === 401) expire();
      else setMsg(err.message);
    }
  }
  return (
    <div className={styles.form}>
      {usuario.wards?.length ? (
        <ul className={styles.lista}>
          {usuario.wards.map((w) => (
            <li key={w.student_id}>
              {w.name} · {w.email}{w.active === false ? ' (cuenta desactivada)' : ''}{' '}
              <button type="button" className={styles.link} onClick={() => quitar(w)} aria-label={`Desvincular a ${w.name}`}>Desvincular</button>
            </li>
          ))}
        </ul>
      ) : <p className={styles.note}>Todavía no tiene pupilos vinculados: no verá nada en su panel.</p>}
      <form className={styles.enrollForm} onSubmit={vincular} aria-busy={busy} noValidate>
        <label htmlFor="adm-pupilo-email">Vincular un estudiante por su correo</label>
        <div className={styles.inlineForm}>
          <input id="adm-pupilo-email" type="email" maxLength={150} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="estudiante@colegio.cl" />
          <button type="submit" className={styles.action} disabled={busy}>{busy ? 'Vinculando…' : '+ Vincular'}</button>
        </div>
      </form>
      {msg && <FormMessage>{msg}</FormMessage>}
    </div>
  );
}

function CambiarEstado({ usuario, onSaved }) {
  const { token, expire } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function cambiar() {
    const desactivar = usuario.active;
    const aviso = desactivar
      ? `¿Desactivar la cuenta de ${usuario.name}? No podrá entrar y sus sesiones abiertas se cerrarán. Sus notas y cursos se conservan.`
      : `¿Reactivar la cuenta de ${usuario.name}? Podrá volver a entrar con su contraseña.`;
    if (busy || !window.confirm(aviso)) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateUser(token, usuario.id, { active: !desactivar });
      onSaved();
    } catch (err) {
      if (err.status === 401) { expire(); return; }
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.form}>
      <p className={styles.note}>{usuario.active ? 'La cuenta está activa.' : 'La cuenta está desactivada: no puede iniciar sesión.'}</p>
      {msg && <FormMessage>{msg}</FormMessage>}
      <div className={styles.actions}>
        <button type="button" className={styles.action} data-tone={usuario.active ? 'danger' : undefined} onClick={cambiar} disabled={busy}>
          {busy ? 'Guardando…' : usuario.active ? 'Desactivar cuenta' : 'Reactivar cuenta'}
        </button>
      </div>
    </div>
  );
}

export function AdminUsuarioPage({ param }) {
  const { user } = useSession();
  const { data: u, loading, error, reload } = useApiData((t, opts) => getUser(t, param, opts), param);
  const propia = u?.id === user?.id;
  return (
    <>
      <PageHead title="Gestionar usuario" subtitle="Datos, estado y contraseña de la cuenta.">
        <PortalLink className={styles.link} to="adm-usuarios">← Volver a usuarios</PortalLink>
      </PageHead>
      <LoadState loading={loading} error={error} onRetry={reload} notFound={{ title: 'Cuenta no encontrada' }}>
        {u && (
          <div className={styles.grid}>
            <Section title={u.name} subtitle={`${ROL_LABEL[u.role] ?? u.role} · creada ${fechaHora(u.created_at)}`} action={<Estado activo={u.active} />}>
              <EditarDatos key={`${u.name}|${u.email}`} usuario={u} onSaved={reload} />
            </Section>
            {u.role === 'apoderado' ? (
              <Section title="Pupilos" subtitle="Estudiantes cuyo avance puede ver (solo lectura).">
                <Pupilos usuario={u} onSaved={reload} />
              </Section>
            ) : (
            <Section title={u.role === 'docente' ? 'Cursos que dicta' : u.role === 'estudiante' ? 'Cursos en que está matriculado' : 'Cursos'}>
              {u.courses.length ? (
                <ul className={styles.lista}>
                  {u.courses.map((c) => <li key={`${c.id}|${c.relation}`}><PortalLink to="adm-curso" param={c.id}>{c.name}</PortalLink> · {c.period}</li>)}
                </ul>
              ) : <p className={styles.note}>{u.role === 'admin_colegio' ? 'Los administradores no dictan cursos.' : 'Todavía no tiene cursos.'}</p>}
            </Section>
            )}
            <Section title="Estado de la cuenta">
              {propia ? <p className={styles.note}>No puedes desactivar tu propia cuenta: pídeselo a otro administrador.</p> : <CambiarEstado usuario={u} onSaved={reload} />}
            </Section>
            <Section title="Contraseña">
              {propia
                ? <p className={styles.note}>Tu contraseña la cambias en <PortalLink to="adm-config">Configuración</PortalLink> (te pide la actual).</p>
                : <RestablecerClave usuario={u} />}
            </Section>
          </div>
        )}
      </LoadState>
    </>
  );
}

// ---------------------------------------------------------------------------------- bitácora

export function AdminAuditoriaPage() {
  const [cursor, setCursor] = useState(null);
  const [anteriores, setAnteriores] = useState([]);
  const { data, loading, error, reload } = useApiData((t, opts) => getAuditLog(t, { cursor }, opts), cursor ?? 'inicio');
  const filas = [...anteriores, ...(data?.data ?? [])];
  const masAntiguas = () => {
    setAnteriores(filas);
    setCursor(data.next_cursor);
  };
  return (
    <>
      <PageHead title="Bitácora" subtitle="Quién creó, editó, desactivó o restableció cuentas en tu colegio. No se puede editar ni borrar." />
      <Section title="Actividad reciente">
        <LoadState loading={loading && !anteriores.length} error={error} onRetry={reload}>
          {!filas.length ? <EmptyState>Todavía no hay acciones registradas.</EmptyState> : (
            <div className={styles.scroll} role="region" tabIndex={0} aria-label="Bitácora de acciones">
              <table className={styles.table}>
                <thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Cuenta</th></tr></thead>
                <tbody>
                  {filas.map((a) => (
                    <tr key={a.id}>
                      <td>{fechaHora(a.created_at)}</td>
                      <th scope="row">{a.actor.name} <small className={styles.note}>({ROL_LABEL[a.actor.role] ?? a.actor.role})</small></th>
                      <td>{ACCION_LABEL[a.action] ?? a.action}{a.details?.rol ? ` · ${ROL_LABEL[a.details.rol] ?? a.details.rol}` : ''}</td>
                      <td>{a.resource_id ? <PortalLink to="adm-usuario" param={a.resource_id}>Ver cuenta</PortalLink> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data?.next_cursor && <div className={styles.actions}><button type="button" className={styles.action} onClick={masAntiguas} disabled={loading}>Ver más antiguas</button></div>}
        </LoadState>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------- selector de docente

/** Selector del docente que dicta un curso (lo usa «Agregar curso» del admin): solo docentes activos. */
export function SelectorDocente({ value, onChange, id = 'adm-curso-docente' }) {
  const { data, loading, error, reload } = useApiData((t, opts) => getUsers(t, { role: 'docente', active: true }, opts), 'docentes');
  return (
    <label htmlFor={id}>
      Docente que dicta el curso
      <LoadState loading={loading} error={error} onRetry={reload}>
        {data && (data.length ? (
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
            <option value="">Elige un docente…</option>
            {data.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.email}</option>)}
          </select>
        ) : <p className={styles.note}>No hay docentes activos: <PortalLink to="adm-usuario-nuevo">crea uno</PortalLink> primero.</p>)}
      </LoadState>
    </label>
  );
}
