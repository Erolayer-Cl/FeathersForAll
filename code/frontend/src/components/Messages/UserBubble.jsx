import styles from './Messages.module.css';

/** @param {{text: string}} props */
export function UserBubble({ text }) {
  return <div className={styles.userBubble}>{text}</div>;
}
