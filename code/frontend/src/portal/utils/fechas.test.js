import { describe, expect, it } from 'vitest';
import { formatCierre, formatDuracion, formatHora, tiempoRestante, tonoPlazo } from './fechas.js';

// 26-11-2026 01:20 en Chile (UTC-3) = 04:20 UTC.
const AHORA = Date.parse('2026-11-26T04:20:00Z');

describe('hora de cierre en hora de Chile, con a. m. / p. m.', () => {
  it('muestra la hora con a. m. o p. m.', () => {
    expect(formatHora('2026-11-27T02:59:00Z')).toBe('11:59 p. m.'); // 26-11 23:59 en Chile
    expect(formatHora('2026-11-26T12:00:00Z')).toBe('9:00 a. m.');
  });

  it('dice hoy / mañana / ayer o el día, siempre con la hora', () => {
    expect(formatCierre('2026-11-27T02:59:00Z', AHORA)).toBe('hoy, 11:59 p. m.');
    expect(formatCierre('2026-11-27T12:30:00Z', AHORA)).toBe('mañana, 9:30 a. m.');
    expect(formatCierre('2026-11-25T18:00:00Z', AHORA)).toBe('ayer, 3:00 p. m.');
    expect(formatCierre('2026-12-03T23:00:00Z', AHORA)).toMatch(/^jue\.?, 3 dic\.?, 8:00 p\. m\.$/);
    expect(formatCierre('2027-01-05T15:00:00Z', AHORA)).toMatch(/2027, 12:00 p\. m\.$/);
    expect(formatCierre(null, AHORA)).toBeNull();
  });

  it('cuánto falta y de qué color', () => {
    expect(tiempoRestante('2026-11-26T05:50:00Z', AHORA)).toBe('Quedan 1 h 30 min');
    expect(tiempoRestante('2026-11-26T04:00:00Z', AHORA)).toBe('Cerrada');
    expect(tonoPlazo('2026-11-26T05:50:00Z', AHORA)).toBe('warning');
    expect(tonoPlazo('2026-11-29T05:50:00Z', AHORA)).toBe('success');
    expect(tonoPlazo('2026-11-26T04:00:00Z', AHORA)).toBe('neutral');
  });

  it('duraciones legibles', () => {
    expect(formatDuracion(45)).toBe('45 min');
    expect(formatDuracion(120)).toBe('2 h');
    expect(formatDuracion(90)).toBe('1 h 30 min');
  });
});
