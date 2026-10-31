import { useContext } from 'react';
import { SessionContext } from './SessionContext.js';

/**
 * @returns {{
 *   session: {token: string, expiresAt: number, user: object} | null,
 *   user: {id: string, name: string, email: string, role: string, school: {id: string, name: string, rbd: string}} | null,
 *   token: string | null,
 *   portalRole: 'est' | 'doc' | 'adm' | null,
 *   notice: string | null,
 *   signIn: (credentials: {rbd: string, email: string, password: string, remember: boolean}) => Promise<object>,
 *   signOut: (notice?: string | null) => void,
 *   expire: () => void,
 * }}
 */
export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>.');
  return ctx;
}
