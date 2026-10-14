import styles from './PageHead.module.css';

/** Título de página con subtítulo y espacio para acciones (buscador, filtros…). */
export function PageHead({ title, subtitle, children }) {
  return (
    <header className={styles.head}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.sub}>{subtitle}</p>}
      </div>
      {children && <div className={styles.tools}>{children}</div>}
    </header>
  );
}
