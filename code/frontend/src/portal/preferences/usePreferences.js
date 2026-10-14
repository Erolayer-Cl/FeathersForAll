import { useContext } from 'react';
import { PreferencesContext } from './PreferencesContext.js';

/**
 * @returns {{
 *   prefs: import('./preferences.js').PREFERENCE_DEFAULTS,
 *   resolvedTheme: 'light' | 'dark',
 *   setPref: (key: string, value: unknown) => void,
 *   resetPrefs: () => void,
 *   panelOpen: boolean,
 *   openPanel: () => void,
 *   closePanel: () => void,
 * }}
 */
export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>.');
  return ctx;
}
