import { describe, expect, it } from 'vitest';
import {
  PREFERENCE_DEFAULTS,
  STORAGE_KEY,
  getAccentVars,
  getRootAttributes,
  getRootStyle,
  loadPreferences,
  resolveTheme,
  sanitizePreferences,
  savePreferences,
} from './preferences.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    data,
  };
}

describe('sanitizePreferences', () => {
  it('devuelve los valores iniciales si no hay nada guardado', () => {
    expect(sanitizePreferences(undefined)).toEqual(PREFERENCE_DEFAULTS);
    expect(sanitizePreferences('basura')).toEqual(PREFERENCE_DEFAULTS);
  });

  it('descarta valores desconocidos y conserva los válidos', () => {
    const out = sanitizePreferences({ theme: 'dark', accent: 'verde-fosforito', textSize: 'xl', reduceMotion: 'si' });
    expect(out.theme).toBe('dark');
    expect(out.accent).toBe(PREFERENCE_DEFAULTS.accent);
    expect(out.textSize).toBe('xl');
    expect(out.reduceMotion).toBe(false);
  });
});

describe('loadPreferences / savePreferences', () => {
  it('guarda y recupera', () => {
    const storage = fakeStorage();
    savePreferences({ ...PREFERENCE_DEFAULTS, theme: 'dark', density: 'compact' }, storage);
    expect(JSON.parse(storage.data[STORAGE_KEY]).theme).toBe('dark');
    expect(loadPreferences(storage)).toMatchObject({ theme: 'dark', density: 'compact' });
  });

  it('tolera JSON roto y almacenamiento ausente', () => {
    expect(loadPreferences(fakeStorage({ [STORAGE_KEY]: '{no es json' }))).toEqual(PREFERENCE_DEFAULTS);
    expect(loadPreferences(null)).toEqual(PREFERENCE_DEFAULTS);
    expect(() => savePreferences(PREFERENCE_DEFAULTS, null)).not.toThrow();
  });
});

describe('tema y acento', () => {
  it('resuelve "auto" con el modo del dispositivo', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('el acento cambia según el tema', () => {
    expect(getAccentVars('violeta', 'light')).toEqual({ '--fp-brand': '#4C1D95', '--fp-accent': '#7C3AED' });
    expect(getAccentVars('violeta', 'dark')).toEqual({ '--fp-accent': '#8B5CF6' });
    expect(getAccentVars('no-existe', 'light')['--fp-accent']).toBe('#3B82F6');
  });

  it('arma atributos y estilo de la raíz', () => {
    const prefs = { ...PREFERENCE_DEFAULTS, highContrast: true, textSize: 'lg' };
    expect(getRootAttributes(prefs, 'dark')).toMatchObject({ 'data-fp-theme': 'dark', 'data-fp-contrast': 'high' });
    expect(getRootStyle(prefs, 'light')['--fp-zoom']).toBe('1.15');
  });
});
