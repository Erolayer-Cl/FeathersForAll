import { useEffect, useRef } from 'react';
import { SHOW_DEV_TOOLS } from '../config/devFlags.js';
import { DevPageJumper } from '../dev/DevPageJumper.jsx';
import { PAGES } from '../pages/index.jsx';
import { PlaceholderPage } from '../pages/shared/PlaceholderPage.jsx';
import { PreferencesPanel } from '../preferences/PreferencesPanel/PreferencesPanel.jsx';
import { getRootAttributes, getRootStyle } from '../preferences/preferences.js';
import { usePreferences } from '../preferences/usePreferences.js';
import { redirectFor } from '../router/access.js';
import { usePortalRoute } from '../router/usePortalRoute.js';
import { useSession } from '../session/useSession.js';
import { PortalShell } from './PortalShell/PortalShell.jsx';

/**
 * Raíz visual del portal: aplica las preferencias, protege las rutas y decide qué pantalla mostrar.
 * Guardia: las pantallas de un rol exigen una sesión de ese rol (ver router/access.js).
 */
export function PortalFrame() {
  const { prefs, resolvedTheme } = usePreferences();
  const { route, param, navigate } = usePortalRoute();
  const { portalRole } = useSession();
  const redirect = redirectFor(route, portalRole);
  const Page = PAGES[route.id];

  useEffect(() => {
    document.title = `${route.title} · FeathersForAll`;
  }, [route.title]);

  // Al navegar (no en la primera carga) el foco pasa al contenido: así el lector de pantalla
  // anuncia la pantalla nueva y Tab sigue desde ahí, no desde el enlace del menú.
  const primeraCarga = useRef(true);
  useEffect(() => {
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    document.getElementById('fp-main')?.focus({ preventScroll: true });
  }, [route.id, param]);

  // Depende también de la ruta: al pasar de una pantalla protegida a otra el destino no cambia
  // (sigue siendo el login), pero hay que volver a redirigir.
  useEffect(() => {
    if (redirect) navigate(redirect, undefined, { replace: true });
  }, [redirect, route.id, navigate]);

  let page = null; // mientras redirige no se muestra nada (ni un instante de datos ajenos)
  if (!redirect) page = Page ? <Page route={route} param={param} /> : <PlaceholderPage route={route} param={param} />;

  return (
    <div className="fp-root" {...getRootAttributes(prefs, resolvedTheme)} style={getRootStyle(prefs, resolvedTheme)}>
      {route.role && !redirect ? (
        <PortalShell role={route.role} activeNav={route.nav}>
          {page}
        </PortalShell>
      ) : (
        page
      )}
      <p className="fp-sr-only" aria-live="polite">
        {route.title}
      </p>
      <PreferencesPanel />
      {SHOW_DEV_TOOLS && <DevPageJumper />}
    </div>
  );
}
