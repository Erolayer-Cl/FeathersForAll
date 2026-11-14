import { useRef } from 'react';

/**
 * Clave de idempotencia de un formulario (UUID). Se mantiene mientras el envío no tenga una respuesta definitiva:
 * si la red falla y la persona reintenta, viaja la MISMA clave y el servidor no crea el recurso dos veces.
 * Con cualquier respuesta del servidor (éxito o error de la API) se llama `renew()` para la siguiente operación.
 * @returns {{ get: () => string, renew: () => void }}
 */
export function useIdempotencyKey() {
  const ref = useRef(null);
  return {
    get: () => {
      ref.current ??= crypto.randomUUID();
      return ref.current;
    },
    renew: () => {
      ref.current = null;
    },
  };
}
