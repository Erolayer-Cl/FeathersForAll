import { routeHref } from './parseRoute.js';

/** Enlace interno del portal: <PortalLink to="est-curso" param={curso.id}>Entrar al curso</PortalLink> */
export function PortalLink({ to, param, children, ...rest }) {
  return (
    <a href={routeHref(to, param)} {...rest}>
      {children}
    </a>
  );
}
