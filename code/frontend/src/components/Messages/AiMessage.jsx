import { Check, Copy } from 'lucide-react';
import { Logo } from '../Logo/Logo.jsx';
import styles from './Messages.module.css';

/**
 * Respuesta del tutor con avatar. `isError` la marca como aviso (sin botón de copiar).
 * @param {{text: string, isError?: boolean, streaming?: boolean, copied?: boolean, onCopy?: () => void}} props
 */
export function AiMessage({ text, isError = false, streaming = false, copied = false, onCopy }) {
  return (
    <div className={styles.aiRow}>
      <Logo size={40} className={styles.avatar} />
      <div className={styles.aiColumn}>
        <div className={isError ? `${styles.aiBubble} ${styles.errorBubble}` : styles.aiBubble} role={isError ? 'alert' : undefined}>
          {text}
        </div>
        {!isError && !streaming && onCopy && (
          <button type="button" className={styles.copyButton} onClick={onCopy} aria-label="Copiar respuesta">
            {copied ? <Check size={15} strokeWidth={2.75} /> : <Copy size={15} strokeWidth={2.75} />}
            <span aria-live="polite">{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
