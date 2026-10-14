import { useCallback, useEffect, useState } from 'react';
import { checkTutorHealth } from '../api/tutorApi.js';

/** ¿Está disponible la IA? 'checking' | 'up' | 'down'. `recheck()` vuelve a consultar (p. ej. tras un error). */
export function useTutorStatus() {
  const [status, setStatus] = useState('checking');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    checkTutorHealth({ signal: controller.signal }).then((up) => {
      if (!controller.signal.aborted) setStatus(up ? 'up' : 'down');
    });
    return () => controller.abort();
  }, [tick]);

  const recheck = useCallback(() => setTick((n) => n + 1), []);
  return { status, recheck };
}
