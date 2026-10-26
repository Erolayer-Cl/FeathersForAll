import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/platform/password.js';

describe('contraseñas (scrypt)', () => {
  test('el hash guarda algoritmo y parámetros, y cada hash tiene su propia sal', async () => {
    const a = await hashPassword('demo1234');
    const b = await hashPassword('demo1234');
    assert.match(a, /^scrypt\$16384\$8\$5\$[\w-]+\$[\w-]+$/);
    assert.notEqual(a, b);
  });

  test('valida la contraseña correcta y rechaza las demás', async () => {
    const hash = await hashPassword('demo1234');
    assert.equal(await verifyPassword('demo1234', hash), true);
    assert.equal(await verifyPassword('demo12345', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  test('normaliza Unicode: la misma clave con tildes escrita de otra forma vale igual', async () => {
    const hash = await hashPassword('canción');
    assert.equal(await verifyPassword('canción', hash), true);
  });

  test('sin hash, con el marcador "!sso" o con un hash mal formado nunca valida (y no lanza)', async () => {
    for (const stored of [undefined, null, '', '!sso', 'scrypt$1$1$1$x$y', 'bcrypt$algo']) {
      assert.equal(await verifyPassword('demo1234', stored), false, String(stored));
    }
  });

  test('rechaza un hash con parámetros desmedidos (evita cálculos de varios segundos)', async () => {
    const [, , r, p, salt, key] = (await hashPassword('x')).split('$');
    assert.equal(await verifyPassword('x', ['scrypt', 2 ** 20, r, p, salt, key].join('$')), false);
  });
});
