// Registro de pantallas ya construidas: id de ruta → componente.
// Las rutas de config/routes.js que no estén aquí muestran <PlaceholderPage />.
// Para sumar una pantalla: crea su componente y agrega una línea.
import { LoginPage } from './login/LoginPage.jsx';
import { EstudianteInicioPage } from './estudiante/InicioPage.jsx';
import { CursoPage } from './estudiante/CursoPage.jsx';
import { MisCursosPage } from './estudiante/MisCursosPage.jsx';
import { MisNotasPage } from './estudiante/MisNotasPage.jsx';
import { TutorPage } from './estudiante/TutorPage.jsx';
import { SettingsPage } from './shared/SettingsPage.jsx';

export const PAGES = {
  'login-est': () => <LoginPage role="est" />,
  'login-doc': () => <LoginPage role="doc" />,
  'login-adm': () => <LoginPage role="adm" />,
  'est-inicio': EstudianteInicioPage,
  'est-cursos': MisCursosPage,
  'est-curso': CursoPage,
  'est-notas': MisNotasPage,
  'est-tutor': TutorPage,
  'est-config': () => <SettingsPage role="est" />,
  'doc-config': () => <SettingsPage role="doc" />,
  'adm-config': () => <SettingsPage role="adm" />,
};
