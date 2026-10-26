// Guardia de rutas: ¿se puede mostrar esta pantalla con la sesión actual? Pura, para probarla.
import { ROLES } from '../config/roles.js';

/**
 * @param {{role: 'est'|'doc'|'adm'|null}} route  ruta pedida (config/routes.js)
 * @param {'est'|'doc'|'adm'|null} portalRole     rol de la sesión, o null si no hay sesión
 * @returns {string | null}  id de la ruta a la que hay que redirigir, o null si se puede mostrar
 */
export function redirectFor(route, portalRole) {
  // Pantallas de acceso: con sesión abierta, al inicio de tu rol.
  if (route.role === null) return portalRole ? ROLES[portalRole].home : null;
  // Pantallas de un rol: sin sesión, al login de ese rol; con otro rol, a tu propio inicio.
  if (!portalRole) return ROLES[route.role].login;
  if (portalRole !== route.role) return ROLES[portalRole].home;
  return null;
}
