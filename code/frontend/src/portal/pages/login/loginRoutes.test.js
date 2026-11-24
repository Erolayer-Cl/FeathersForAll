import { describe, expect, it } from 'vitest';
import { ROLES } from '../../config/roles.js';
import { findRoute } from '../../config/routes.js';
import { PAGES } from '../index.jsx';
import { LOGIN_TABS, LOGIN_TEXTOS } from './textos.js';

describe('pantallas de acceso', () => {
  it('las tres rutas de acceso usan el MISMO componente (al cambiar de pestaña no se pierde lo escrito)', () => {
    const logins = Object.values(ROLES).map((r) => r.login);
    expect(new Set(logins.map((id) => PAGES[id])).size).toBe(1);
    for (const id of logins) expect(findRoute(id).role).toBeNull();
  });

  it('el selector muestra Estudiante y Docente; Administrador va aparte', () => {
    expect(LOGIN_TABS).toEqual(['est', 'doc']);
    expect(LOGIN_TABS.map((id) => ROLES[id].label)).toEqual(['Estudiante', 'Docente']);
  });

  it('cada rol tiene sus textos; solo administración pide el RBD', () => {
    for (const id of Object.keys(ROLES)) expect(LOGIN_TEXTOS[id].titulo).toBeTruthy();
    expect(LOGIN_TEXTOS.adm.ayudaRbd).toBeTruthy();
    expect(LOGIN_TEXTOS.est.ayudaRbd).toBeUndefined();
    expect(LOGIN_TEXTOS.doc.ayudaRbd).toBeUndefined();
  });
});
