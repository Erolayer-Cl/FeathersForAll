import styles from './IconButton.module.css';

/**
 * Botón circular de 44px solo con icono (estilo "ghost" del sistema de diseño).
 * @param {{label: string, children: React.ReactNode} & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function IconButton({ label, children, className = '', ...rest }) {
  return (
    <button type="button" aria-label={label} className={`${styles.iconButton} ${className}`} {...rest}>
      {children}
    </button>
  );
}
