// Lectura y armado de rutas del portal (puro, sin React). Formato: "#/portal/<pantalla>" o "#/portal/<pantalla>/<id>".
// El <id> sirve para las pantallas de detalle: un solo componente muestra cualquier curso, colegio, usuario o evaluación.

export const PREFIX = '#/portal/';

/** @returns {{id: string | null, param: string | null}} `id` es null si el hash no es del portal. */
export function parsePortalHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(PREFIX)) return { id: null, param: null };
  const [id, rawParam] = hash.slice(PREFIX.length).split('/');
  let param = null;
  if (rawParam) {
    try {
      param = decodeURIComponent(rawParam);
    } catch {
      param = rawParam;
    }
  }
  return { id: id || null, param };
}

/** Arma el href de una pantalla; con `param` abre el detalle de ese elemento. */
export function routeHref(id, param) {
  return param == null || param === '' ? `${PREFIX}${id}` : `${PREFIX}${id}/${encodeURIComponent(String(param))}`;
}
