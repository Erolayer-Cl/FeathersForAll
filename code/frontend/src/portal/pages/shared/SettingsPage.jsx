import { useState } from 'react';
import { Button, Card, PageHead, Switch } from '../../components/ui/index.js';
import { ROLES } from '../../config/roles.js';
import { PREFERENCE_OPTIONS } from '../../preferences/preferences.js';
import { usePreferences } from '../../preferences/usePreferences.js';
import { useSession } from '../../session/useSession.js';
import styles from './SettingsPage.module.css';

/** Configuración (igual para los tres roles): perfil, notificaciones, apariencia y cuenta. */
export function SettingsPage({ role }) {
  const { user, signOut } = useSession();
  const { prefs, setPref, openPanel } = usePreferences();
  const [notify, setNotify] = useState(true); // ejemplo local: cuando haya API, vendrá del perfil

  return (
    <>
      <PageHead title="Configuración" subtitle="Administra tu perfil, preferencias y acceso a tu cuenta." />
      <div className={styles.grid}>
        <div className={styles.col}>
          <Card as="section">
            <h2>Perfil</h2>
            <div className={styles.row}>
              <div>
                <b>{user?.name}</b>
                <span className={styles.line}>{user?.email}</span>
                <span>
                  {ROLES[role].label} · {user?.school.name} (RBD {user?.school.rbd})
                </span>
              </div>
              {/* Aún no hay endpoints para editar el perfil ni cambiar la contraseña: se explica en vez de un botón muerto. */}
              <span className={styles.line}>Para corregir tus datos, pídeselo a tu colegio.</span>
            </div>
          </Card>

          <Card as="section">
            <h2>Preferencias</h2>
            <div className={styles.row}>
              <div>
                <b id="fp-set-notify">Notificaciones</b>
                <span>Recibir avisos sobre evaluaciones y novedades</span>
              </div>
              <Switch checked={notify} onChange={setNotify} labelledBy="fp-set-notify" />
            </div>
          </Card>

          <Card as="section">
            <h2>Apariencia</h2>
            <div className={styles.row}>
              <div>
                <b>Tema</b>
                <span>Claro, oscuro o según tu dispositivo</span>
              </div>
            </div>
            <div className={styles.seg} role="group" aria-label="Tema">
              {PREFERENCE_OPTIONS.theme.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={styles.choice}
                  aria-pressed={prefs.theme === opt.value}
                  onClick={() => setPref('theme', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className={styles.row}>
              <div>
                <b>Más opciones</b>
                <span>Color de acento, tamaño, tipografía, densidad y más</span>
              </div>
              <Button size="sm" onClick={openPanel}>
                Personalizar
              </Button>
            </div>
          </Card>
        </div>

        <Card as="section">
          <h2>Cuenta</h2>
          <div className={styles.account}>
            <b>Cambiar contraseña</b>
            <span>Por ahora la restablece tu colegio. Pronto podrás cambiarla desde aquí.</span>
          </div>
          <div className={styles.logout}>
            {/* Borra la sesión guardada; la guardia de rutas lleva al login. */}
            <Button variant="warn" block onClick={() => signOut()}>
              Cerrar sesión
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
