import { describe, expect, it } from 'vitest';
import { findRoute } from '../config/routes.js';
import { redirectFor } from './access.js';

describe('guardia de rutas', () => {
  it('sin sesión, una pantalla de un rol lleva al login de ese rol', () => {
    expect(redirectFor(findRoute('est-notas'), null)).toBe('login-est');
    expect(redirectFor(findRoute('doc-cursos'), null)).toBe('login-doc');
  });

  it('con sesión del mismo rol, se muestra', () => {
    expect(redirectFor(findRoute('est-notas'), 'est')).toBeNull();
    expect(redirectFor(findRoute('est-curso'), 'est')).toBeNull();
  });

  it('con sesión de otro rol, lleva al inicio de su propio rol', () => {
    expect(redirectFor(findRoute('doc-cursos'), 'est')).toBe('est-inicio');
    expect(redirectFor(findRoute('est-notas'), 'adm')).toBe('adm-inicio');
  });

  it('las pantallas de acceso se ven sin sesión; con sesión llevan al inicio', () => {
    expect(redirectFor(findRoute('login-est'), null)).toBeNull();
    expect(redirectFor(findRoute('login-est'), 'est')).toBe('est-inicio');
    expect(redirectFor(findRoute('login-adm'), 'doc')).toBe('doc-inicio');
  });
});
