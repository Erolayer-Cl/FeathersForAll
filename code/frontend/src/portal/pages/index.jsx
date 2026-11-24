// Registro de pantallas ya construidas: id de ruta → componente.
// Las rutas de config/routes.js que no estén aquí muestran <PlaceholderPage />.
// Para sumar una pantalla: crea su componente y agrega una línea.
import { LoginRoute } from './login/LoginPage.jsx';
import { EstudianteInicioPage } from './estudiante/InicioPage.jsx';
import { CursoPage } from './estudiante/CursoPage.jsx';
import { MisCursosPage } from './estudiante/MisCursosPage.jsx';
import { MisNotasPage } from './estudiante/MisNotasPage.jsx';
import { TutorPage } from './estudiante/TutorPage.jsx';
import { DocenteCursosPage } from './docente/CursosPage.jsx';
import { DocenteCursoPage } from './docente/CursoPage.jsx';
import { DocenteCursoNuevoPage } from './docente/CursoNuevoPage.jsx';
import { DocenteEvaluacionesPage } from './docente/EvaluacionesPage.jsx';
import { DocenteEvaluacionEditarPage } from './docente/EvaluacionEditarPage.jsx';
import { DocenteEvaluacionNuevaPage } from './docente/EvaluacionNuevaPage.jsx';
import { DocenteEvaluacionPage } from './docente/EvaluacionPage.jsx';
import { DocenteEstudianteNotasPage } from './docente/EstudianteNotasPage.jsx';
import { DocenteLibroNotasPage } from './docente/LibroNotasPage.jsx';
import { DocenteMisEstudiantesPage } from './docente/MisEstudiantesPage.jsx';
import { DocenteReportesPage } from './docente/ReportesPage.jsx';
import { EvaluacionPage } from './estudiante/EvaluacionPage.jsx';
import { SettingsPage } from './shared/SettingsPage.jsx';

export const PAGES = {
  'login-est': LoginRoute,
  'login-doc': LoginRoute,
  'login-adm': LoginRoute,
  'est-inicio': EstudianteInicioPage,
  'est-cursos': MisCursosPage,
  'est-curso': CursoPage,
  'est-notas': MisNotasPage,
  'est-tutor': TutorPage,
  'doc-inicio': DocenteCursosPage,
  'doc-cursos': DocenteCursosPage,
  'doc-curso': DocenteCursoPage,
  'doc-curso-nuevo': DocenteCursoNuevoPage,
  'doc-evaluaciones': DocenteEvaluacionesPage,
  'doc-evaluacion-nueva': DocenteEvaluacionNuevaPage,
  'doc-evaluacion': DocenteEvaluacionPage,
  'doc-evaluacion-editar': DocenteEvaluacionEditarPage,
  'doc-libro': DocenteLibroNotasPage,
  'doc-estudiantes': DocenteMisEstudiantesPage,
  'doc-estudiante': DocenteEstudianteNotasPage,
  'doc-reportes': DocenteReportesPage,
  'est-evaluacion': EvaluacionPage,
  'est-config': () => <SettingsPage role="est" />,
  'doc-config': () => <SettingsPage role="doc" />,
  'adm-config': () => <SettingsPage role="adm" />,
};
