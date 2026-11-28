import { describe, expect, it } from 'vitest';
import { borrarBorrador, desfaseReloj, guardarBorrador, leerBorrador, plazoDe, relojRestante, tonoReloj } from './intento.js';

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('reloj de una evaluación con tiempo', () => {
  it('el desfase corrige un equipo adelantado o atrasado', () => {
    expect(desfaseReloj('2026-11-27T12:00:10Z', Date.parse('2026-11-27T12:00:00Z'))).toBe(10_000);
    expect(desfaseReloj('2026-11-27T12:00:00Z', Date.parse('2026-11-27T12:01:00Z'))).toBe(-60_000);
    expect(desfaseReloj(undefined, 123)).toBe(0);
    expect(desfaseReloj('no-es-fecha', 123)).toBe(0);
  });

  it('el plazo es el del intento si ya empezó; si no, el cierre; sin ninguno, null', () => {
    expect(plazoDe({ closes_at: '2026-11-27T13:00:00Z', attempt: { deadline: '2026-11-27T12:20:00Z' } })).toBe(Date.parse('2026-11-27T12:20:00Z'));
    expect(plazoDe({ closes_at: '2026-11-27T13:00:00Z', attempt: null })).toBe(Date.parse('2026-11-27T13:00:00Z'));
    expect(plazoDe({ closes_at: null, attempt: { deadline: null } })).toBeNull();
    expect(plazoDe(undefined)).toBeNull();
  });

  it('muestra el tiempo como reloj y nunca negativo', () => {
    expect(relojRestante(45 * 60_000)).toBe('45:00');
    expect(relojRestante(245_000)).toBe('4:05');
    expect(relojRestante(8_200)).toBe('0:08');
    expect(relojRestante(60_400)).toBe('1:00');
    expect(relojRestante(3_723_000)).toBe('1:02:03');
    expect(relojRestante(-5_000)).toBe('0:00');
  });

  it('el tono avisa los últimos 5 minutos y el último', () => {
    expect(tonoReloj(10 * 60_000)).toBe('neutral');
    expect(tonoReloj(4 * 60_000)).toBe('warning');
    expect(tonoReloj(30_000)).toBe('danger');
  });
});

describe('borrador local de respuestas', () => {
  it('guarda, recupera y borra por estudiante y evaluación', () => {
    const s = memoria();
    guardarBorrador('ev1', 'ana', { q1: 2, q2: 'siete' }, s);
    expect(leerBorrador('ev1', 'ana', s)).toEqual({ q1: 2, q2: 'siete' });
    // Otro estudiante en el mismo equipo no ve el borrador ajeno.
    expect(leerBorrador('ev1', 'beto', s)).toEqual({});
    borrarBorrador('ev1', 'ana', s);
    expect(leerBorrador('ev1', 'ana', s)).toEqual({});
  });

  it('un valor dañado o sin almacenamiento no rompe la página', () => {
    const s = memoria();
    s.setItem('fp:intento:ana:ev1', '{roto');
    expect(leerBorrador('ev1', 'ana', s)).toEqual({});
    s.setItem('fp:intento:ana:ev1', '[1,2]');
    expect(leerBorrador('ev1', 'ana', s)).toEqual({});
    expect(leerBorrador('ev1', 'ana', null)).toEqual({});
    expect(() => guardarBorrador('ev1', 'ana', {}, { setItem() { throw new Error('lleno'); } })).not.toThrow();
  });
});
