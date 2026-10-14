import { useState } from 'react';
import { PORTAL_ROUTES } from '../config/routes.js';
import { routeHref, usePortalRoute } from '../router/usePortalRoute.js';
import styles from './DevPageJumper.module.css';

const GROUPS = [...new Set(PORTAL_ROUTES.map((r) => r.group))];

/** SOLO PRUEBAS: botón flotante para saltar a cualquier pantalla. Se muestra con SHOW_DEV_TOOLS (config/devFlags.js). */
export function DevPageJumper() {
  const [open, setOpen] = useState(false);
  const { route } = usePortalRoute();

  return (
    <div className={styles.wrap}>
      {open && (
        <nav className={styles.panel} aria-label="Pantallas (solo pruebas)">
          {GROUPS.map((g) => (
            <div key={g}>
              <h4>{g}</h4>
              {PORTAL_ROUTES.filter((r) => r.group === g).map((r) => (
                <a key={r.id} href={routeHref(r.id)} aria-current={r.id === route.id ? 'page' : undefined} onClick={() => setOpen(false)}>
                  {r.title}
                </a>
              ))}
            </div>
          ))}
        </nav>
      )}
      <button type="button" className={styles.button} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Pantallas
      </button>
    </div>
  );
}
