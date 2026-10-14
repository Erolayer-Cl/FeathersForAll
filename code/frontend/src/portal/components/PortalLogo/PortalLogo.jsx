import styles from './PortalLogo.module.css';

/** Círculo con la pluma de FeathersForAll (reutiliza src/assets/pluma.svg como máscara). */
export function PortalLogo({ size = 48, className = '' }) {
  return (
    <span className={`${styles.logo} ${className}`} style={{ '--fp-logo-size': `${size}px` }} aria-hidden="true">
      <span className={styles.feather} />
    </span>
  );
}
