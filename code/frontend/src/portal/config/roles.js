// Roles del portal y su menú lateral. Para agregar una sección al menú: una línea en `nav`
// (y su ruta en config/routes.js).

/** @typedef {'est'|'doc'|'adm'} RoleId */

export const ROLES = {
  est: {
    id: 'est',
    label: 'Estudiante',
    modeLabel: 'Modo estudiante',
    home: 'est-inicio',
    config: 'est-config',
    login: 'login-est',
    nav: [
      { key: 'inicio', label: 'Inicio', icon: 'home', route: 'est-inicio' },
      { key: 'cursos', label: 'Mis cursos', icon: 'book', route: 'est-cursos' },
      { key: 'notas', label: 'Mis notas', icon: 'notes', route: 'est-notas' },
      { key: 'tutor', label: 'Tutor IA', icon: 'chat', route: 'est-tutor' },
      { key: 'progreso', label: 'Progreso', icon: 'trend', route: 'est-progreso' },
    ],
  },
  doc: {
    id: 'doc',
    label: 'Docente',
    modeLabel: 'Modo docente',
    home: 'doc-inicio',
    config: 'doc-config',
    login: 'login-doc',
    nav: [
      { key: 'inicio', label: 'Inicio', icon: 'home', route: 'doc-inicio' },
      { key: 'cursos', label: 'Mis cursos', icon: 'book', route: 'doc-cursos' },
      { key: 'estudiantes', label: 'Mis estudiantes', icon: 'users', route: 'doc-estudiantes' },
      { key: 'evaluaciones', label: 'Evaluaciones', icon: 'check', route: 'doc-evaluaciones' },
      { key: 'reportes', label: 'Reportes', icon: 'bars', route: 'doc-reportes' },
    ],
  },
  adm: {
    id: 'adm',
    label: 'Administrador',
    modeLabel: 'Modo administrador',
    home: 'adm-inicio',
    config: 'adm-config',
    login: 'login-adm',
    nav: [
      { key: 'inicio', label: 'Inicio', icon: 'home', route: 'adm-inicio' },
      { key: 'colegios', label: 'Colegios', icon: 'school', route: 'adm-colegios' },
      { key: 'usuarios', label: 'Usuarios', icon: 'users', route: 'adm-usuarios' },
      { key: 'cursos', label: 'Cursos', icon: 'book', route: 'adm-cursos' },
      { key: 'evaluaciones', label: 'Evaluaciones', icon: 'check', route: 'adm-evaluaciones' },
      { key: 'reportes', label: 'Reportes', icon: 'bars', route: 'adm-reportes' },
    ],
  },
};

export const ROLE_IDS = Object.keys(ROLES);
