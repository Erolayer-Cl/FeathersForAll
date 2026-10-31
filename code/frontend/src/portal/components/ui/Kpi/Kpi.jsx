import styles from './Kpi.module.css';

/** Tarjeta de indicador. `tone` (accent, success, warning, danger): color de la franja lateral y del subtítulo. */
export function Kpi({ label, value, hint, tone = 'accent' }) {
  return (
    <div data-fp-surface="" className={`${styles.kpi} ${styles[tone]}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
