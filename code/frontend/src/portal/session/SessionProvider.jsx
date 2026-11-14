import { useCallback, useEffect, useMemo, useState } from 'react';
import { login } from '../../api/portalApi.js';
import { SessionContext } from './SessionContext.js';
import { clearSession, loadSession, portalRoleOf, signInWith } from './session.js';

const AVISO_VENCIDA = 'Tu sesión expiró. Vuelve a iniciar sesión.';

/** Inicia y cierra la sesión (POST /v1/auth/login) y la cierra sola cuando vence el token. */
export function SessionProvider({ children }) {
  const [session, setSession] = useState(() => loadSession());
  // Aviso que muestra el login (por ejemplo, que la sesión expiró).
  const [notice, setNotice] = useState(null);

  // `expectedRole`: rol de la pestaña de acceso. Si la cuenta es de otro rol, lanza RoleMismatchError y NO guarda
  // la sesión (el token se descarta): así nadie termina en un portal distinto del que eligió sin darse cuenta.
  const signIn = useCallback(async ({ rbd, email, password, remember }, { expectedRole } = {}) => {
    const next = await signInWith(login, { rbd, email, password, remember }, { expectedRole }); // RoleMismatchError: no guarda nada
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
