import { describe, expect, it } from 'vitest';
import { generarClave, problemaClave, problemaClaveInicial } from './usuarios.js';

describe('clave inicial que elige el admin', () => {
  it('genera 12 caracteres sin los que se confunden, con el generador seguro', () => {
    const clave = generarClave();
    expect(clave).toHaveLength(12);
    expect(clave).not.toMatch(/[0O1lI]/);
    expect(generarClave(12, (n) => new Uint32Array(n))).toBe('aaaaaaaaaaaa');
    expect(new Set(Array.from({ length: 20 }, () => generarClave())).size).toBe(20);
  });

  it('pide 8 caracteres, algo más que espacios y distinta del correo', () => {
    expect(problemaClaveInicial('1234567')).toMatch(/al menos 8/);
    expect(problemaClaveInicial('        ')).toMatch(/espacios/);
    expect(problemaClaveInicial('rosa@demo.cl', ' Rosa@Demo.cl ')).toMatch(/correo/);
    expect(problemaClaveInicial('x'.repeat(257))).toMatch(/larga/);
    expect(problemaClaveInicial('clave-segura-1', 'rosa@demo.cl')).toBeNull();
  });
});

describe('cambiar mi contraseña', () => {
  const ok = { actual: 'demo1234', nueva: 'otra-clave-1', repetida: 'otra-clave-1' };
  it('acepta una clave válida', () => expect(problemaClave(ok, 'camila@demo-a.cl')).toBeNull());
  it('pide la actual, 8 caracteres, distinta, que no sea el correo y repetida igual', () => {
    expect(problemaClave({ ...ok, actual: '' })).toMatch(/actual/);
    expect(problemaClave({ ...ok, nueva: 'corta', repetida: 'corta' })).toMatch(/al menos 8/);
    expect(problemaClave({ ...ok, nueva: 'demo1234', repetida: 'demo1234' })).toMatch(/distinta/);
    expect(problemaClave({ ...ok, nueva: 'camila@demo-a.cl', repetida: 'camila@demo-a.cl' }, 'camila@demo-a.cl')).toMatch(/correo/);
    expect(problemaClave({ ...ok, repetida: 'otra' })).toMatch(/no coinciden/);
  });
});
