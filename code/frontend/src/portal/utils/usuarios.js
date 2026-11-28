// Ayudas de la gestión de usuarios y del cambio de contraseña (v1.12). El servidor vuelve a validar todo.

export const ROL_LABEL = { docente: 'Docente', estudiante: 'Estudiante', admin_colegio: 'Administrador', apoderado: 'Apoderado' };
export const ACCION_LABEL = {
  'usuario.crear': 'Creó la cuenta',
  'usuario.editar': 'Editó la cuenta',
  'usuario.desactivar': 'Desactivó la cuenta',
  'usuario.reactivar': 'Reactivó la cuenta',
  'usuario.restablecer_clave': 'Restableció la contraseña',
  'usuario.cambiar_clave': 'Cambió su contraseña',
  'apoderado.vincular': 'Vinculó un pupilo al apoderado',
  'apoderado.desvincular': 'Desvinculó un pupilo del apoderado',
};
export const MIN_CLAVE = 8;
export const fechaHora = (v) => (v ? new Date(v).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/**
 * Clave inicial al azar para entregarle a la persona (12 caracteres sin los que se confunden: 0/O, 1/l/I).
 * Usa crypto.getRandomValues: nunca Math.random para una contraseña.
 */
export function generarClave(largo = 12, random = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...random(largo)].map((n) => alfabeto[n % alfabeto.length]).join('');
}

/** Problema de una clave elegida por el admin (el servidor vuelve a validar). */
export function problemaClaveInicial(clave, email = '') {
  if (clave.length < MIN_CLAVE) return `La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`;
  if (clave.length > 256) return 'La contraseña es demasiado larga (máximo 256 caracteres).';
  if (!clave.trim()) return 'La contraseña no puede ser solo espacios.';
  if (email && clave.trim().toLowerCase() === email.trim().toLowerCase()) return 'La contraseña no puede ser el correo.';
  return null;
}



/** Valida antes de enviar (el servidor vuelve a validar todo). Devuelve el problema o null. */
export function problemaClave({ actual, nueva, repetida }, email = '') {
  if (!actual) return 'Escribe tu contraseña actual.';
  if (nueva.length < MIN_CLAVE) return `La contraseña nueva debe tener al menos ${MIN_CLAVE} caracteres.`;
  if (nueva.length > 256) return 'La contraseña nueva es demasiado larga (máximo 256 caracteres).';
  if (!nueva.trim()) return 'La contraseña nueva no puede ser solo espacios.';
  if (nueva === actual) return 'La contraseña nueva debe ser distinta de la actual.';
  if (email && nueva.trim().toLowerCase() === email.toLowerCase()) return 'La contraseña no puede ser tu correo.';
  if (nueva !== repetida) return 'Las contraseñas nuevas no coinciden.';
  return null;
}

