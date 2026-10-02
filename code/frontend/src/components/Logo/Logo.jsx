import styles from './Logo.module.css';

/**
 * Círculo con la pluma de FeathersForAll. El fondo toma el color suave del modo activo.
 * @param {{size?: number, className?: string}} props
 */
export function Logo({ size = 52, className = '' }) {
  return (
    <span className={`${styles.logo} ${className}`} style={{ '--logo-size': `${size}px` }} aria-hidden="true">
      <span className={styles.feather} />
    </span>
  );
}
