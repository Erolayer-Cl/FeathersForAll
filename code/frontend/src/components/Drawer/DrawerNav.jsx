import styles from './Drawer.module.css';

/** Contenedor que ocupa el espacio libre del menú (empuja "Configuración" al fondo). */
export function DrawerNav({ label, children }) {
  return (
    <nav className={styles.nav} aria-label={label}>
      {children}
    </nav>
  );
}
