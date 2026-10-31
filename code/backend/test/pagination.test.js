import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, parseLimit } from '../src/platform/pagination.js';

describe('paginación por cursor', () => {
  test('limit: 20 por defecto, entre 1 y 100', () => {
    assert.equal(parseLimit(undefined), DEFAULT_LIMIT);
    assert.equal(parseLimit('1'), 1);
    assert.equal(parseLimit('100'), 100);
    for (const malo of ['0', '101', '2.5', 'abc', '']) {
      assert.throws(() => parseLimit(malo), { status: 400 }, malo);
    }
  });

  test('el cursor ida y vuelta conserva los valores', () => {
    const valores = ['2026-S2', 'Matemáticas 7° Básico A', 'c0000000-0000-0000-0000-000000000001'];
    assert.deepEqual(decodeCursor(encodeCursor(valores), () => true), valores);
  });

  test('un cursor alterado o con otra forma responde 400', () => {
    const tresValores = (v) => v.length === 3;
    assert.throws(() => decodeCursor('no-es-base64-json', tresValores), { status: 400 });
    assert.throws(() => decodeCursor(encodeCursor({ a: 1 }), tresValores), { status: 400 });
    assert.throws(() => decodeCursor(encodeCursor([1, 2]), tresValores), { status: 400 });
  });
});
