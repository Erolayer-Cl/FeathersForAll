import { useEffect, useState } from 'react';
import { SHOW_DEV_TOOLS } from '../../config/devFlags.js';
import { DEMO_USER, ROLES, ROLE_IDS } from '../../config/roles.js';
import { Icon } from '../../components/icons.jsx';
import { PortalLogo } from '../../components/PortalLogo/PortalLogo.jsx';
import { usePreferences } from '../../preferences/usePreferences.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { useMediaQuery } from '../../router/useMediaQuery.js';
import styles from './PortalShell.module.css';

const COLLAPSED_KEY = 'fp:menu-collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Marco del portal: cabecera con logo + menú lateral que se minimiza (escritorio) o se abre
 * como cajón (celular). Cada pantalla solo aporta su contenido como `children`.
 * @param {{role: 'est'|'doc'|'adm', activeNav?: string, children: React.ReactNode}} props
 */
export function PortalShell({ role, activeNav, children }) {
  const cfg = ROLES[role];
  const user = DEMO_USER[role];
  const isMobile = useMediaQuery('(max-width: 860px)');
  const { resolvedTheme, setPref, openPanel } = usePreferences();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const menuClosed = isMobile ? !drawerOpen : collapsed;

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  }, [collapsed]);

  // Al cambiar de pantalla o presionar Escape, el cajón del celular se cierra.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggleMenu = () => (isMobile ? setDrawerOpen((v) => !v) : setCollapsed((v) => !v));
  const closeDrawer = () => setDrawerOpen(false);
  const items = [...cfg.nav, { key: 'config', label: 'Configuración', icon: 'sliders', route: cfg.config }];

  return (
    <div className={styles.app} data-collapsed={menuClosed} data-mobile={isMobile}>
      <div className={styles.backdrop} data-open={isMobile && drawerOpen} onClick={closeDrawer} aria-hidden="true" />

      <aside className={styles.sidebar} aria-label="Menú de navegación" inert={menuClosed}>
        <div className={styles.sbHead}>
          <button type="button" className={`${styles.iconBtn} ${styles.light}`} onClick={closeDrawer} aria-label="Cerrar menú">
            <Icon name="close" size={22} />
          </button>
          <span className={styles.sbTitle}>Menú</span>
        </div>
        <div className={styles.sbUser}>
          <span className={styles.sbAvatar} aria-hidden="true">{user.name[0]}</span>
          <div className={styles.sbUserText}>
            <b>{user.name}</b>
            <small>{user.detail}</small>
          </div>
        </div>
        <nav className={styles.nav} aria-label="Principal">
          {items.map((item, i) => (
            <PortalLink
              key={item.key}
              to={item.route}
              title={item.label}
              className={`${styles.navItem} ${item.key === activeNav ? styles.on : ''} ${i === items.length - 1 ? styles.last : ''}`}
              aria-current={item.key === activeNav ? 'page' : undefined}
              onClick={closeDrawer}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </PortalLink>
          ))}
        </nav>
      </aside>

      <div className={styles.stage}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={toggleMenu}
            aria-expanded={!menuClosed}
            aria-label={menuClosed ? 'Abrir menú' : 'Cerrar menú'}
          >
            <Icon name="menu" size={22} />
          </button>
          <PortalLogo size={48} className={styles.topLogo} />
          <div className={styles.brand}>
            <span className={styles.brandName}>FeathersForAll.</span>
            <span className={styles.modeLabel}>{cfg.modeLabel}</span>
          </div>
          <div className={styles.spacer} />
          {SHOW_DEV_TOOLS && (
            <div className={styles.roleSwitch} role="group" aria-label="Cambiar de rol (solo pruebas)" title="Solo para pruebas">
              {ROLE_IDS.map((id) => (
                <PortalLink
                  key={id}
                  to={ROLES[id].home}
                  className={`${styles.role} ${id === role ? styles.roleOn : ''}`}
                  aria-current={id === role ? 'true' : undefined}
                >
                  {id === 'adm' ? 'Admin' : ROLES[id].label}
                </PortalLink>
              ))}
            </div>
          )}
          <div className={styles.tools}>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.themeBtn}`}
              onClick={() => setPref('theme', resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label={resolvedTheme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            >
              <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={22} />
            </button>
            <button type="button" className={styles.iconBtn} onClick={openPanel} aria-label="Personalizar la interfaz">
              <Icon name="palette" size={22} />
            </button>
          </div>
        </header>
        <main className={styles.content}>
          <div className={styles.wrap}>{children}</div>
        </main>
      </div>
    </div>
  );
}
