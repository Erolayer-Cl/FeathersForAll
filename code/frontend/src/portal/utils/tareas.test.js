import { describe, expect, it } from 'vitest';
import { nombreDeDescarga } from '../../api/portalApi.js';
import { aDatetimeLocal, desdeDatetimeLocal, estadoTarea, formatTamano, motivoRechazoArchivo, tareaAbierta, tiempoRestante } from './tareas.js';

const AHORA = Date.parse('2026-12-01T12:00:00Z');
const en = (min) => new Date(AHORA + min * 60000).toISOString();

describe('plazo de una tarea', () => {
  it('dice cuánto falta en palabras', () => {
    expect(tiempoRestante(en(-1), AHORA)).toBe('Cerrada');
    expect(tiempoRestante(en(0.5), AHORA)).toBe('Queda menos de 1 min');
    expect(tiempoRestante(en(45), AHORA)).toBe('Quedan 45 min');
    expect(tiempoRestante(en(185), AHORA)).toBe('Quedan 3 h 5 min');
    expect(tiempoRestante(en(120), AHORA)).toBe('Quedan 2 h');
    expect(tiempoRestante(en(60 * 24), AHORA)).toBe('Quedan 1 día');
    expect(tiempoRestante(en(60 * 24 * 3 + 5), AHORA)).toBe('Quedan 3 días');
  });

  it('se cierra sola en pantalla al pasar la hora, aunque el servidor dijera abierta', () => {
    const t = { is_open: true, due_at: en(10) };
    expect(tareaAbierta(t, AHORA)).toBe(true);
    expect(tareaAbierta(t, AHORA + 11 * 60000)).toBe(false);
    expect(tareaAbierta({ ...t, is_open: false }, AHORA)).toBe(false);
  });

  it('avisa en amarillo el último día', () => {
    expect(estadoTarea({ is_open: true, due_at: en(60 * 30) }, AHORA).tone).toBe('success');
    expect(estadoTarea({ is_open: true, due_at: en(60 * 5) }, AHORA).tone).toBe('warning');
    expect(estadoTarea({ is_open: false, due_at: en(-5) }, AHORA)).toEqual({ label: 'Cerrada', tone: 'neutral' });
  });
});

describe('archivos', () => {
  const archivo = (name, size = 100) => ({ name, size });
  it('acepta los formatos de la API y rechaza el resto antes de enviar', () => {
    expect(motivoRechazoArchivo(archivo('guía.PDF'))).toBeNull();
    expect(motivoRechazoArchivo(archivo('foto.jpeg'))).toBeNull();
    expect(motivoRechazoArchivo(archivo('virus.exe'))).toMatch(/Formato/);
    expect(motivoRechazoArchivo(archivo('vacio.pdf', 0))).toMatch(/vacío/);
    expect(motivoRechazoArchivo(archivo('grande.pdf', 11 * 1024 * 1024))).toMatch(/10 MB/);
  });

  it('muestra el tamaño legible', () => {
    expect(formatTamano(900)).toBe('900 B');
    expect(formatTamano(230 * 1024)).toBe('230 KB');
    expect(formatTamano(1.4 * 1024 * 1024)).toBe('1,4 MB');
  });

  it('lee el nombre UTF-8 de Content-Disposition', () => {
    expect(nombreDeDescarga(`attachment; filename="Guia.pdf"; filename*=UTF-8''Gu%C3%ADa.pdf`)).toBe('Guía.pdf');
    expect(nombreDeDescarga('attachment; filename="a.txt"')).toBe('a.txt');
    expect(nombreDeDescarga(null)).toBeNull();
  });
});

describe('fecha límite del formulario', () => {
  it('ida y vuelta entre datetime-local y ISO', () => {
    const iso = desdeDatetimeLocal('2026-12-03T23:59');
    expect(aDatetimeLocal(iso)).toBe('2026-12-03T23:59');
    expect(desdeDatetimeLocal('')).toBeNull();
    expect(desdeDatetimeLocal('no-es-fecha')).toBeNull();
  });
});
