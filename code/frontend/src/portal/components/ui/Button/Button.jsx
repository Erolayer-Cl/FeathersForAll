import styles from './Button.module.css';

/**
 * Botón del portal. `href` lo convierte en enlace.
 * @param {{variant?: 'primary'|'accent'|'ghost'|'soft'|'warn', size?: 'md'|'sm', block?: boolean, href?: string} & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ variant = 'primary', size = 'md', block = false, href, className = '', children, ...rest }) {
  const cls = `${styles.button} ${styles[variant]} ${size === 'sm' ? styles.sm : ''} ${block ? styles.block : ''} ${className}`;
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
