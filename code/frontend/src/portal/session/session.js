// Sesión del portal: qué se guarda, dónde y cuándo deja de valer. Todo es puro (sin React),
// para poder probarlo con almacenamientos falsos.
//
// Se guarda el JWT del login y el perfil. Por defecto en sessionStorage (se borra al cerrar la
// pestaña); con "Recordar sesión", en localStorage. En ambos casos vence con el token (8 h).

export const SESSION_KEY = 'fp:session:v1';
export const LAST_RBD_KEY = 'fp:last-rbd';

/** Rol del backend (JWT) -> rol del portal (config/roles.js). */
export const PORTAL_ROLE = Object.freeze({ estudiante: 'est', docente: 'doc', admin_colegio: 'adm' });

/** Rol del portal del usuario, o null si su rol no tiene portal. */
export const portalRoleOf = (user) => PORTAL_ROLE[user?.role] ?? null;

/**
 * La cuenta inició sesión bien, pero no es del rol elegido en la pantalla de acceso (por ejemplo, un docente
 * en la pestaña Estudiante). La sesión NO se guarda: el login avisa y ofrece cambiar de pestaña.
 * `actual` es el rol del portal de la cuenta (null si su rol no tiene portal).
 */
export class RoleMismatchError extends Error {
  constructor(expected, actual) {
    super('La cuenta no corresponde al tipo de acceso elegido');
    this.name = 'RoleMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** Lanza RoleMismatchError si `user` no es del rol `expected` del portal. Sin `expected`, acepta cualquiera. */
export function assertPortalRole(user, expected) {
  const actual = portalRoleOf(user);
  if (expected && actual !== expected) throw new RoleMismatchError(expected, actual);
}

/**
 * Respuesta del login -> sesión, solo si la cuenta es del rol de la pestaña. Es la ÚNICA forma de obtener la sesión
 * que se guarda: si el rol no coincide lanza RoleMismatchError antes de que exista algo que guardar.
 */
export function acceptLogin(body, { expectedRole, now = Date.now() } = {}) {
  assertPortalRole(body?.user, expectedRole);
  return sessionFromLogin(body, now);
}

function browserStorages() {
  try {
    return { session: window.sessionStorage, local: window.localStorage };
  } catch {
    return { session: null, local: null }; // sin almacenamiento (modo privado estricto, pruebas)
  }
}

const read = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (storage, key, value) => {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* sin almacenamiento: la sesión vale solo mientras la página esté abierta */
  }
};

/** Respuesta de POST /v1/auth/login -> sesión { token, expiresAt, user }. */
export function sessionFromLogin(body, now = Date.now()) {
  return { token: body.access_token, expiresAt: now + body.expires_in * 1000, user: body.user };
}

/** ¿La sesión guardada se puede usar? (forma correcta, no vencida y con un rol del portal) */
export function isUsable(session, now = Date.now()) {
  return Boolean(
    session
      && typeof session.token === 'string'
      && Number.isFinite(session.expiresAt)
      && session.expiresAt > now
      && portalRoleOf(session.user),
  );
}

/** Sesión guardada (primero la de esta pestaña), o null si no hay o ya venció. */
export function loadSession({ storages = browserStorages(), now = Date.now() } = {}) {
  for (const storage of [storages.session, storages.local]) {
    let session;
    try {
      session = JSON.parse(read(storage, SESSION_KEY) ?? 'null');
    } catch {
      session = null;
    }
    if (isUsable(session, now)) return session;
    if (session) write(storage, SESSION_KEY, null); // vencida o corrupta: se limpia
  }
  return null;
}

/** Guarda la sesión: en localStorage si `remember`, si no en sessionStorage (y borra la otra). */
export function saveSession(session, { remember = false, storages = browserStorages() } = {}) {
  const [keep, drop] = remember ? [storages.local, storages.session] : [storages.session, storages.local];
  write(keep, SESSION_KEY, JSON.stringify(session));
  write(drop, SESSION_KEY, null);
}

export function clearSession({ storages = browserStorages() } = {}) {
  write(storages.session, SESSION_KEY, null);
  write(storages.local, SESSION_KEY, null);
}

/**
 * Inicio de sesión completo: llama al login, recuerda el RBD y guarda la sesión SOLO si la cuenta es del rol de la
 * pestaña (acceptLogin lanza RoleMismatchError antes de guardar). `loginFn` y `storages` se inyectan en las pruebas.
 * @returns {Promise<{token: string, expiresAt: number, user: object}>}
 */
export async function signInWith(loginFn, { rbd, email, password, remember = false }, { expectedRole, storages, now } = {}) {
  const body = await loginFn({ rbd, email, password });
  saveLastRbd(rbd, { storages });
  const session = acceptLogin(body, { expectedRole, now });
  saveSession(session, { remember, storages });
  return session;
}

/**
 * ¿Un evento `storage` (otra pestaña escribió en localStorage) cambia la sesión de esta pestaña?
 * Solo cuentan la clave de la sesión o un `clear()` (key null), y solo si cambió el token:
 * una pestaña con su propia sesión en sessionStorage no se ve afectada (loadSession la prioriza).
 * @param {{key: string | null}} event
 * @param {{token: string} | null} current  sesión actual de esta pestaña
 * @param {{token: string} | null} next     lo que devuelve loadSession() ahora
 */
export function isSessionChange(event, current, next) {
  if (event.key !== null && event.key !== SESSION_KEY) return false;
  return (current?.token ?? null) !== (next?.token ?? null);
}

/** Último RBD usado (comodidad: el estudiante no lo escribe cada vez). No es un dato sensible. */
export const loadLastRbd = ({ storages = browserStorages() } = {}) => read(storages.local, LAST_RBD_KEY) ?? '';
export const saveLastRbd = (rbd, { storages = browserStorages() } = {}) => write(storages.local, LAST_RBD_KEY, rbd);
