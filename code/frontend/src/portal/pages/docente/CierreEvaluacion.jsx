import { useState } from 'react';
import { patchAssessment } from '../../../api/portalApi.js';
import { Button, Card, Field, FormMessage } from '../../components/ui/index.js';
import { useNow } from '../../hooks/useNow.js';
import { useSession } from '../../session/useSession.js';
import { formatCierre, formatDuracion } from '../../utils/fechas.js';
import gestion from './Gestion.module.css';
import styles from './CierreEvaluacion.module.css';

const DURACIONES = [30, 45, 60, 90, 120, 180, 24 * 60];
const MINUTOS = [0, 5, 10, 15, 20, 30, 40, 45, 50];
const dos = (n) => String(n).padStart(2, '0');
const fechaLocal = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const horaLocal = (d) => `${dos(d.getHours())}:${dos(d.getMinutes())}`;

/** Sugerencia para "día y hora": dentro de 2 horas, redondeado a la media hora siguiente. */
function sugerencia(ahora) {
  const d = new Date(ahora + 2 * 3600 * 1000);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60, 0, 0);
  return { dia: fechaLocal(d), hora: horaLocal(d) };
}

/**
 * Elegir cuándo se cierra una evaluación (v1.9). Se usa al publicar (`modo="publicar"`) y para cambiar el cierre de
 * una ya publicada (`modo="cambiar"`). Opciones: una duración desde ahora (una prueba de 90 minutos), un día y una
 * hora (el jueves a las 11:59 p. m.), sin cierre automático o, al publicar, mantener la que se guardó en el borrador.
 */
export function CierreEvaluacion({ ev, modo, onListo, onCancelar }) {
  const { token, expire } = useSession();
  const ahora = useNow(15_000);
  const cierreBorrador = ev.closes_at && new Date(ev.closes_at).getTime() > ahora ? ev.closes_at : null;
  const [opcion, setOpcion] = useState(modo === 'publicar' && cierreBorrador ? 'borrador' : 'duracion');
  const [horas, setHoras] = useState(1);
  const [minutos, setMinutos] = useState(30);
  const [dia, setDia] = useState(() => sugerencia(Date.now()).dia);
  const [hora, setHora] = useState(() => sugerencia(Date.now()).hora);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const duracion = Number(horas) * 60 + Number(minutos);
  const elegida = { duracion: duracion > 0 ? new Date(ahora + duracion * 60000) : null, fecha: dia && hora ? new Date(`${dia}T${hora}`) : null }[opcion];
  const valida = elegida && !Number.isNaN(elegida.getTime()) && elegida.getTime() > ahora;

  const resumen = {
    borrador: cierreBorrador && `Se cerrará ${formatCierre(cierreBorrador, ahora)}, como dejaste en el borrador.`,
    duracion: duracion > 0 ? `Tus estudiantes tendrán ${formatDuracion(duracion)}: se cerrará ${formatCierre(elegida, ahora)} si ${modo === 'publicar' ? 'publicas' : 'guardas'} ahora.` : 'Elige una duración de al menos 1 minuto.',
    fecha: valida ? `Se cerrará ${formatCierre(elegida, ahora)} (hora de Chile).` : 'Elige un día y una hora que todavía no hayan pasado.',
    ninguno: 'No se cerrará sola: la cierras tú con «Cerrar evaluación».',
  }[opcion];

  async function confirmar(e) {
    e.preventDefault();
    if ((opcion === 'duracion' || opcion === 'fecha') && !valida) return setError(resumen);
    // La duración se cuenta desde el momento de enviar, no desde que se abrió el panel.
    const closesAt = opcion === 'duracion' ? new Date(Date.now() + duracion * 60000).toISOString()
      : opcion === 'fecha' ? elegida.toISOString()
        : opcion === 'ninguno' ? null : undefined;
    const cambios = { ...(modo === 'publicar' && { status: 'published' }), ...(closesAt !== undefined && { closes_at: closesAt }) };
    setEnviando(true);
    setError(null);
    try {
      onListo(await patchAssessment(token, ev.id, cambios));
    } catch (err) {
      if (err.status === 401) expire();
      else setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const radio = (valor, titulo, ayuda) => (
    <label className={`${styles.opcion} ${opcion === valor ? styles.elegida : ''}`}>
      <input type="radio" name="cierre" value={valor} checked={opcion === valor} onChange={() => { setOpcion(valor); setError(null); }} />
      <span><b>{titulo}</b><small>{ayuda}</small></span>
    </label>
  );

  return (
    <Card as="section" aria-labelledby="cierre-titulo" className={styles.panel}>
      <h2 id="cierre-titulo" className={gestion.h2}>{modo === 'publicar' ? '¿Cuándo se cierra la evaluación?' : 'Cambiar la hora de cierre'}</h2>
      <p className={gestion.sub}>
        {modo === 'publicar'
          ? 'Al publicarla, tus estudiantes podrán rendirla y ya no podrás editar sus preguntas.'
          : 'Puedes extender o adelantar el plazo. Si ya había vencido, extenderlo la vuelve a abrir.'}
      </p>
      <form onSubmit={confirmar} className={styles.form}>
        <fieldset className={styles.opciones}>
          <legend className={styles.sr}>Tipo de cierre</legend>
          {modo === 'publicar' && cierreBorrador && radio('borrador', 'La del borrador', formatCierre(cierreBorrador, ahora))}
          {radio('duracion', 'Por tiempo', 'Ej.: una prueba de 90 minutos')}
          {radio('fecha', 'Un día y una hora', 'Ej.: el jueves a las 11:59 p. m.')}
          {radio('ninguno', 'Sin cierre automático', 'La cierras tú cuando quieras')}
        </fieldset>

        {opcion === 'duracion' && (
          <div className={styles.detalle}>
            <div className={styles.chips} role="group" aria-label="Duraciones frecuentes">
              {DURACIONES.map((m) => (
                <button key={m} type="button" className={`${styles.chip} ${duracion === m ? styles.chipActivo : ''}`} aria-pressed={duracion === m}
                  onClick={() => { setHoras(Math.floor(m / 60)); setMinutos(m % 60); }}>
                  {formatDuracion(m)}
                </button>
              ))}
            </div>
            <div className={styles.fila}>
              <Field label="Horas">
                <input type="number" min={0} max={168} value={horas} onChange={(e) => setHoras(Math.max(0, Math.min(168, Number(e.target.value) || 0)))} />
              </Field>
              <Field label="Minutos">
                <select value={minutos} onChange={(e) => setMinutos(Number(e.target.value))}>
                  {[...new Set([...MINUTOS, minutos])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
          </div>
        )}

        {opcion === 'fecha' && (
          <div className={`${styles.detalle} ${styles.fila}`}>
            <Field label="Día">
              <input type="date" value={dia} min={fechaLocal(new Date(ahora))} onChange={(e) => setDia(e.target.value)} required />
            </Field>
            <Field label="Hora" hint="Formato de tu equipo (a. m. / p. m.)">
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required />
            </Field>
          </div>
        )}

        <p className={styles.resumen} aria-live="polite">{resumen}</p>
        {error && <FormMessage>{error}</FormMessage>}
        <div className={gestion.actions}>
          <Button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : modo === 'publicar' ? 'Publicar' : 'Guardar cierre'}</Button>
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}
