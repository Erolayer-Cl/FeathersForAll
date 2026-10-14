// Preferencias de personalización del portal: valores válidos, lectura/escritura y
// traducción a atributos/variables CSS. Todo es puro (sin React) para poder probarlo.

export const STORAGE_KEY = 'fp:preferences:v1';

/** Valores iniciales. `theme: 'auto'` sigue el modo claro/oscuro del dispositivo. */
export const PREFERENCE_DEFAULTS = Object.freeze({
  theme: 'auto',
  accent: 'azul',
  textSize: 'md',
  font: 'original',
  density: 'normal',
  radius: 'pill',
  menu: 'full',
  reduceMotion: false,
  highContrast: false,
});

/** Opciones con su etiqueta, para dibujar el panel sin repetir textos. */
export const PREFERENCE_OPTIONS = Object.freeze({
  theme: [
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Oscuro' },
    { value: 'auto', label: 'Automático' },
  ],
  textSize: [
    { value: 'sm', label: 'Pequeño' },
    { value: 'md', label: 'Normal' },
    { value: 'lg', label: 'Grande' },
    { value: 'xl', label: 'Muy grande' },
  ],
  font: [
    { value: 'original', label: 'Original' },
    { value: 'legible', label: 'Alta legibilidad' },
    { value: 'sistema', label: 'Del sistema' },
  ],
  density: [
    { value: 'compact', label: 'Compacta' },
    { value: 'normal', label: 'Normal' },
    { value: 'comfortable', label: 'Amplia' },
  ],
  radius: [
    { value: 'pill', label: 'Redondeadas' },
    { value: 'soft', label: 'Suaves' },
    { value: 'sharp', label: 'Rectas' },
  ],
  menu: [
    { value: 'full', label: 'Con texto' },
    { value: 'rail', label: 'Solo íconos' },
  ],
});

/** Colores de acento. `light` = [marca fuerte, acento]; `dark` = acento sobre fondo oscuro. */
export const ACCENTS = Object.freeze({
  azul: { label: 'Azul', light: ['#1E3A8A', '#3B82F6'], dark: '#3B82F6' },
  violeta: { label: 'Violeta', light: ['#4C1D95', '#7C3AED'], dark: '#8B5CF6' },
  turquesa: { label: 'Turquesa', light: ['#115E59', '#0F766E'], dark: '#0D9488' },
  rosa: { label: 'Rosa', light: ['#9D174D', '#DB2777'], dark: '#DB2777' },
  naranja: { label: 'Naranja', light: ['#9A3412', '#C2410C'], dark: '#EA580C' },
});

/** Factor de tamaño del contenido (se aplica con la propiedad CSS `zoom`). */
export const TEXT_SCALE = Object.freeze({ sm: 0.9, md: 1, lg: 1.15, xl: 1.3 });

const ALLOWED = {
  theme: ['auto', 'light', 'dark'],
  accent: Object.keys(ACCENTS),
  textSize: Object.keys(TEXT_SCALE),
  font: ['original', 'legible', 'sistema'],
  density: ['compact', 'normal', 'comfortable'],
  radius: ['pill', 'soft', 'sharp'],
  menu: ['full', 'rail'],
};

/** Devuelve preferencias completas y válidas; todo lo desconocido vuelve a su valor inicial. */
export function sanitizePreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = { ...PREFERENCE_DEFAULTS };
  for (const [key, allowed] of Object.entries(ALLOWED)) {
    if (allowed.includes(source[key])) out[key] = source[key];
  }
  if (typeof source.reduceMotion === 'boolean') out.reduceMotion = source.reduceMotion;
  if (typeof source.highContrast === 'boolean') out.highContrast = source.highContrast;
  return out;
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // modo privado o datos bloqueados
  }
}

export function loadPreferences(storage = defaultStorage()) {
  try {
    return sanitizePreferences(JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...PREFERENCE_DEFAULTS };
  }
}

export function savePreferences(prefs, storage = defaultStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* sin almacenamiento: las preferencias valen solo en esta sesión */
  }
}

/** 'auto' se resuelve con el modo del dispositivo; el resto se respeta tal cual. */
export function resolveTheme(theme, systemPrefersDark) {
  if (theme === 'auto') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}

/** Variables CSS del acento elegido, según el tema ya resuelto. */
export function getAccentVars(accentId, resolvedTheme) {
  const accent = ACCENTS[accentId] ?? ACCENTS.azul;
  if (resolvedTheme === 'dark') return { '--fp-accent': accent.dark };
  return { '--fp-brand': accent.light[0], '--fp-accent': accent.light[1] };
}

/** Atributos data-* que se ponen en la raíz del portal (los lee styles/preferences.css). */
export function getRootAttributes(prefs, resolvedTheme) {
  return {
    'data-fp-theme': resolvedTheme,
    'data-fp-font': prefs.font,
    'data-fp-density': prefs.density,
    'data-fp-radius': prefs.radius,
    'data-fp-menu': prefs.menu,
    'data-fp-contrast': prefs.highContrast ? 'high' : 'normal',
    'data-fp-motion': prefs.reduceMotion ? 'reduce' : 'normal',
  };
}

/** Estilo en línea de la raíz: acento + tamaño del contenido. */
export function getRootStyle(prefs, resolvedTheme) {
  return { ...getAccentVars(prefs.accent, resolvedTheme), '--fp-zoom': String(TEXT_SCALE[prefs.textSize]) };
}
