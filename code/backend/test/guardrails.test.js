import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createOutputFilter, redactMessages, redactPii, stripInternalTags } from '../src/modules/tutor/guardrails.js';

describe('guardrail de entrada: datos personales', () => {
  test('quita RUT con y sin puntos, correos y teléfonos chilenos', () => {
    const { text, found } = redactPii('Soy 12.345.678-9 (o 7654321-K), escribe a sofia.p@colegio.cl o al +56 9 8765 4321 / 912345678.');
    assert.equal(text, 'Soy [RUT] (o [RUT]), escribe a [correo] o al [teléfono] / [teléfono].');
    assert.deepEqual(found, { rut: 2, correo: 1, telefono: 2 });
  });

  test('no toca preguntas de materia con números', () => {
    for (const q of ['¿Cuánto es 1.234 + 5.678?', '3/4 de 120', 'En 1810 se formó la Primera Junta', '¿Qué es 2^10?', 'La fórmula es a-b']) {
      assert.equal(redactPii(q).text, q);
    }
  });

  test('solo limpia lo que escribió el estudiante, no las respuestas del tutor', () => {
    const msgs = [
      { role: 'user', content: 'mi correo es ana@x.cl' },
      { role: 'assistant', content: 'contacto@colegio.cl' },
      { role: 'user', content: '¿qué es una fracción?' },
    ];
    const r = redactMessages(msgs);
    assert.equal(r.redacted, 1);
    assert.equal(r.messages[0].content, 'mi correo es [correo]');
    assert.equal(r.messages[1], msgs[1]);
    assert.equal(r.messages[2], msgs[2]);
  });
});

describe('guardrail de salida: etiquetas internas del prompt', () => {
  test('el caso real: «<nociones>» al final de una respuesta', () => {
    assert.equal(stripInternalTags('Chile es un país de Sudamérica. <nociones> Es una idea general.'), 'Chile es un país de Sudamérica. Es una idea general.');
  });

  test('también abre/cierra y con espacios o mayúsculas; deja el resto del texto igual', () => {
    assert.equal(stripInternalTags('a </apuntes> b < Calculo > c'), 'a b c');
    assert.equal(stripInternalTags('si 3 < 5 y 5 > 2, entonces 3 < 2 es falso'), 'si 3 < 5 y 5 > 2, entonces 3 < 2 es falso');
  });

  test('en streaming, una etiqueta partida en varios fragmentos no se escapa', () => {
    const f = createOutputFilter();
    const out = ['Es un país. <noc', 'iones', '> Idea general.'].map((c) => f.push(c)).join('') + f.flush();
    assert.equal(out, 'Es un país.  Idea general.');
    assert.equal(f.removed, 1);
  });

  test('un «<» que no era etiqueta se entrega al final', () => {
    const f = createOutputFilter();
    const out = f.push('3 <') + f.push(' 5') + f.flush();
    assert.equal(out, '3 < 5');
    const g = createOutputFilter();
    assert.equal(g.push('termina en <') + g.flush(), 'termina en <');
  });
});

describe('guardrails dentro del chat (de punta a punta)', () => {
  let server;
  let url;
  const calls = [];
  const llm = {
    async *chat(messages) {
      calls.push(messages);
      yield 'Respuesta <nocio';
      yield 'nes> final.';
    },
    async ping() { return true; },
  };
  before(async () => {
    server = createApp({ logger: pino({ level: 'silent' }), llm }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('el modelo no recibe el RUT y el estudiante no ve la etiqueta', async () => {
    const res = await fetch(`${url}/v1/dev/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hola, soy 12.345.678-9' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'Respuesta  final.');
    const sent = JSON.stringify(calls.at(-1));
    assert.ok(!sent.includes('12.345.678-9'));
    assert.ok(sent.includes('[RUT]'));
  });
});
