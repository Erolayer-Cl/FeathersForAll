import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_ROUTE, findRoute } from '../config/routes.js';
import { parsePortalHash, routeHref } from './parseRoute.js';

// Router mínimo basado en el hash: "#/portal/est-curso/12". No agrega dependencias y no choca con
// la app del chat. Si más adelante se adopta react-router, solo hay que reemplazar esta carpeta.

function subscribe(onChange) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;

export { routeHref };

/** @returns {{route: import('../config/routes.js').PortalRoute, param: string | null, navigate: (id: string, param?: string | number) => void}} */
export function usePortalRoute() {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  const { id, param } = parsePortalHash(hash);
  const navigate = useCallback((to, toParam) => {
    window.location.hash = routeHref(to, toParam);
  }, []);
  return { route: findRoute(id ?? DEFAULT_ROUTE), param, navigate };
}
