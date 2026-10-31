import './portal.css';
import { PortalFrame } from './layout/PortalFrame.jsx';
import { PreferencesProvider } from './preferences/PreferencesProvider.jsx';
import { SessionProvider } from './session/SessionProvider.jsx';

/** Portal completo (Estudiante / Docente / Administrador). Se monta con <PortalApp /> en cualquier entrada. */
export function PortalApp() {
  return (
    <PreferencesProvider>
      <SessionProvider>
        <PortalFrame />
      </SessionProvider>
    </PreferencesProvider>
  );
}
