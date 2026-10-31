import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../session/useSession.js';

/**
 * Pide datos a la API con el token de la sesión y entrega { data, error, loading, reload }.
 * Si la API responde 401 (token vencido o revocado), cierra la sesión: la guardia lleva al login.
 *
 * @param {(token: string, opts: {signal: AbortSignal}) => Promise<any>} fetcher  función de api/portalApi.js
 * @param {string} key  identifica la petición (p. ej. el id del curso): si cambia, se vuelve a pedir
 */
export function useApiData(fetcher, key = '') {
  const { token, expire } = useSession();
  const [reloads, setReloads] = useState(0);
  const requestKey = `${key}|${token}|${reloads}`;
  // El resultado recuerda a qué petición corresponde: si no es la actual, todavía está cargando.
  const [result, setResult] = useState({ key: null, data: undefined, error: null });

  useEffect(() => {
    const controller = new AbortController();
    fetcher(token, { signal: controller.signal }).then(
      (data) => setResult({ key: requestKey, data, error: null }),
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
    // `fetcher` suele ser una función nueva en cada render: la petición la identifica `requestKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const loading = result.key !== requestKey;
  return { data: loading ? undefined : result.data, error: loading ? null : result.error, loading, reload };
}
