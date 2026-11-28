// Tabla de pantallas del portal (las 34 del Figma). Es solo datos: sin JSX ni imports de React.
// `role: null` = pantalla de acceso (sin menú lateral). `nav` = ítem del menú que queda activo.
// `detail: true` = pantalla de detalle: un solo componente para cualquier elemento, el id llega en la URL
// (#/portal/est-curso/<id>) y la pantalla lo recibe como `param`. Cuántos cursos o evaluaciones existan
// no cambia esta tabla: las listas se dibujan con los datos que entregue la API.
// Las pantallas ya hechas se enlazan en pages/index.js; las demás muestran un marcador.

/** @typedef {{id: string, title: string, group: string, role: 'est'|'doc'|'adm'|'apo'|null, nav?: string, detail?: boolean}} PortalRoute */

/** @type {PortalRoute[]} */
export const PORTAL_ROUTES = [
  { id: 'login-est', title: 'Login Estudiante', group: 'Acceso', role: null },
  { id: 'login-doc', title: 'Login Docente', group: 'Acceso', role: null },
  { id: 'login-adm', title: 'Login Administrador', group: 'Acceso', role: null },
  { id: 'login-apo', title: 'Login Apoderado', group: 'Acceso', role: null },

  { id: 'est-inicio', title: 'Inicio', group: 'Estudiante', role: 'est', nav: 'inicio' },
  { id: 'est-cursos', title: 'Mis cursos', group: 'Estudiante', role: 'est', nav: 'cursos' },
  { id: 'est-evaluaciones', title: 'Evaluaciones', group: 'Estudiante', role: 'est', nav: 'evaluaciones' },
  { id: 'est-curso', title: 'Curso', group: 'Estudiante', role: 'est', nav: 'cursos', detail: true },
  { id: 'est-contenido', title: 'Curso · Contenido', group: 'Estudiante', role: 'est', nav: 'cursos', detail: true },
  { id: 'est-evaluacion', title: 'Rendir evaluación', group: 'Estudiante', role: 'est', nav: 'cursos', detail: true },
  { id: 'est-notas', title: 'Mis notas', group: 'Estudiante', role: 'est', nav: 'notas' },
  // El id (opcional) es el curso cuyos apuntes usa el tutor: #/portal/est-tutor/<curso>.
  { id: 'est-tutor', title: 'Tutor IA (chat y aprendizaje guiado)', group: 'Estudiante', role: 'est', nav: 'tutor', detail: true },
  { id: 'est-progreso', title: 'Progreso', group: 'Estudiante', role: 'est', nav: 'progreso' },
  { id: 'est-config', title: 'Configuración', group: 'Estudiante', role: 'est', nav: 'config' },

  { id: 'doc-inicio', title: 'Inicio', group: 'Docente', role: 'doc', nav: 'inicio' },
  { id: 'doc-cursos', title: 'Cursos', group: 'Docente', role: 'doc', nav: 'cursos' },
  { id: 'doc-curso-nuevo', title: 'Nuevo curso', group: 'Docente', role: 'doc', nav: 'cursos' },
  { id: 'doc-curso', title: 'Curso (resumen y contenidos)', group: 'Docente', role: 'doc', nav: 'cursos', detail: true },
  { id: 'doc-evaluacion-nueva', title: 'Nueva evaluación', group: 'Docente', role: 'doc', nav: 'evaluaciones', detail: true },
  { id: 'doc-evaluacion-editar', title: 'Editar borrador', group: 'Docente', role: 'doc', nav: 'evaluaciones', detail: true },
  { id: 'doc-evaluacion', title: 'Evaluación (preguntas y resultados)', group: 'Docente', role: 'doc', nav: 'evaluaciones', detail: true },
  { id: 'doc-libro', title: 'Libro de notas', group: 'Docente', role: 'doc', nav: 'cursos', detail: true },
  { id: 'doc-tarea', title: 'Tarea (plazo y entregas)', group: 'Docente', role: 'doc', nav: 'cursos', detail: true },
  { id: 'doc-estudiantes', title: 'Mis estudiantes', group: 'Docente', role: 'doc', nav: 'estudiantes' },
  // El id es "<curso>/<estudiante>" (routeHref lo codifica como un solo segmento).
  { id: 'doc-estudiante', title: 'Notas de un estudiante', group: 'Docente', role: 'doc', nav: 'estudiantes', detail: true },
  { id: 'doc-evaluaciones', title: 'Evaluaciones', group: 'Docente', role: 'doc', nav: 'evaluaciones' },
  { id: 'doc-reportes', title: 'Reportes', group: 'Docente', role: 'doc', nav: 'reportes' },
  { id: 'doc-config', title: 'Configuración', group: 'Docente', role: 'doc', nav: 'config' },

  { id: 'adm-inicio', title: 'Inicio', group: 'Administrador', role: 'adm', nav: 'inicio' },
  { id: 'adm-usuarios', title: 'Usuarios', group: 'Administrador', role: 'adm', nav: 'usuarios' },
  { id: 'adm-usuario', title: 'Ver usuario', group: 'Administrador', role: 'adm', nav: 'usuarios', detail: true },
  { id: 'adm-usuario-nuevo', title: 'Agregar usuario', group: 'Administrador', role: 'adm', nav: 'usuarios' },
  { id: 'adm-auditoria', title: 'Bitácora', group: 'Administrador', role: 'adm', nav: 'usuarios' },
  { id: 'adm-cursos', title: 'Cursos', group: 'Administrador', role: 'adm', nav: 'cursos' },
  { id: 'adm-curso', title: 'Ver curso', group: 'Administrador', role: 'adm', nav: 'cursos', detail: true },
  { id: 'adm-curso-nuevo', title: 'Agregar curso', group: 'Administrador', role: 'adm', nav: 'cursos' },
  { id: 'adm-evaluaciones', title: 'Evaluaciones', group: 'Administrador', role: 'adm', nav: 'evaluaciones' },
  { id: 'adm-evaluacion', title: 'Ver evaluación', group: 'Administrador', role: 'adm', nav: 'evaluaciones', detail: true },
  { id: 'adm-reportes', title: 'Reportes', group: 'Administrador', role: 'adm', nav: 'reportes' },
  { id: 'adm-reportes-rend', title: 'Reportes · Rendimiento', group: 'Administrador', role: 'adm', nav: 'reportes' },
  { id: 'adm-reportes-tutor', title: 'Reportes · Tutor IA', group: 'Administrador', role: 'adm', nav: 'reportes' },
  { id: 'adm-config', title: 'Configuración', group: 'Administrador', role: 'adm', nav: 'config' },

  { id: 'apo-inicio', title: 'Mis pupilos', group: 'Apoderado', role: 'apo', nav: 'inicio' },
  { id: 'apo-config', title: 'Configuración', group: 'Apoderado', role: 'apo', nav: 'config' },
];

export const DEFAULT_ROUTE = 'login-est';

const BY_ID = new Map(PORTAL_ROUTES.map((r) => [r.id, r]));

/** Busca una ruta por id; si no existe devuelve la de acceso. */
export function findRoute(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_ROUTE);
}
