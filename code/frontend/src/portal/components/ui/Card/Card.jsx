import styles from './Card.module.css';

/** Contenedor con fondo de superficie. `as` cambia la etiqueta (section, article…). */
export function Card({ as: Tag = 'div', tight = false, className = '', children, ...rest }) {
  return (
    <Tag className={`${styles.card} ${tight ? styles.tight : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
