import { describe, expect, it } from 'vitest';
import { ROLES } from './roles.js';
import { DEFAULT_ROUTE, PORTAL_ROUTES, findRoute } from './routes.js';

describe('tabla de rutas', () => {
  it('tiene ids únicos', () => {
    const ids = PORTAL_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada ítem del menú apunta a una ruta existente del mismo rol', () => {
    for (const role of Object.values(ROLES)) {
      for (const item of role.nav) {
        expect(findRoute(item.route)).toMatchObject({ id: item.route, role: role.id });
      }
      expect(findRoute(role.home).role).toBe(role.id);
      expect(findRoute(role.config).role).toBe(role.id);
    }
  });

  it('las pantallas «Ver …» y de curso son de detalle (reciben un id)', () => {
    for (const id of ['est-curso', 'est-tutor', 'doc-curso', 'adm-colegio', 'adm-usuario', 'adm-curso', 'adm-evaluacion']) {
      expect(findRoute(id).detail).toBe(true);
    }
    expect(findRoute('adm-colegio-nuevo').detail).toBeUndefined();
  });

  it('una ruta desconocida cae en el acceso por defecto', () => {
    expect(findRoute('no-existe').id).toBe(DEFAULT_ROUTE);
  });
});
