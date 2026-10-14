import { Icon } from '../../components/icons.jsx';
import { PortalLogo } from '../../components/PortalLogo/PortalLogo.jsx';
import { ROLES, ROLE_IDS } from '../../config/roles.js';
import { LOGIN_TEXTOS } from '../../data/mock.js';
import { usePreferences } from '../../preferences/usePreferences.js';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import styles from './LoginPage.module.css';

/** Acceso por rol. Por ahora solo navega al inicio del rol; la autenticación real se conectará a la API. */
export function LoginPage({ role }) {
  const { openPanel } = usePreferences();
  const { navigate } = usePortalRoute();
  const text = LOGIN_TEXTOS[role];

  function onSubmit(e) {
    e.preventDefault();
    navigate(ROLES[role].home); // TODO(auth): validar credenciales contra el backend antes de navegar
  }

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

      <form className={styles.box} onSubmit={onSubmit}>
        <h2>{text.titulo}</h2>
        <p className={styles.sub}>{text.detalle}</p>
        <label className={styles.field}>
          <span>Correo institucional</span>
          <input type="email" placeholder={text.ejemplo} autoComplete="username" />
        </label>
        <label className={styles.field}>
          <span>Contraseña</span>
          <input type="password" placeholder="Ingresa tu contraseña" autoComplete="current-password" />
        </label>
        <div className={styles.loginRow}>
          <label className={styles.remember}>
            <input type="checkbox" /> Recordar sesión
          </label>
          <a href={`#/portal/login-${role}`}>Olvidé mi contraseña</a>
        </div>
        <button type="submit" className={styles.submit}>
          Iniciar sesión
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
