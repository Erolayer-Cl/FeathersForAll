// Pruebas UNITARIAS del cálculo de SLI (scripts/sli.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { calcular, clasificar, leer, percentil } from '../scripts/sli.js';

const req = (route, status, duration_ms = 100, completed = true) => ({ msg: 'request', route, status, duration_ms, completed });

describe('sli', () => {
  test('las sondas no cuentan; login y tutor van aparte del resto de la API', () => {
    assert.equal(clasificar('/readyz'), null);
    assert.equal(clasificar('/v1/auth/login'), 'login');
    assert.equal(clasificar('/v1/courses/:courseId/tutor-conversations/:conversationId/messages'), 'tutor');
    assert.equal(clasificar('/v1/courses'), 'api');
  });

  test('solo los 5xx gastan presupuesto; un 429 es el tope funcionando', () => {
    const registros = [
      ...Array.from({ length: 197 }, () => req('/v1/courses', 200)),
      req('/v1/courses', 429),
      req('/v1/courses', 503),
      req('/health', 503),
    ];
    const api = calcular(registros).find((f) => f.clase === 'api');
    assert.equal(api.total, 199);
    assert.equal(api.malas, 1);
    assert.equal(api.limitadas, 1);
    assert.ok(Math.abs(api.disponibilidad - 198 / 199) < 1e-9);
    // 1 mala de 0,995 permitidas (0,5 % de 199): presupuesto pasado.
    assert.ok(api.presupuestoUsado > 1);
    assert.equal(api.cumple, false);
  });

  test('p95 sobre las respuestas completas; una clase sin tráfico queda "sin datos"', () => {
    const registros = Array.from({ length: 20 }, (_, i) => req('/v1/dev/chat', 200, (i + 1) * 1000));
    registros.push(req('/v1/dev/chat', 200, 99_000, false));
    const tutor = calcular(registros).find((f) => f.clase === 'tutor');
    assert.equal(tutor.p95Ms, 19_000);
    assert.equal(tutor.cortadas, 1);
    assert.equal(tutor.cumple, false);
    assert.equal(calcular(registros).find((f) => f.clase === 'login').cumple, null);
    assert.equal(percentil([], 0.95), null);
  });

  test('lee la salida de kubectl aunque traiga líneas que no son JSON', async () => {
    const texto = 'Found 2 pods, using pod/x\n{"msg":"request","route":"/v1/me","status":200,"duration_ms":5,"completed":true}\nbasura {\n';
    const registros = await leer(Readable.from([texto]));
    assert.equal(registros.length, 1);
  });
});
