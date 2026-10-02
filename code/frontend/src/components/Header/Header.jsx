import { Menu } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton.jsx';
import { Logo } from '../Logo/Logo.jsx';
import { ModeSwitch } from '../ModeSwitch/ModeSwitch.jsx';
import styles from './Header.module.css';

/**
 * @param {{
 *   mode: 'tutor' | 'aula', modeLabel: string, menuOpen: boolean,
 *   menuButtonRef: React.Ref<HTMLButtonElement>, onOpenMenu: () => void,
 *   onSelectMode: (mode: 'tutor' | 'aula') => void, onToggleMode: () => void,
 * }} props
 */
export function Header({ mode, modeLabel, menuOpen, menuButtonRef, onOpenMenu, onSelectMode, onToggleMode }) {
  return (
    <header className={styles.header}>
      <IconButton
        ref={menuButtonRef}
        label="Abrir menú"
        aria-expanded={menuOpen}
        aria-controls="app-drawer"
        onClick={onOpenMenu}
      >
        <Menu size={22} strokeWidth={2.75} />
      </IconButton>
      <Logo size={52} />
      <div className={styles.brand}>
        <span className={styles.brandName}>FeathersForAll.</span>
        <span className={styles.modeLabel}>{modeLabel}</span>
      </div>
      <ModeSwitch mode={mode} onSelect={onSelectMode} onToggle={onToggleMode} />
    </header>
  );
}
