import { useRef, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { PortalLogo } from '../../components/PortalLogo/PortalLogo.jsx';
import { ROLES, ROLE_IDS } from '../../config/roles.js';
import { usePreferences } from '../../preferences/usePreferences.js';
import { loadLastRbd } from '../../session/session.js';
import { useSession } from '../../session/useSession.js';
import { LOGIN_TEXTOS } from './textos.js';
import styles from './LoginPage.module.css';

/** Mensaje para la persona según el error de la API (el detalle técnico queda en el problema RFC 7807). */
function mensajeDeError(error) {
  if (error.status === 401) return 'El RBD, el correo o la contraseña no son correctos.';
  if (error.status === 429) return error.message; // "Espera N min antes de volver a intentar"
  if (error.status === 0) return error.message;   // sin conexión con el servidor
  return 'No pudimos iniciar sesión. Inténtalo de nuevo en unos minutos.';
}

/**
 * Acceso por rol: RBD del colegio + correo + contraseña (POST /v1/auth/login).
 * El RBD no está en el prototipo: hace falta porque un mismo correo puede existir en dos colegios.
 * En producción vendría del subdominio del colegio; aquí se recuerda el último usado.
 * Tras entrar, la guardia de rutas (PortalFrame) lleva a cada rol a su inicio.
 */
export function LoginPage({ role }) {
  const { openPanel } = usePreferences();
  const { signIn, notice } = useSession();
  const text = LOGIN_TEXTOS[role];

  const [form, setForm] = useState(() => ({ rbd: loadLastRbd(), email: '', password: '', remember: false }));
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const passwordRef = useRef(null);

  const change = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return; // el botón sigue habilitado (aria-disabled) para no perder el foco mientras envía
    setError(null);
    setSending(true);
    try {
      await signIn(form);
    } catch (err) {
      setError(mensajeDeError(err));
      setForm((f) => ({ ...f, password: '' }));
      passwordRef.current?.focus(); // quien usa teclado sigue donde estaba: en la contraseña, ahora vacía
    } finally {
      setSending(false);
    }
  }

  const aviso = error ?? notice;

  return (
    <div className={styles.login}>
      <button type="button" className={styles.palette} onClick={openPanel} aria-label="Personalizar la interfaz">
        <Icon name="palette" size={22} />
      </button>
      <header className={styles.hero}>
        <PortalLogo size={92} className={styles.logo} />
        <h1>FeathersForAll</h1>
        <h2>Impulsa el aprendizaje con inteligencia artificial</h2>
        <p>Una plataforma educativa inteligente para estudiantes, docentes y colegios.</p>
      </header>

      <form className={styles.box} onSubmit={onSubmit} aria-busy={sending}>
        <h2>{text.titulo}</h2>
        <p className={styles.sub}>{text.detalle}</p>

        {aviso && (
          <p className={error ? styles.error : styles.notice} role="alert">
            {aviso}
          </p>
        )}

        <label className={styles.field}>
          <span>Colegio (RBD)</span>
          <input
            name="rbd"
            inputMode="numeric"
            placeholder="Ej.: 99901"
            autoComplete="off"
            required
            maxLength={20}
            value={form.rbd}
            onChange={change('rbd')}
            aria-describedby="fp-rbd-ayuda"
          />
          <small id="fp-rbd-ayuda" className={styles.help}>
            El código de tu colegio. Si no lo sabes, pídeselo a tu profesor jefe.
          </small>
        </label>
        <label className={styles.field}>
          <span>Correo institucional</span>
          <input
            name="email"
            type="email"
            placeholder={text.ejemplo}
            autoComplete="username"
            required
            maxLength={150}
            value={form.email}
            onChange={change('email')}
          />
        </label>
        <label className={styles.field}>
          <span>Contraseña</span>
          <input
            name="password"
            type="password"
            placeholder="Ingresa tu contraseña"
            autoComplete="current-password"
            ref={passwordRef}
            required
            maxLength={256}
            value={form.password}
            onChange={change('password')}
          />
        </label>
        <div className={styles.loginRow}>
          <label className={styles.remember}>
            <input type="checkbox" checked={form.remember} onChange={change('remember')} /> Recordar sesión
          </label>
          {/* Todavía no hay flujo de recuperación: se orienta en vez de mostrar un enlace que no hace nada. */}
          <span className={styles.forgot}>¿Olvidaste tu contraseña? Pide a tu colegio que la restablezca.</span>
        </div>
        <button type="submit" className={styles.submit} aria-disabled={sending}>
          {sending ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
        <div className={styles.roles}>
          {ROLE_IDS.map((id) => (
            <a key={id} href={`#/portal/${ROLES[id].login}`} className={id === role ? styles.roleOn : ''}>
              {ROLES[id].label}
            </a>
          ))}
        </div>
      </form>
    </div>
  );
}
