// Interruptores solo para desarrollo y pruebas. NO son parte del producto final.

/** Herramientas de prueba: selector de rol en la barra superior y botón «Pantallas» para saltar a cualquier
 *  pantalla. Por defecto se ven con `npm run dev` y se ocultan en la versión compilada (`npm run build`).
 *  Para forzarlas, reemplaza el valor por `true` (mostrar siempre) o `false` (ocultar siempre). */
export const SHOW_DEV_TOOLS = import.meta.env.DEV;

/** Datos de ejemplo (cursos, evaluaciones, notas…). Los crean el administrador y los docentes, así que
 *  por defecto el portal arranca vacío. Pon `true` solo para ver el diseño con ejemplos. */
export const SHOW_DEMO_DATA = false;
