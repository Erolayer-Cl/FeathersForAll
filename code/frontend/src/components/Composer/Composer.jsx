import { ArrowUp } from 'lucide-react';
import styles from './Composer.module.css';

/**
 * Barra para escribir y enviar. Enter envía.
 * @param {{
 *   value: string, onChange: (value: string) => void, onSubmit: (text: string) => void,
 *   placeholder: string, disabled?: boolean, className?: string,
 * }} props
 */
export function Composer({ value, onChange, onSubmit, placeholder, disabled = false, className = '' }) {
  const cantSend = disabled || !value.trim();

  function handleSubmit(event) {
    event.preventDefault();
    if (!cantSend) onSubmit(value);
  }

  return (
    <form className={`${styles.composer} ${className}`} onSubmit={handleSubmit}>
      <label className="visually-hidden" htmlFor="composer-input">
        Mensaje
      </label>
      <input
        id="composer-input"
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={4000}
        autoComplete="off"
        autoFocus
      />
      <button type="submit" className={styles.send} aria-label="Enviar" disabled={cantSend}>
        <ArrowUp size={20} strokeWidth={2.75} />
      </button>
    </form>
  );
}
