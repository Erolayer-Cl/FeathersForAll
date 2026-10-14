import { useEffect } from 'react';
import { SHOW_DEV_TOOLS } from '../config/devFlags.js';
import { DevPageJumper } from '../dev/DevPageJumper.jsx';
import { PAGES } from '../pages/index.jsx';
import { PlaceholderPage } from '../pages/shared/PlaceholderPage.jsx';
import { PreferencesPanel } from '../preferences/PreferencesPanel/PreferencesPanel.jsx';
import { getRootAttributes, getRootStyle } from '../preferences/preferences.js';
import { usePreferences } from '../preferences/usePreferences.js';
import { usePortalRoute } from '../router/usePortalRoute.js';
import { PortalShell } from './PortalShell/PortalShell.jsx';

/** Raíz visual del portal: aplica las preferencias y decide qué pantalla mostrar. */
export function PortalFrame() {
  const { prefs, resolvedTheme } = usePreferences();
  const { route, param } = usePortalRoute();
  const Page = PAGES[route.id];

  useEffect(() => {
    document.title = `${route.title} · FeathersForAll`;
  }, [route.title]);

  const page = Page ? <Page route={route} param={param} /> : <PlaceholderPage route={route} param={param} />;

  return (
    <div className="fp-root" {...getRootAttributes(prefs, resolvedTheme)} style={getRootStyle(prefs, resolvedTheme)}>
      {route.role ? (
        <PortalShell role={route.role} activeNav={route.nav}>
          {page}
        </PortalShell>
      ) : (
        page
      )}
      <PreferencesPanel />
      {SHOW_DEV_TOOLS && <DevPageJumper />}
    </div>
  );
}
