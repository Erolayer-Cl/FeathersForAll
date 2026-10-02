import styles from './Messages.module.css';

/** Tres puntos animados mientras el tutor prepara la respuesta. */
export function TypingIndicator() {
  return (
    <div className={styles.typing} role="status" aria-label="El tutor está escribiendo">
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </div>
  );
}
