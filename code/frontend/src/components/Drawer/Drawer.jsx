import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton.jsx';
import styles from './Drawer.module.css';

/**
 * Panel lateral izquierdo con fondo oscurecido.
 * Accesible: Escape y clic afuera lo cierran; al abrir enfoca "Cerrar" y al cerrar
 * devuelve el foco a `returnFocusRef`. Cerrado queda `inert` (fuera del tab y del lector).
 * @param {{
 *   id: string, open: boolean, title: string, onClose: () => void,
 *   returnFocusRef?: React.RefObject<HTMLElement>, children: React.ReactNode,
 * }} props
 */
export function Drawer({ id, open, title, onClose, returnFocusRef, children }) {
  const closeRef = useRef(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) returnFocusRef?.current?.focus();
    wasOpen.current = open;
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div className={styles.backdrop} data-open={open} onClick={onClose} aria-hidden="true" />
      <aside
        id={id}
        className={styles.panel}
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        inert={!open}
      >
        <div className={styles.panelHeader}>
          <IconButton ref={closeRef} label="Cerrar menú" onClick={onClose}>
            <X size={22} strokeWidth={2.75} />
          </IconButton>
          <span className={styles.title}>{title}</span>
        </div>
        {children}
      </aside>
    </>
  );
}
