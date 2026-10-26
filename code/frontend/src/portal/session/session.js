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

/** Último RBD usado (comodidad: el estudiante no lo escribe cada vez). No es un dato sensible. */
export const loadLastRbd = ({ storages = browserStorages() } = {}) => read(storages.local, LAST_RBD_KEY) ?? '';
export const saveLastRbd = (rbd, { storages = browserStorages() } = {}) => write(storages.local, LAST_RBD_KEY, rbd);
