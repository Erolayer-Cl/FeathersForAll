import { useCallback, useEffect, useState } from 'react';
import { getCached, setCached } from '../../api/cache.js';
import { useSession } from '../session/useSession.js';

/**
 * Pide datos a la API con el token de la sesión y entrega { data, error, loading, reload }.
 * Si la API responde 401 (token vencido o revocado), cierra la sesión: la guardia lleva al login.
 *
 * Con `{ cache: 'nombre' }` la respuesta se recuerda en memoria (api/cache.js): al volver a la
 * pantalla, o al recargar, se muestra lo anterior en vez de «Cargando…» mientras llega lo nuevo.
 * El nombre identifica qué se pide (dos fetchers distintos no deben compartirlo).
 *
 * @param {(token: string, opts: {signal: AbortSignal}) => Promise<any>} fetcher  función de api/portalApi.js
 * @param {string} key  identifica la petición (p. ej. el id del curso): si cambia, se vuelve a pedir
 * @param {{cache?: string}} [options]
 */
export function useApiData(fetcher, key = '', { cache } = {}) {
  const { token, expire } = useSession();
  const [reloads, setReloads] = useState(0);
  const requestKey = `${key}|${token}|${reloads}`;
  const cacheKey = cache ? `${cache}|${key}|${token}` : null;
  // El resultado recuerda a qué petición corresponde: si no es la actual, todavía está cargando.
  const [result, setResult] = useState({ key: null, data: undefined, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetcher(token, { signal: controller.signal }).then(
      (data) => {
        if (cacheKey) setCached(cacheKey, data);
        setResult({ key: requestKey, data, error: null });
      },
      (error) => {
        if (error?.name === 'AbortError') return;
        if (error?.status === 401) {
          expire();
          return;
        }
        setResult({ key: requestKey, data: undefined, error });
      },
    );
    return () => controller.abort();
    // `fetcher` suele ser una función nueva en cada render: la petición la identifica `requestKey`
    // (y `cacheKey` se deriva de lo mismo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const loading = result.key !== requestKey;
  const cached = loading && cacheKey ? getCached(cacheKey) : undefined;
  if (cached !== undefined) return { data: cached, error: null, loading: false, reload };
  return { data: loading ? undefined : result.data, error: loading ? null : result.error, loading, reload };
}
