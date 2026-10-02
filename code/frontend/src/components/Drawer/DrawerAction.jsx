import styles from './Drawer.module.css';

/**
 * Botón principal de ancho completo del menú (p. ej. "Nueva conversación").
 * @param {{icon: React.ComponentType<any>, label: string, onClick: () => void}} props
 */
export function DrawerAction({ icon: Icon, label, onClick }) {
  return (
    <button type="button" className={styles.primary} onClick={onClick}>
      <Icon size={18} strokeWidth={2.75} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
