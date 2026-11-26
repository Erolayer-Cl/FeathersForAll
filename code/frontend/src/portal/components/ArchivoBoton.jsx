import { useRef } from 'react';
import { ARCHIVO_EXTENSIONES } from '../../api/portalApi.js';
import { Button } from './ui/index.js';

/** Botón que abre el selector de archivos (un archivo). `onFile(file)` recibe el elegido. */
export function ArchivoBoton({ onFile, disabled, children, variant = 'primary', label }) {
  const ref = useRef(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        hidden
        accept={ARCHIVO_EXTENSIONES.join(',')}
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button size="sm" variant={variant} disabled={disabled} onClick={() => ref.current?.click()}>{children}</Button>
    </>
  );
}
