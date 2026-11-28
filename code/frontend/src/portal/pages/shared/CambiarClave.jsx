import { useState } from 'react';
import { changeMyPassword } from '../../../api/portalApi.js';
import { Button, Field, FormMessage } from '../../components/ui/index.js';
import { useSession } from '../../session/useSession.js';
import { MIN_CLAVE as MIN, problemaClave } from '../../utils/usuarios.js';
import styles from './SettingsPage.module.css';

/**
 * Cambiar la propia contraseña (v1.12, cualquier rol). El servidor entrega un token nuevo y deja vencidos los
 * anteriores: las demás sesiones abiertas de la cuenta (otro equipo) se cierran solas en su siguiente petición.
 */
export function CambiarClave() {
  const { token, user, expire, renew } = useSession();
  const [form, setForm] = useState({ actual: '', nueva: '', repetida: '' });
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    const problema = problemaClave(form, user?.email);
    if (problema) {
      setMensaje({ tone: 'error', text: problema });
      return;
    }
    setEnviando(true);
    setMensaje(null);
    try {
      renew(await changeMyPassword(token, form.actual, form.nueva));
      setForm({ actual: '', nueva: '', repetida: '' });
      setMensaje({ tone: 'success', text: 'Listo: cambiaste tu contraseña. Las sesiones abiertas en otros equipos se cerraron.' });
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      setMensaje({ tone: 'error', text: err.message || 'No se pudo cambiar la contraseña.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className={styles.account} onSubmit={enviar} aria-busy={enviando} noValidate>
      <b>Cambiar contraseña</b>
      <span>Usa al menos {MIN} caracteres. Al cambiarla se cierran tus sesiones en otros equipos.</span>
      <Field label="Contraseña actual">
        <input type="password" autoComplete="current-password" value={form.actual} onChange={set('actual')} maxLength={256} />
      </Field>
      <Field label="Contraseña nueva">
        <input type="password" autoComplete="new-password" value={form.nueva} onChange={set('nueva')} maxLength={256} />
      </Field>
      <Field label="Repite la contraseña nueva">
        <input type="password" autoComplete="new-password" value={form.repetida} onChange={set('repetida')} maxLength={256} />
      </Field>
      {mensaje && <FormMessage tone={mensaje.tone}>{mensaje.text}</FormMessage>}
      <Button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Cambiar contraseña'}</Button>
    </form>
  );
}
