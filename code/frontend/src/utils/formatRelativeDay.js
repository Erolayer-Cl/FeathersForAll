const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Hoy", "Ayer", "Hace 3 días" o la fecha corta, para el historial. */
export function formatRelativeDay(timestamp, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return new Date(timestamp).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}
