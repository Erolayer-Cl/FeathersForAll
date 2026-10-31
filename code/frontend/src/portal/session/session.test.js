import { describe, expect, it } from 'vitest';
import {
  SESSION_KEY, clearSession, isUsable, loadLastRbd, loadSession, portalRoleOf, saveLastRbd, saveSession, sessionFromLogin,
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
