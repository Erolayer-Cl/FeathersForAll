import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PreferencesContext } from './PreferencesContext.js';
import {
  PREFERENCE_DEFAULTS,
  loadPreferences,
  resolveTheme,
  sanitizePreferences,
  savePreferences,
} from './preferences.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemTheme(onChange) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
const getSystemDark = () => window.matchMedia(DARK_QUERY).matches;

/** Guarda las preferencias (en localStorage) y expone tema resuelto + estado del panel. */
export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(() => loadPreferences());
  const [panelOpen, setPanelOpen] = useState(false);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemDark, () => false);

  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  const setPref = useCallback((key, value) => {
    setPrefs((current) => sanitizePreferences({ ...current, [key]: value }));
  }, []);
  const resetPrefs = useCallback(() => setPrefs({ ...PREFERENCE_DEFAULTS }), []);
  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const value = useMemo(
    () => ({
      prefs,
      resolvedTheme: resolveTheme(prefs.theme, systemDark),
      setPref,
      resetPrefs,
      panelOpen,
      openPanel,
      closePanel,
    }),
    [prefs, systemDark, setPref, resetPrefs, panelOpen, openPanel, closePanel],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
