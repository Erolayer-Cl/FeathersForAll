import styles from './ModeSwitch.module.css';

/**
 * Selector Tutor ↔ Aula virtual. Las etiquetas eligen un modo; el interruptor alterna.
 * @param {{mode: 'tutor' | 'aula', onSelect: (mode: 'tutor' | 'aula') => void, onToggle: () => void}} props
 */
export function ModeSwitch({ mode, onSelect, onToggle }) {
  const isAula = mode === 'aula';
  return (
    <div className={styles.modeSwitch}>
      <button type="button" className={styles.label} aria-pressed={!isAula} onClick={() => onSelect('tutor')}>
        Tutor
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={isAula}
        aria-label="Cambiar entre modo tutor y aula virtual"
        className={styles.track}
        onClick={onToggle}
      >
        <span className={styles.knob} data-on={isAula} />
      </button>
      <button type="button" className={styles.label} aria-pressed={isAula} onClick={() => onSelect('aula')}>
        Aula virtual
      </button>
    </div>
  );
}
