import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { PortalLogo } from '../../components/PortalLogo/PortalLogo.jsx';
import { ROLES } from '../../config/roles.js';
import { usePreferences } from '../../preferences/usePreferences.js';
import { RoleMismatchError, loadLastRbd } from '../../session/session.js';
import { useSession } from '../../session/useSession.js';
import { LOGIN_TABS, LOGIN_TEXTOS } from './textos.js';
import styles from './LoginPage.module.css';

const TAB_ICON = { est: 'book', doc: 'users', adm: 'school' };
/** Las tres cuentas como pastillas bajo el formulario (diseño Figma). LOGIN_TABS sigue siendo solo est/doc. */
const PILLS = [...LOGIN_TABS, 'adm'];
const LOGIN_ROLE = { 'login-est': 'est', 'login-doc': 'doc', 'login-adm': 'adm' };

/**
 * Un mismo componente para las tres rutas de acceso (pages/index.jsx): al cambiar de pestaña React lo conserva
 * y no se pierde lo escrito (RBD, correo, contraseña).
 */
export function LoginRoute({ route }) {
  return <LoginPage role={LOGIN_ROLE[route.id]} />;
}

/** Mensaje para la persona según el error de la API (el detalle técnico queda en el problema RFC 7807). */
function mensajeDeError(error) {
  if (error.status === 401) return 'El RBD, el correo o la contraseña no son correctos.';
  if (error.status === 429) return error.message; // "Espera N min antes de volver a intentar"
  if (error.status === 0) return error.message;   // sin conexión con el servidor
  return 'No pudimos iniciar sesión. Inténtalo de nuevo en unos minutos.';
}

/**
 * Acceso por rol: RBD del colegio + correo + contraseña (POST /v1/auth/login).
 * Arriba se elige el tipo de cuenta (Estudiante o Docente); la administración entra por un enlace aparte.
 * Si la cuenta es de otro rol, no se entra: se avisa y se ofrece cambiar de pestaña (sin perder lo escrito,
 * porque las tres rutas de acceso usan este mismo componente; ver pages/index.jsx).
 * El RBD no está en el prototipo: hace falta porque un mismo correo puede existir en dos colegios.
 * En producción vendría del subdominio del colegio; aquí se recuerda el último usado.
 * Tras entrar, la guardia de rutas (PortalFrame) lleva a cada rol a su inicio.
 */
export function LoginPage({ role }) {
  const { openPanel } = usePreferences();
  const { signIn, notice } = useSession();
  const text = LOGIN_TEXTOS[role];

  const [form, setForm] = useState(() => ({ rbd: loadLastRbd(), email: '', password: '', remember: false }));
  // Resultado del último intento, atado a la pestaña donde ocurrió: al cambiar de pestaña deja de mostrarse.
  // { role, error } = mensaje de error; { role, mismatch } = la cuenta es de otro rol ('none' = sin portal).
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const passwordRef = useRef(null);
  const current = feedback?.role === role ? feedback : null;
  const error = current?.error ?? null;
  const mismatch = current?.mismatch ?? null;

  const change = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return; // el botón sigue habilitado (aria-disabled) para no perder el foco mientras envía
    setFeedback(null);
    setSending(true);
    try {
      await signIn(form, { expectedRole: role });
    } catch (err) {
      if (err instanceof RoleMismatchError) {
        // Las credenciales son correctas: se conserva la contraseña para entrar con un clic desde la otra pestaña.
        setFeedback({ role, mismatch: err.actual ?? 'none', at: Date.now() });
        return;
      }
      setFeedback({ role, error: mensajeDeError(err) });
      setForm((f) => ({ ...f, password: '' }));
      passwordRef.current?.focus(); // quien usa teclado sigue donde estaba: en la contraseña, ahora vacía
    } finally {
      setSending(false);
    }
  }

  const aviso = error ?? (mismatch ? null : notice);

  /** Clic en un enlace de la pantalla de acceso: mientras se envía no navega; si navega, el aviso anterior se va. */
  const alNavegar = (e) => {
    if (sending) {
      e.preventDefault();
      return;
    }
    setFeedback(null);
  };

  return (
    <div className={styles.login}>
      <div className={styles.art} aria-hidden="true" />
      <button type="button" className={styles.palette} onClick={openPanel} aria-label="Personalizar la interfaz">
        <Icon name="palette" size={22} />
      </button>

      <div className={styles.col}>
        <PortalLogo size={96} className={styles.logo} />
        <h1 className={styles.brand}>FeathersForAll</h1>

        <form className={styles.box} onSubmit={onSubmit} aria-busy={sending}>
          <h2>{text.titulo}</h2>
          <p className={styles.sub}>{text.detalle}</p>

          {aviso && (
            <p className={error ? styles.error : styles.notice} role="alert">
              {aviso}
            </p>
          )}
          {mismatch && <AvisoOtroRol key={current.at} actual={mismatch} onNavigate={alNavegar} />}

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
              {text.ayudaRbd}
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
            <div className={styles.pw}>
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                placeholder="Ingresa tu contraseña"
                autoComplete="current-password"
                ref={passwordRef}
                required
                maxLength={256}
                value={form.password}
                onChange={change('password')}
              />
              <button
                type="button"
                className={styles.eye}
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPw}
              >
                <Icon name={showPw ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
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
        </form>

        <nav className={styles.pills} aria-label="Tipo de cuenta">
          {PILLS.map((id) => (
            <a
              key={id}
              href={`#/portal/${ROLES[id].login}`}
              className={id === role ? styles.pillOn : styles.pill}
              aria-current={id === role ? 'page' : undefined}
              // Mientras se inicia sesión no se cambia de pestaña: el resultado (o el aviso) es de la pestaña enviada.
              aria-disabled={sending || undefined}
              onClick={alNavegar}
            >
              <Icon name={TAB_ICON[id]} size={16} />
              {ROLES[id].label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

/**
 * La cuenta es de otro rol: dice cuál y ofrece ir a su pestaña (o explica que no tiene portal).
 * El foco pasa a «Cambiar a …»: con teclado, el siguiente Enter lleva a la pestaña correcta.
 */
function AvisoOtroRol({ actual, onNavigate }) {
  const linkRef = useRef(null);
  useEffect(() => {
    linkRef.current?.focus();
  }, []);
  if (actual === 'none') {
    return (
      <p className={styles.error} role="alert">
        Esta cuenta no tiene acceso al portal. Consulta con la administración de tu colegio.
      </p>
    );
  }
  const destino = ROLES[actual];
  return (
    <div className={styles.error} role="alert">
      <p>
        Esta cuenta es de {destino.label.toLowerCase()}. Para entrar, cambia a «{destino.label}» y vuelve a presionar
        Iniciar sesión.
      </p>
      <a ref={linkRef} className={styles.switch} href={`#/portal/${destino.login}`} onClick={onNavigate}>
        Cambiar a {destino.label}
      </a>
    </div>
  );
}
