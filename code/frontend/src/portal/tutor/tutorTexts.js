// Textos de la pantalla del Tutor IA. Los prompts de sistema NO viven aquí: los define el backend
// según `mode` (code/backend/src/modules/tutor/system-prompt.js).

/** @type {Record<'tutor' | 'pruebas', {label: string, hint: string, greeting: string, intro: string, placeholder: string, suggestions: string[]}>} */
export const TUTOR_MODES = {
  tutor: {
    label: 'Modo estudio',
    hint: 'Conversa y aprende paso a paso',
    greeting: '¿Qué quieres aprender hoy?',
    intro: 'Explícame en qué estás trabajando y lo resolvemos juntos, paso a paso.',
    placeholder: 'Pregúntale a tu tutor…',
    suggestions: ['Explícame las fracciones', 'Ayúdame con mi redacción', 'Repasemos para un examen'],
  },
  pruebas: {
    label: 'Pruebas',
    hint: 'Practica con preguntas guiadas',
    greeting: '¿Sobre qué tema quieres una prueba?',
    intro: 'Dime el tema y te hago preguntas una a una. Al final te doy tu resultado.',
    placeholder: 'Escribe el tema de la prueba…',
    suggestions: ['Prueba de fracciones', 'Prueba de ortografía', 'Prueba de geografía'],
  },
};

export const TUTOR_TEXTS = {
  errorReply: 'No pude responder ahora. Inténtalo de nuevo.',
  maxLength: 4000, // mismo límite que valida el backend por mensaje
};
