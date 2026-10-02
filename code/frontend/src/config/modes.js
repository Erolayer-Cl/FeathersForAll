// Textos de la app. Los prompts de sistema NO viven aquí: los define el
// backend según `mode` (src/modules/tutor/system-prompt.js).

/** @typedef {'tutor' | 'pruebas'} ChatKey */

/** Chats del modo Tutor (el Aula virtual no tiene chat).
 * @type {Record<ChatKey, {label: string, greeting: string, intro: string, placeholder: string, suggestions: string[]}>} */
export const MODES = {
  tutor: {
    label: 'Modo estudio',
    greeting: '¿Qué quieres aprender HOY?',
    intro: 'Explícame en qué estás trabajando y lo resolvemos juntos, paso a paso.',
    placeholder: 'Pregúntale a tu tutor…',
    suggestions: ['Explícame las fracciones', 'Ayúdame con mi redacción', 'Repasemos para un examen'],
  },
  pruebas: {
    label: 'Pruebas',
    greeting: '¿Sobre qué tema quieres una prueba?',
    intro: 'Dime el tema y te hago preguntas una a una. Al final te doy tu resultado.',
    placeholder: 'Escribe el tema de la prueba…',
    suggestions: ['Prueba de fracciones', 'Prueba de ortografía', 'Prueba de geografía'],
  },
};

/** Aula virtual: secciones donde se mostrarán los cursos (sin chat). */
export const AULA = {
  label: 'Modo aula virtual',
  sections: {
    inicio: {
      label: 'Inicio',
      title: 'Bienvenido al aula.',
      description: 'Aquí verás un resumen de tus cursos, próximas evaluaciones y avances.',
    },
    cursos: {
      label: 'Mis cursos',
      title: 'Mis cursos',
      description: 'Aquí aparecerán los cursos en los que estás matriculado.',
    },
    notas: {
      label: 'Notas',
      title: 'Notas',
      description: 'Aquí verás tus calificaciones y la retroalimentación de cada evaluación.',
    },
  },
};

export const AULA_NAV = Object.entries(AULA.sections).map(([id, { label }]) => ({ id, label }));

export const ERROR_REPLY = 'No pude responder ahora. Inténtalo de nuevo.';
