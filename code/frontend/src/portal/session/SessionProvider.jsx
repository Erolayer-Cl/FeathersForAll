import { useCallback, useEffect, useMemo, useState } from 'react';
import { login } from '../../api/portalApi.js';
import { SessionContext } from './SessionContext.js';
import { clearSession, loadSession, portalRoleOf, saveLastRbd, saveSession, sessionFromLogin } from './session.js';

const AVISO_VENCIDA = 'Tu sesión expiró. Vuelve a iniciar sesión.';

/** Inicia y cierra la sesión (POST /v1/auth/login) y la cierra sola cuando vence el token. */
export function SessionProvider({ children }) {
  const [session, setSession] = useState(() => loadSession());
  // Aviso que muestra el login (por ejemplo, que la sesión expiró).
  const [notice, setNotice] = useState(null);

  const signIn = useCallback(async ({ rbd, email, password, remember }) => {
    const next = sessionFromLogin(await login({ rbd, email, password }));
    saveSession(next, { remember });
    saveLastRbd(rbd);
    setNotice(null);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback((message = null) => {
    clearSession();
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
