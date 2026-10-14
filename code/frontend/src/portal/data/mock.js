// DATOS DE EJEMPLO para las pantallas del portal. Cuando exista la API, cada pantalla debe
// pedir sus datos con un hook (p. ej. useEvaluaciones) y este archivo se elimina.
//
// Los cursos, evaluaciones y notas los crean el administrador y los docentes, así que por defecto
// el portal NO muestra datos inventados: las pantallas aparecen vacías con un aviso.
// Para ver el diseño con datos de ejemplo, cambia SHOW_DEMO_DATA en config/devFlags.js.
import { SHOW_DEMO_DATA } from '../config/devFlags.js';

const EST_INICIO_DEMO = {
  saludo: 'Hola Sofía 👋',
  promedio: { value: '5,8', hint: '↑ 0,3 este mes' },
  asistencia: { value: '89%', hint: 'Buen rendimiento' },
  cursosActivos: { value: '3', hint: 'Asignaturas actuales' },
  evaluaciones: [
    { curso: 'Matemática', fecha: '12 Sep', estado: 'Pendiente', tono: 'warning' },
    { curso: 'Ciencias', fecha: '18 Sep', estado: 'Preparación', tono: 'warning' },
    { curso: 'Historia', fecha: '22 Sep', estado: 'Disponible', tono: 'success' },
  ],
  notificaciones: [
    { id: 1, tono: 'success', titulo: 'Nuevo material', detalle: 'Tu profesor publicó material en Matemática', cuando: '2 min' },
    { id: 2, tono: 'accent', titulo: 'Evaluación calificada', detalle: 'Ya puedes revisar tu resultado de Ciencias', cuando: 'Hoy' },
    { id: 3, tono: 'warning', titulo: 'Recordatorio', detalle: 'Evaluación de Historia en 14 días', cuando: 'Hoy' },
  ],
};

const EST_INICIO_VACIO = {
  saludo: 'Hola 👋',
  promedio: null,
  asistencia: null,
  cursosActivos: null,
  evaluaciones: [],
  notificaciones: [],
};

/** Datos de la pantalla Estudiante · Inicio (vacíos hasta que exista contenido real). */
export const EST_INICIO = SHOW_DEMO_DATA ? EST_INICIO_DEMO : EST_INICIO_VACIO;

export const LOGIN_TEXTOS = {
  est: {
    titulo: 'Bienvenido a FeathersForAll',
    detalle: 'Accede con tu correo institucional para continuar tu experiencia de aprendizaje.',
    ejemplo: 'nombre@colegio.cl',
  },
  doc: {
    titulo: 'Bienvenido, Docente',
    detalle: 'Ingresa con tu correo institucional para gestionar tus cursos y las evaluaciones de tus estudiantes.',
    ejemplo: 'profesor@colegio.cl',
  },
  adm: {
    titulo: 'Panel de Administración',
    detalle: 'Accede con tus credenciales institucionales para gestionar usuarios, cursos y la configuración del colegio.',
    ejemplo: 'admin@colegio.cl',
  },
};

export const PERFIL_DEMO = {
  est: { nombre: 'Sofía Martínez', correo: 'sofia.martinez@colegio.cl', detalle: 'Estudiante · 2° Medio A' },
  doc: { nombre: 'Sofía Martínez', correo: 'sofia.martinez@colegio.cl', detalle: 'Docente de Matemática y Ciencias' },
  adm: { nombre: 'Sofía Martínez', correo: 'sofia@feathersforall.cl', detalle: 'Administrador' },
};
