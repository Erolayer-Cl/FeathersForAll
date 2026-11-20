import { beforeEach, describe, expect, test } from 'vitest';
import { clearCache, getCached, setCached } from './cache.js';

describe('caché de respuestas', () => {
  beforeEach(() => clearCache());

  test('guarda y entrega la respuesta por clave', () => {
    expect(getCached('me/grades|tok')).toBeUndefined();
    setCached('me/grades|tok', { courses: [] });
    expect(getCached('me/grades|tok')).toEqual({ courses: [] });
  });

  test('clearCache borra todo (cerrar sesión)', () => {
    setCached('a', 1);
    clearCache();
    expect(getCached('a')).toBeUndefined();
  });

  test('sobre 50 entradas descarta la más antigua, contando las re-escritas como nuevas', () => {
    for (let i = 0; i < 50; i++) setCached(`k${i}`, i);
    setCached('k0', 'otra vez'); // k0 pasa a ser la más reciente
    setCached('k50', 50);
    expect(getCached('k0')).toBe('otra vez');
    expect(getCached('k1')).toBeUndefined();
    expect(getCached('k50')).toBe(50);
  });
});
