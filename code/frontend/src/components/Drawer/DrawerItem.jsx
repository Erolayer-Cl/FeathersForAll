import styles from './Drawer.module.css';

/**
 * Fila del menú con icono (Pruebas, Inicio, Mis cursos, Notas, Configuración).
 * @param {{icon: React.ComponentType<any>, label: string, active?: boolean, tone?: 'accent' | 'accent2', onClick: () => void}} props
 */
export function DrawerItem({ icon: Icon, label, active = false, tone = 'accent', onClick }) {
  return (
    <button
      type="button"
      className={styles.item}
      data-tone={tone}
      data-active={active}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={2.75} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
