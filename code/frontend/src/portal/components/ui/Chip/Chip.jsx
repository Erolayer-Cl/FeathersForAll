import styles from './Chip.module.css';

/** Etiqueta pequeña. `tone`: success | warning | danger | accent | neutral. `solid` = fondo de superficie (para usarla sobre fondos de color). */
export function Chip({ tone = 'success', solid = false, children }) {
  return <span data-fp-surface="" className={`${styles.chip} ${styles[tone]} ${solid ? styles.solid : ''}`}>{children}</span>;
}
