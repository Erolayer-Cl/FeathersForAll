import { Logo } from '../Logo/Logo.jsx';
import styles from './EmptyState.module.css';

/**
 * Portada centrada: logo, etiqueta, título e introducción. Opcionalmente sugerencias
 * y un contenido debajo (en el chat vacío, el Composer).
 * @param {{
 *   label: string, greeting: string, intro: string, suggestions?: string[],
 *   onPickSuggestion?: (text: string) => void, disabled?: boolean, children?: React.ReactNode,
 * }} props
 */
export function EmptyState({ label, greeting, intro, suggestions = [], onPickSuggestion, disabled = false, children }) {
  return (
    <section className={styles.emptyState}>
      <Logo size={112} className={styles.logo} />
      <span className={styles.tag}>{label}</span>
      <h1 className={styles.greeting}>{greeting}</h1>
      <p className={styles.intro}>{intro}</p>
      {suggestions.length > 0 && (
        <div className={styles.suggestions}>
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              className={styles.chip}
              disabled={disabled}
              onClick={() => onPickSuggestion(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      {children && <div className={styles.composerSlot}>{children}</div>}
    </section>
  );
}
