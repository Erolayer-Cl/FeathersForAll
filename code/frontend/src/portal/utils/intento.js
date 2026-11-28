// Reloj de una evaluación con tiempo (v1.12): el plazo lo decide el servidor y el portal solo lo muestra y entrega a
// tiempo. Todo lo que depende de la hora usa el reloj del SERVIDOR, corregido con `server_time`: si el equipo del
// estudiante está adelantado o atrasado, la cuenta regresiva y la entrega automática no se mueven.

/** Segundos antes del plazo en que el portal entrega solo (el servidor acepta hasta 30 s después: hay margen). */
export const ENTREGA_ANTICIPADA_MS = 5_000;

/** Desfase servidor − equipo en ms, a partir de la `server_time` de una respuesta recibida en `recibidaEn` (Date.now()). */
export function desfaseReloj(serverTime, recibidaEn = Date.now()) {
  const t = Date.parse(serverTime ?? '');
  return Number.isFinite(t) ? t - recibidaEn : 0;
}

/**
 * Plazo efectivo (ms, reloj del servidor) para este estudiante: el `deadline` de su intento si ya empezó; si no,
 * el cierre de la evaluación. null = sin plazo.
 */
export function plazoDe(ev) {
  const iso = ev?.attempt?.deadline ?? ev?.closes_at ?? null;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * "45:00", "4:05", "0:09" o "1:02:03": tiempo que queda, en formato de reloj. Redondea hacia abajo: nunca muestra
 * más tiempo del que hay (una prueba de 1 minuto no parte en 1:01 por la latencia de la red).
 */
export function relojRestante(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Tono del reloj: rojo el último minuto, amarillo los últimos 5, neutro antes. */
export function tonoReloj(ms) {
  if (ms <= 60_000) return 'danger';
  if (ms <= 5 * 60_000) return 'warning';
  return 'neutral';
}

// Borrador local de las respuestas: si se recarga la página o se corta la luz, se recupera lo respondido.
// sessionStorage (no localStorage): muere al cerrar la pestaña y no queda en un computador compartido del colegio.
const claveBorrador = (assessmentId, userId) => `fp:intento:${userId}:${assessmentId}`;

export function leerBorrador(assessmentId, userId, storage = globalThis.sessionStorage) {
  try {
    const valor = JSON.parse(storage?.getItem(claveBorrador(assessmentId, userId)) ?? 'null');
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  } catch {
    return {};
  }
}

export function guardarBorrador(assessmentId, userId, elegidas, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(claveBorrador(assessmentId, userId), JSON.stringify(elegidas));
  } catch {
    /* sin almacenamiento: las respuestas viven solo en la página */
  }
}

export function borrarBorrador(assessmentId, userId, storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(claveBorrador(assessmentId, userId));
  } catch {
    /* nada que borrar */
  }
}
