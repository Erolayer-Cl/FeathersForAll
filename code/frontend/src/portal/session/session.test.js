import { describe, expect, it } from 'vitest';
import {
  LAST_RBD_KEY, RoleMismatchError, SESSION_KEY, acceptLogin, assertPortalRole, clearSession, isSessionChange, isUsable, loadLastRbd, loadSession,
  portalRoleOf, saveLastRbd, saveSession, sessionFromLogin, signInWith,
} from './session.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
    data,
  };
}
const fakeStorages = () => ({ session: fakeStorage(), local: fakeStorage() });

const NOW = 1_000_000;
const camila = { id: 'e1', name: 'Camila Díaz', role: 'estudiante', school: { name: 'Colegio Demo A' } };
const login = { access_token: 'jwt', expires_in: 3600, user: camila };

describe('sesión del portal', () => {
  it('traduce el rol del backend al rol del portal', () => {
    expect(portalRoleOf({ role: 'estudiante' })).toBe('est');
    expect(portalRoleOf({ role: 'docente' })).toBe('doc');
    expect(portalRoleOf({ role: 'admin_colegio' })).toBe('adm');
    expect(portalRoleOf({ role: 'master' })).toBeNull();
    expect(portalRoleOf(null)).toBeNull();
  });

  it('arma la sesión desde la respuesta del login, con su vencimiento', () => {
    expect(sessionFromLogin(login, NOW)).toEqual({ token: 'jwt', expiresAt: NOW + 3_600_000, user: camila });
  });

  it('por defecto guarda en sessionStorage; con "Recordar sesión", en localStorage', () => {
    const storages = fakeStorages();
    const session = sessionFromLogin(login, NOW);
    saveSession(session, { storages });
    expect(storages.session.data[SESSION_KEY]).toBeDefined();
    expect(storages.local.data[SESSION_KEY]).toBeUndefined();

    saveSession(session, { remember: true, storages });
    expect(storages.local.data[SESSION_KEY]).toBeDefined();
    expect(storages.session.data[SESSION_KEY]).toBeUndefined();
    expect(loadSession({ storages, now: NOW })).toEqual(session);
  });

  it('una sesión vencida o corrupta no se usa y se borra', () => {
    const storages = fakeStorages();
    saveSession(sessionFromLogin(login, NOW), { storages });
    expect(loadSession({ storages, now: NOW + 3_600_000 })).toBeNull();
    expect(storages.session.data[SESSION_KEY]).toBeUndefined();

    storages.local.setItem(SESSION_KEY, '{no es json');
    expect(loadSession({ storages, now: NOW })).toBeNull();
  });

  it('isUsable exige token, vencimiento futuro y un rol con portal', () => {
    const ok = sessionFromLogin(login, NOW);
    expect(isUsable(ok, NOW)).toBe(true);
    expect(isUsable({ ...ok, token: undefined }, NOW)).toBe(false);
    expect(isUsable({ ...ok, user: { ...camila, role: 'master' } }, NOW)).toBe(false);
  });

  it('cerrar sesión borra ambos almacenamientos', () => {
    const storages = fakeStorages();
    saveSession(sessionFromLogin(login, NOW), { storages });
    saveSession(sessionFromLogin(login, NOW), { remember: true, storages });
    clearSession({ storages });
    expect(loadSession({ storages, now: NOW })).toBeNull();
  });

  it('recuerda el último RBD usado', () => {
    const storages = fakeStorages();
    expect(loadLastRbd({ storages })).toBe('');
    saveLastRbd('99901', { storages });
    expect(loadLastRbd({ storages })).toBe('99901');
  });

  it('sin almacenamiento disponible no falla', () => {
    const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => {} };
    const storages = { session: roto, local: roto };
    expect(() => saveSession(sessionFromLogin(login, NOW), { storages })).not.toThrow();
    expect(loadSession({ storages, now: NOW })).toBeNull();
  });
});

describe('rol elegido en el login', () => {
  const ana = { id: 'a1', role: 'docente' };
  const marta = { id: 'a3', role: 'admin_colegio' };

  it('acepta la cuenta si es del rol de la pestaña (o si no se pidió rol)', () => {
    expect(() => assertPortalRole(camila, 'est')).not.toThrow();
    expect(() => assertPortalRole(ana, 'doc')).not.toThrow();
    expect(() => assertPortalRole(ana)).not.toThrow();
  });

  it('una cuenta de otro rol lanza RoleMismatchError con el rol esperado y el real', () => {
    const err = (() => { try { assertPortalRole(ana, 'est'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(RoleMismatchError);
    expect(err.expected).toBe('est');
    expect(err.actual).toBe('doc');
    expect(() => assertPortalRole(camila, 'doc')).toThrow(RoleMismatchError);
    expect(() => assertPortalRole(marta, 'doc')).toThrow(RoleMismatchError);
  });

  it('un rol sin portal también se rechaza, con actual = null', () => {
    const err = (() => { try { assertPortalRole({ role: 'apoderado' }, 'est'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(RoleMismatchError);
    expect(err.actual).toBeNull();
  });
});

describe('acceptLogin: la sesión solo existe si la cuenta es del rol de la pestaña', () => {
  const ana = { id: 'a1', role: 'docente' };

  it('con el rol correcto entrega la sesión, lista para guardar', () => {
    expect(acceptLogin({ access_token: 'jwt', expires_in: 60, user: ana }, { expectedRole: 'doc', now: NOW }))
      .toEqual({ token: 'jwt', expiresAt: NOW + 60_000, user: ana });
  });

  it('con otro rol lanza antes de crear la sesión: el almacenamiento queda vacío', () => {
    const storages = fakeStorages();
    let saved = false;
    try {
      saveSession(acceptLogin({ access_token: 'jwt', expires_in: 60, user: ana }, { expectedRole: 'est', now: NOW }), { storages });
      saved = true;
    } catch (err) {
      expect(err).toBeInstanceOf(RoleMismatchError);
    }
    expect(saved).toBe(false);
    expect(storages.session.data).toEqual({});
    expect(storages.local.data).toEqual({});
    expect(loadSession({ storages, now: NOW })).toBeNull();
  });
});

describe('signInWith: el flujo completo del login', () => {
  const ana = { id: 'a1', role: 'docente' };
  const fakeLogin = (user) => async () => ({ access_token: 'jwt', expires_in: 60, user });
  const credenciales = { rbd: '99901', email: 'ana@demo-a.cl', password: 'x' };

  it('con el rol de la pestaña guarda la sesión y el RBD', async () => {
    const storages = fakeStorages();
    const s = await signInWith(fakeLogin(ana), credenciales, { expectedRole: 'doc', storages, now: NOW });
    expect(s.user).toEqual(ana);
    expect(loadSession({ storages, now: NOW })).toEqual(s);
    expect(storages.local.data[LAST_RBD_KEY]).toBe('99901');
  });

  it('con otro rol lanza RoleMismatchError y NO guarda la sesión (sí recuerda el RBD)', async () => {
    const storages = fakeStorages();
    await expect(signInWith(fakeLogin(ana), credenciales, { expectedRole: 'est', storages, now: NOW })).rejects.toBeInstanceOf(RoleMismatchError);
    expect(storages.session.data[SESSION_KEY]).toBeUndefined();
    expect(storages.local.data[SESSION_KEY]).toBeUndefined();
    expect(loadSession({ storages, now: NOW })).toBeNull();
    expect(storages.local.data[LAST_RBD_KEY]).toBe('99901');
  });

  it('sin RBD (estudiante o docente) no lo manda ni lo recuerda', async () => {
    const storages = fakeStorages();
    let enviado;
    const login = async (body) => { enviado = body; return { access_token: 'jwt', expires_in: 60, user: ana }; };
    await signInWith(login, { rbd: undefined, email: 'ana@demo-a.cl', password: 'x' }, { expectedRole: 'doc', storages, now: NOW });
    expect(enviado.rbd).toBeUndefined();
    expect(storages.local.data[LAST_RBD_KEY]).toBeUndefined();
  });

  it('si el login falla (401), no guarda nada', async () => {
    const storages = fakeStorages();
    const failing = async () => { throw Object.assign(new Error('no'), { status: 401 }); };
    await expect(signInWith(failing, credenciales, { expectedRole: 'est', storages })).rejects.toThrow('no');
    expect(storages.session.data).toEqual({});
    expect(storages.local.data).toEqual({});
  });
});

describe('isSessionChange (sesión entre pestañas)', () => {
  const a = { token: 'jwt-a' };
  const b = { token: 'jwt-b' };

  it('cerrar sesión en otra pestaña cambia la sesión de esta', () => {
    expect(isSessionChange({ key: SESSION_KEY }, a, null)).toBe(true);
  });

  it('otro usuario en la sesión recordada también cuenta como cambio', () => {
    expect(isSessionChange({ key: SESSION_KEY }, a, b)).toBe(true);
  });

  it('localStorage.clear() (key null) se revisa igual', () => {
    expect(isSessionChange({ key: null }, a, null)).toBe(true);
  });

  it('otras claves (preferencias, último RBD) no cambian nada', () => {
    expect(isSessionChange({ key: 'fp:last-rbd' }, a, null)).toBe(false);
  });

  it('si el token sigue igual (p. ej. esta pestaña tiene su propia sesión) no hay cambio', () => {
    expect(isSessionChange({ key: SESSION_KEY }, a, { token: 'jwt-a' })).toBe(false);
    expect(isSessionChange({ key: SESSION_KEY }, null, null)).toBe(false);
  });
});
