import { expect, test } from 'vitest';
import { formatRelativeDay } from './formatRelativeDay.js';

const now = new Date(2026, 9, 1, 15, 0).getTime();

test('formatea el día relativo para el historial', () => {
  expect(formatRelativeDay(new Date(2026, 9, 1, 8, 0).getTime(), now)).toBe('Hoy');
  expect(formatRelativeDay(new Date(2026, 8, 30, 23, 0).getTime(), now)).toBe('Ayer');
  expect(formatRelativeDay(new Date(2026, 8, 28, 10, 0).getTime(), now)).toBe('Hace 3 días');
});
