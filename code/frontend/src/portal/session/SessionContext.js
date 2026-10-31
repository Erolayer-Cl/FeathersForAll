import { createContext } from 'react';

/** Contexto de la sesión. Se usa con useSession(); lo llena SessionProvider. */
export const SessionContext = createContext(null);
