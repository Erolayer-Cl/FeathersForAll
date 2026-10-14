import { describe, expect, it } from 'vitest';
import { parsePortalHash, routeHref } from './parseRoute.js';

describe('parsePortalHash', () => {
  it('lee pantalla sin parámetro', () => {
    expect(parsePortalHash('#/portal/est-inicio')).toEqual({ id: 'est-inicio', param: null });
  });
  it('lee pantalla de detalle con id', () => {
    expect(parsePortalHash('#/portal/est-curso/mat-8b')).toEqual({ id: 'est-curso', param: 'mat-8b' });
  });
  it('decodifica ids con caracteres especiales', () => {
    expect(parsePortalHash(`#/portal/adm-colegio/${encodeURIComponent('San José / Sur')}`).param).toBe('San José / Sur');
  });
  it('ignora hashes que no son del portal', () => {
    expect(parsePortalHash('')).toEqual({ id: null, param: null });
    expect(parsePortalHash('#otra-cosa')).toEqual({ id: null, param: null });
  });
});

describe('routeHref', () => {
  it('arma enlaces con y sin id', () => {
    expect(routeHref('est-cursos')).toBe('#/portal/est-cursos');
    expect(routeHref('est-curso', 42)).toBe('#/portal/est-curso/42');
  });
  it('ida y vuelta', () => {
    expect(parsePortalHash(routeHref('adm-usuario', 'a b/c'))).toEqual({ id: 'adm-usuario', param: 'a b/c' });
  });
});
