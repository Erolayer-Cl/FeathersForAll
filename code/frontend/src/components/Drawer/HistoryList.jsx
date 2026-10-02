import { formatRelativeDay } from '../../utils/formatRelativeDay.js';
import styles from './Drawer.module.css';

/**
 * @param {{entries: {id: string, title: string, createdAt: number}[], onOpen: (id: string) => void}} props
 */
export function HistoryList({ entries, onOpen }) {
  return (
    <div className={styles.history}>
      <span className={styles.historyLabel} id="history-label">
        Historial de conversaciones
      </span>
      {entries.length === 0 ? (
        <span className={styles.historyEmpty}>Aún no hay nada guardado.</span>
      ) : (
        <ul className={styles.historyList} aria-labelledby="history-label">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" className={styles.historyItem} onClick={() => onOpen(entry.id)}>
                <span className={styles.historyTitle}>{entry.title}</span>
                <span className={styles.historyMeta}>{formatRelativeDay(entry.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
