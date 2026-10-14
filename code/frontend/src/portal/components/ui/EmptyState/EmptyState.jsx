import styles from './EmptyState.module.css';

/** Aviso cuando una lista aún no tiene elementos (cursos, evaluaciones, notas…). `action` = botón opcional. */
export function EmptyState({ title, children, action }) {
  return (
    <div className={styles.empty}>
      {title && <b>{title}</b>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
