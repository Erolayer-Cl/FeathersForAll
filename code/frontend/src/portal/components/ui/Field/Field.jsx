import styles from './Field.module.css';

/** Campo de formulario con etiqueta visible (y ayuda opcional). El control va dentro: <input>, <select> o <textarea>. */
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`${styles.field} ${className}`}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <small className={styles.hint}>{hint}</small>}
    </label>
  );
}

/** Mensaje de un formulario: `error` se anuncia como alerta; `success` y `info`, como estado. */
export function FormMessage({ tone = 'error', children }) {
  return (
    <p className={`${styles.message} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
