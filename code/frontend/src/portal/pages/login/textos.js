// Textos de las pantallas de acceso, por rol.

/** Pestañas del selector del login (el acceso de administración va aparte, como enlace). */
export const LOGIN_TABS = ['est', 'doc'];
export const LOGIN_TEXTOS = {
  est: {
    titulo: 'Bienvenido a FeathersForAll',
    detalle: 'Accede con tu correo institucional para continuar tu experiencia de aprendizaje.',
    ejemplo: 'nombre@colegio.cl',
    ayudaRbd: 'El código de tu colegio. Si no lo sabes, pídeselo a tu profesor jefe.',
  },
  doc: {
    titulo: 'Bienvenido, Docente',
    detalle: 'Ingresa con tu correo institucional para gestionar tus cursos y las evaluaciones de tus estudiantes.',
    ejemplo: 'profesor@colegio.cl',
    ayudaRbd: 'El código de tu colegio. Si no lo sabes, pídeselo a la administración del colegio.',
  },
  adm: {
    titulo: 'Panel de Administración',
    detalle: 'Accede con tus credenciales institucionales para gestionar usuarios, cursos y la configuración del colegio.',
    ejemplo: 'admin@colegio.cl',
    ayudaRbd: 'El Rol Base de Datos (RBD) que el Mineduc asignó a tu colegio.',
  },
};
