import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearCache } from '../../api/cache.js';
import { login } from '../../api/portalApi.js';
import { SessionContext } from './SessionContext.js';
import { clearSession, isSessionChange, loadSession, portalRoleOf, signInWith } from './session.js';

const AVISO_VENCIDA = 'Tu sesión expiró. Vuelve a iniciar sesión.';
const AVISO_OTRA_PESTANA = 'Cerraste sesión en otra pestaña.';

/**
 * Inicia y cierra la sesión (POST /v1/auth/login), la cierra sola cuando vence el token y la
 * mantiene igual en todas las pestañas que usan la sesión recordada (localStorage).
 * Cada cambio de sesión vacía la caché de respuestas (api/cache.js): nadie ve datos del usuario anterior.
 */
export function SessionProvider({ children }) {
  const [session, setSession] = useState(() => loadSession());
  // Aviso que muestra el login (por ejemplo, que la sesión expiró).
  const [notice, setNotice] = useState(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // `expectedRole`: rol de la pestaña de acceso. Si la cuenta es de otro rol, lanza RoleMismatchError y NO guarda
  // la sesión (el token se descarta): así nadie termina en un portal distinto del que eligió sin darse cuenta.
  const signIn = useCallback(async ({ rbd, email, password, remember }, { expectedRole } = {}) => {
    const next = await signInWith(login, { rbd, email, password, remember }, { expectedRole }); // RoleMismatchError: no guarda nada
    clearCache();
    setNotice(null);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback((message = null) => {
    clearSession();
    clearCache();
    setNotice(message);
    setSession(null);
  }, []);

  // La API respondió 401 o el token venció: se vuelve al login con un aviso.
  const expire = useCallback(() => signOut(AVISO_VENCIDA), [signOut]);

  useEffect(() => {
    if (!session) return undefined;
    const timer = setTimeout(expire, Math.max(session.expiresAt - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [session, expire]);

  // Otra pestaña inició o cerró la sesión recordada: esta pestaña la sigue.
  useEffect(() => {
    function onStorage(event) {
      const next = loadSession();
      if (!isSessionChange(event, sessionRef.current, next)) return;
      clearCache();
      setNotice(next ? null : AVISO_OTRA_PESTANA);
      setSession(next);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      token: session?.token ?? null,
      portalRole: portalRoleOf(session?.user),
      notice,
      signIn,
      signOut,
      expire,
    }),
    [session, notice, signIn, signOut, expire],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
