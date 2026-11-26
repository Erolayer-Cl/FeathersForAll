// Ayudas puras para material y tareas (v1.8): fechas en hora de Chile, plazo restante y validación de archivos.
import { ARCHIVO_EXTENSIONES, MAX_ARCHIVO_BYTES } from '../../api/portalApi.js';
import { formatCierre, tiempoRestante, tonoPlazo } from './fechas.js';

export { tiempoRestante };

/** "mié, 3 dic, 11:59 p. m." (o "hoy, …" / "mañana, …") en hora de Chile. */
export const formatFechaHora = (iso) => (iso ? formatCierre(iso) : '—');

/** "230 KB", "1,4 MB". */
export function formatTamano(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`;
}

/** ¿Sigue abierta? Usa la hora local para que la pantalla se cierre sola; el servidor tiene la última palabra. */
export const tareaAbierta = (tarea, ahora = Date.now()) => tarea.is_open && new Date(tarea.due_at).getTime() > ahora;

/** Estado para mostrar en un Chip. */
export function estadoTarea(tarea, ahora = Date.now()) {
  if (!tareaAbierta(tarea, ahora)) return { label: 'Cerrada', tone: 'neutral' };
  return { label: tiempoRestante(tarea.due_at, ahora), tone: tonoPlazo(tarea.due_at, ahora) };
}

const extension = (nombre) => (nombre.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();

/** Motivo por el que un archivo no sirve (o null si sirve). Igual que lo que revisa el backend, antes de enviarlo. */
export function motivoRechazoArchivo(file) {
  if (!ARCHIVO_EXTENSIONES.includes(extension(file.name))) return 'Formato no permitido. Usa PDF, Word, PowerPoint, Excel, OpenDocument, TXT, MD, JPG, PNG o ZIP.';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > MAX_ARCHIVO_BYTES) return `Pesa más de ${MAX_ARCHIVO_BYTES / 1024 / 1024} MB.`;
  if (/[\\/:*?"<>|]/.test(file.name)) return 'El nombre del archivo tiene caracteres no permitidos (\\ / : * ? " < > |).';
  return null;
}

const dos = (n) => String(n).padStart(2, '0');

/** Valor para <input type="datetime-local"> (hora del navegador) a partir de una fecha. */
export function aDatetimeLocal(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Lo que eligió el docente en <input type="datetime-local"> → ISO con zona (UTC), o null si está vacío o es inválido. */
export function desdeDatetimeLocal(valor) {
  if (!valor) return null;
  const d = new Date(valor); // sin zona = hora local del navegador
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Guarda en el equipo un archivo recibido de la API ({ blob, name }). */
export function guardarArchivo({ blob, name }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
