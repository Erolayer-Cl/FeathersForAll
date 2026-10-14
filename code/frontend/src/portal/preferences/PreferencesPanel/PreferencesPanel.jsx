import { useEffect, useRef } from 'react';
import { Icon } from '../../components/icons.jsx';
import { Button, Switch } from '../../components/ui/index.js';
import { ACCENTS, PREFERENCE_OPTIONS } from '../preferences.js';
import { usePreferences } from '../usePreferences.js';
import styles from './PreferencesPanel.module.css';

const THEME_ICONS = { light: 'sun', dark: 'moon', auto: 'monitor' };

/** Grupo de botones excluyentes (como un selector de opciones). */
function Choice({ name, label, className = '', withIcons = false, optionStyle }) {
  const { prefs, setPref } = usePreferences();
  return (
    <div className={`${styles.seg} ${className}`} role="group" aria-label={label}>
      {PREFERENCE_OPTIONS[name].map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={styles.choice}
          aria-pressed={prefs[name] === opt.value}
          style={optionStyle?.(opt.value)}
          onClick={() => setPref(name, opt.value)}
        >
          {withIcons && <Icon name={THEME_ICONS[opt.value]} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ id, title, hint, prefKey }) {
  const { prefs, setPref } = usePreferences();
  return (
    <div className={styles.toggleRow}>
      <div>
        <b id={id}>{title}</b>
        <span>{hint}</span>
      </div>
      <Switch checked={prefs[prefKey]} onChange={(v) => setPref(prefKey, v)} labelledBy={id} />
    </div>
  );
}

const FONT_SAMPLE = {
  legible: { fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  sistema: { fontFamily: 'system-ui, sans-serif' },
};

/** Panel lateral "Personalizar". Se abre con openPanel() de usePreferences(). */
export function PreferencesPanel() {
  const { prefs, setPref, resetPrefs, panelOpen, closePanel } = usePreferences();
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  // Foco: al abrir va al botón de cerrar; al cerrar vuelve a quien lo abrió. Escape cierra; Tab queda dentro.
  useEffect(() => {
    if (!panelOpen) return undefined;
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') return closePanel();
      if (e.key !== 'Tab') return undefined;
      const focusable = panelRef.current?.querySelectorAll('button:not([disabled])');
      if (!focusable?.length) return undefined;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return undefined;
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [panelOpen, closePanel]);

  return (
    <>
      <div className={styles.backdrop} data-open={panelOpen} onClick={closePanel} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={styles.panel}
        data-open={panelOpen}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fp-prefs-title"
        inert={!panelOpen}
      >
        <div className={styles.head}>
          <div>
            <h2 id="fp-prefs-title">Personalizar</h2>
            <small>Ajusta la interfaz a tu gusto</small>
          </div>
          <button ref={closeRef} type="button" className={styles.close} onClick={closePanel} aria-label="Cerrar personalización">
            <Icon name="close" size={22} />
          </button>
        </div>

        <div className={styles.body}>
          <section>
            <h3>Tema</h3>
            <Choice name="theme" label="Tema" className={styles.themes} withIcons />
          </section>

          <section>
            <h3>Color de acento</h3>
            <div className={styles.swatches} role="group" aria-label="Color de acento">
              {Object.entries(ACCENTS).map(([id, a]) => (
                <button
                  key={id}
                  type="button"
                  className={styles.swatch}
                  style={{ '--sw': a.light[1] }}
                  aria-label={a.label}
                  aria-pressed={prefs.accent === id}
                  onClick={() => setPref('accent', id)}
                >
                  <Icon name="tick" />
                </button>
              ))}
            </div>
            <div className={styles.swatchNames} aria-hidden="true">
              {Object.values(ACCENTS).map((a) => (
                <span key={a.label}>{a.label}</span>
              ))}
            </div>
          </section>

          <section>
            <h3>Tamaño del contenido</h3>
            <Choice name="textSize" label="Tamaño del contenido" />
          </section>
          <section>
            <h3>Tipografía</h3>
            <Choice name="font" label="Tipografía" optionStyle={(v) => FONT_SAMPLE[v]} />
          </section>
          <section>
            <h3>Densidad</h3>
            <Choice name="density" label="Densidad" />
          </section>
          <section>
            <h3>Esquinas</h3>
            <Choice name="radius" label="Estilo de esquinas" />
          </section>
          <section>
            <h3>Menú lateral</h3>
            <Choice name="menu" label="Menú lateral" />
            <p className={styles.note}>«Solo íconos» se aplica en pantallas anchas.</p>
          </section>
          <section>
            <h3>Accesibilidad</h3>
            <ToggleRow id="fp-pt-motion" prefKey="reduceMotion" title="Reducir animaciones" hint="Menos movimiento en transiciones y entradas." />
            <ToggleRow id="fp-pt-contrast" prefKey="highContrast" title="Alto contraste" hint="Textos y bordes más marcados." />
          </section>
        </div>

        <div className={styles.foot}>
          <small>Se guarda en este navegador.</small>
          <Button variant="soft" size="sm" onClick={resetPrefs}>
            Restablecer
          </Button>
        </div>
      </aside>
    </>
  );
}
