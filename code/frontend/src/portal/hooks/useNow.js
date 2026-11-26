import { useEffect, useState } from 'react';

/** La hora actual (ms), refrescada cada `cadaMs`: sirve para que un plazo se cierre solo en pantalla. */
export function useNow(cadaMs = 30_000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}
