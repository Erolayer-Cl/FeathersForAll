// Registro de páginas: preserva los componentes de login y todas las rutas anteriores.
import { LoginRoute } from './login/LoginPage.jsx';
import { EstudianteInicioPage } from './estudiante/InicioPage.jsx';
import { CursoPage } from './estudiante/CursoPage.jsx';
import { MisCursosPage } from './estudiante/MisCursosPage.jsx';
import { MisNotasPage } from './estudiante/MisNotasPage.jsx';
import { EstudianteEvaluacionesPage } from './estudiante/EvaluacionesPage.jsx';
import { TutorPage } from './estudiante/TutorPage.jsx';
import { ProgresoPage } from './estudiante/ProgresoPage.jsx';
import { DocenteCursosPage } from './docente/CursosPage.jsx';
import { DocenteInicioPage } from './docente/InicioPage.jsx';
import { AdministradorInicioPage } from './administrador/InicioPage.jsx';
import { DocenteCursoPage } from './docente/CursoPage.jsx';
import { DocenteCursoNuevoPage } from './docente/CursoNuevoPage.jsx';
import { DocenteEvaluacionesPage } from './docente/EvaluacionesPage.jsx';
import { DocenteEvaluacionEditarPage } from './docente/EvaluacionEditarPage.jsx';
import { DocenteEvaluacionNuevaPage } from './docente/EvaluacionNuevaPage.jsx';
import { DocenteEvaluacionPage } from './docente/EvaluacionPage.jsx';
import { EvaluacionPage } from './estudiante/EvaluacionPage.jsx';
import { SettingsPage } from './shared/SettingsPage.jsx';
import { DocenteEstudiantesPage } from './docente/EstudiantesPage.jsx';
import { DocenteReportesPage } from './docente/ReportesPage.jsx';
import {
  AdminColegiosPage, AdminColegioPage, AdminColegioNuevoPage,
  AdminUsuariosPage, AdminUsuarioPage, AdminUsuarioNuevoPage,
  AdminCursosPage, AdminCursoPage, AdminCursoNuevoPage,
  AdminEvaluacionesPage, AdminEvaluacionPage, AdminReportesPage,
  AdminRendimientoPage, AdminTutorReportePage,
} from './administrador/ManagementPages.jsx';
export const PAGES = {
 'login-est':LoginRoute,'login-doc':LoginRoute,'login-adm':LoginRoute,
 'est-inicio':EstudianteInicioPage,'est-cursos':MisCursosPage,'est-curso':CursoPage,
 'est-evaluaciones':EstudianteEvaluacionesPage,'est-notas':MisNotasPage,'est-tutor':TutorPage,'est-progreso':ProgresoPage,
 'doc-inicio':DocenteInicioPage,'doc-estudiantes':DocenteEstudiantesPage,'doc-reportes':DocenteReportesPage,'doc-cursos':DocenteCursosPage,'doc-curso':DocenteCursoPage,
 'doc-curso-nuevo':DocenteCursoNuevoPage,'doc-evaluaciones':DocenteEvaluacionesPage,
 'doc-evaluacion-nueva':DocenteEvaluacionNuevaPage,'doc-evaluacion':DocenteEvaluacionPage,
 'doc-evaluacion-editar':DocenteEvaluacionEditarPage,'est-evaluacion':EvaluacionPage,
 'est-config':()=> <SettingsPage role="est" />,'doc-config':()=> <SettingsPage role="doc" />,
 'adm-inicio':AdministradorInicioPage,
 'adm-colegios':AdminColegiosPage,'adm-colegio':AdminColegioPage,'adm-colegio-nuevo':AdminColegioNuevoPage,
 'adm-usuarios':AdminUsuariosPage,'adm-usuario':AdminUsuarioPage,'adm-usuario-nuevo':AdminUsuarioNuevoPage,
 'adm-cursos':AdminCursosPage,'adm-curso':AdminCursoPage,'adm-curso-nuevo':AdminCursoNuevoPage,
 'adm-evaluaciones':AdminEvaluacionesPage,'adm-evaluacion':AdminEvaluacionPage,
 'adm-reportes':AdminReportesPage,'adm-reportes-rend':AdminRendimientoPage,'adm-reportes-tutor':AdminTutorReportePage,
 'adm-config':()=> <SettingsPage role="adm" />,
};
