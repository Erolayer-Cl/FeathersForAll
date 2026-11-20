// Caché en memoria de las respuestas GET del portal (la usa hooks/useApiData.js con `{ cache }`).
// Al volver a una pantalla se muestran al tiro los datos ya cargados mientras se piden de nuevo
// por detrás. Vive solo en memoria (nunca en localStorage: son datos de menores) y se vacía al
// iniciar o cerrar sesión, para que en un equipo compartido nadie vea lo del usuario anterior.

const MAX_ENTRADAS = 50;
const store = new Map();

/** Respuesta guardada para `key`, o undefined si no hay. */
export const getCached = (key) => store.get(key);

/** Guarda la respuesta; si hay demasiadas, descarta la más antigua. */
export function setCached(key, data) {
  store.delete(key); // re-insertar la deja como la más reciente
  store.set(key, data);
  if (store.size > MAX_ENTRADAS) store.delete(store.keys().next().value);
}

export function clearCache() {
  store.clear();
}
