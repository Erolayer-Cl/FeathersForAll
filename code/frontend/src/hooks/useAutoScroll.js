import { useEffect, useRef } from 'react';

/** Mantiene el contenedor desplazado al final cada vez que cambia `dependency`. */
export function useAutoScroll(dependency) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dependency]);

  return ref;
}
