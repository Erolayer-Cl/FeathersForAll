// Fechas y horas de cierre en hora de Chile, con a. m. / p. m. (evaluaciones y tareas).
const ZONA = 'America/Santiago';
const HORA = new Intl.DateTimeFormat('es-CL', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZone: ZONA });
const DIA = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: ZONA });
const DIA_ANIO = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: ZONA });
const CLAVE_DIA = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONA });
const ANIO = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: ZONA });

// Intl usa espacios finos/duros en "p. m."; se normalizan para que se vea y se pruebe igual en todos los navegadores.
const limpio = (s) => s.replace(/[\u202f\u00a0]/g, ' ');

/** "11:59 p. m." en hora de Chile. */
export const formatHora = (iso) => limpio(HORA.format(new Date(iso)));

/**
 * Cuándo cierra, corto y claro: "hoy, 11:59 p. m.", "mañana, 9:00 a. m.", "jue, 3 dic, 11:59 p. m."
 * (y "3 dic 2027, …" si es de otro año). `null` si no tiene cierre.
 */
export function formatCierre(iso, ahora = Date.now()) {
  if (!iso) return null;
  const d = new Date(iso);
  const dia = CLAVE_DIA.format(d);
  const hoy = CLAVE_DIA.format(new Date(ahora));
  const manana = CLAVE_DIA.format(new Date(ahora + 24 * 3600 * 1000));
  const ayer = CLAVE_DIA.format(new Date(ahora - 24 * 3600 * 1000));
  let fecha;
  if (dia === hoy) fecha = 'hoy';
  else if (dia === manana) fecha = 'mañana';
  else if (dia === ayer) fecha = 'ayer';
  else if (ANIO.format(d) !== ANIO.format(new Date(ahora))) fecha = DIA_ANIO.format(d);
  else fecha = DIA.format(d);
  return `${limpio(fecha)}, ${formatHora(iso)}`;
}

/** Cuánto falta, en palabras: "Quedan 2 días", "Quedan 3 h 5 min", "Queda menos de 1 min" o "Cerrada". */
export function tiempoRestante(iso, ahora = Date.now()) {
  const ms = new Date(iso).getTime() - ahora;
  if (!(ms > 0)) return 'Cerrada';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Queda menos de 1 min';
  if (min < 60) return `Quedan ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Quedan ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `Quedan ${d} día${d === 1 ? '' : 's'}`;
}

/** Tono del aviso de plazo: amarillo el último día, verde antes, neutro si ya cerró. */
export function tonoPlazo(iso, ahora = Date.now()) {
  const ms = new Date(iso).getTime() - ahora;
  if (!(ms > 0)) return 'neutral';
  return ms < 24 * 3600 * 1000 ? 'warning' : 'success';
}

/** "90 min", "2 h", "1 h 30 min" para una duración en minutos. */
export function formatDuracion(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
