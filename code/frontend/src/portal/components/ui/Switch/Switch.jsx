import styles from './Switch.module.css';

/** Interruptor accesible (role="switch"). */
export function Switch({ checked, onChange, labelledBy, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    />
  );
}
