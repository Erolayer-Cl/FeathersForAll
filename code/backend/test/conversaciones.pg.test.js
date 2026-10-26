// Conversaciones guardadas del Tutor IA (ADR 0008) contra un PostgreSQL REAL.
// Se saltan si no hay TEST_DATABASE_URL (ver test/pg-fixture.js):
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
//
// Lo central: SOLO el estudiante dueño ve, escribe y borra sus conversaciones. Ni otro estudiante,
// ni el docente, ni el admin las leen, y eso lo exige la base (RLS de 05_conversaciones_tutor.sql).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createDb } from '../src/platform/db.js';
import { signJwt } from '../src/platform/auth.js';
import { createPgVectorStore } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { NO_NOTES_REPLY } from '../src/modules/tutor/rag/rag-prompt.js';
import { LlmUnavailableError } from '../src/modules/tutor/llm-client.js';
import { fakeEmbedder } from './fake-embedder.js';
import { createTestDatabase, DEMO, SKIP } from './pg-fixture.js';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const logger = pino({ level: 'silent' });

const CAMILA = { id: DEMO.camila, rol: 'estudiante' };
const BENJA = { id: DEMO.benja, rol: 'estudiante' };
const ANA = { id: DEMO.ana, rol: 'docente' };
const MARTA = { id: DEMO.marta, rol: 'admin_colegio' };
const JAVIERA = { id: DEMO.javiera, rol: 'estudiante' };

const NOTES = `# Fracciones

Una fracción representa una parte de un todo. El numerador indica cuántas partes se toman.

El denominador indica en cuántas partes iguales se divide el todo.`;

const PREGUNTA = '¿Qué indica el denominador de una fracción?';

/** LLM simulado: responde siempre lo mismo; `llm.fail = true` lo deja caído. */
function fakeLlm() {
  const llm = {
    calls: [],
    fail: false,
    async *chat(messages) {
      llm.calls.push(messages);
      if (llm.fail) throw new LlmUnavailableError('No se pudo conectar con el proveedor LLM');
      yield* ['El denominador indica ', 'en cuántas partes se divide el todo [1].'];
    },
    ping: async () => true,
  };
  return llm;
}

describe('conversaciones del tutor (PostgreSQL)', { skip: SKIP }, () => {
  let testDb;
  let db;
  let server;
  let url;
  const llm = fakeLlm();

  const tok = (u, tenant = DEMO.colegioA) => signJwt({ sub: u.id, tenant_id: tenant, role: u.rol }, SECRET);
  const auth = (u, tenant) => ({ authorization: `Bearer ${tok(u, tenant)}` });
  const send = (u, courseId, convId, body, tenant) =>
    fetch(`${url}/v1/courses/${courseId}/tutor-conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(u, tenant) },
      body: JSON.stringify(body),
    });
  const get = (u, path) => fetch(url + path, { headers: auth(u) });
  const del = (u, path) => fetch(url + path, { method: 'DELETE', headers: auth(u) });
  const count = async (sql, params) => Number((await testDb.superuser.query(sql, params)).rows[0].n);

  before(async () => {
    testDb = await createTestDatabase('ffa_conv');
    db = createDb({ connectionString: testDb.appUrl, max: 4 });
    const rag = {
      ...createRagService({ embedder: fakeEmbedder(1024), store: createPgVectorStore({ db }), minScore: 0.2 }),
      backend: 'postgres',
    };
    await rag.ingest({ tenantId: DEMO.colegioA, courseId: DEMO.mate, docId: 'fracciones.md', text: NOTES, actor: ANA });
    server = createApp({ logger, llm, db, jwtSecret: SECRET, rag, tenantId: DEMO.colegioA }).listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await db?.end();
    await testDb?.drop();
  });

  describe('el estudiante conversa y su conversación queda guardada', () => {
    const conv = randomUUID();

    test('el primer mensaje crea la conversación y guarda pregunta + respuesta con sus fuentes', async () => {
      const res = await send(CAMILA, DEMO.mate, conv, { content: PREGUNTA, mode: 'tutor' });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-tutor-turn'), 'grounded');
      assert.equal(res.headers.get('x-conversation-mode'), 'tutor');
      assert.equal(await res.text(), 'El denominador indica en cuántas partes se divide el todo [1].');

      const row = (await testDb.superuser.query('SELECT * FROM conversaciones_tutor WHERE id = $1', [conv])).rows[0];
      assert.equal(row.estudiante_id, DEMO.camila);
      assert.equal(row.colegio_id, DEMO.colegioA);
      assert.equal(row.titulo, PREGUNTA);
      const msgs = (await testDb.superuser.query('SELECT rol, fuentes FROM mensajes_tutor WHERE conversacion_id = $1 ORDER BY orden', [conv])).rows;
      assert.deepEqual(msgs.map((m) => m.rol), ['user', 'assistant']);
      assert.equal(msgs[1].fuentes[0].doc_id, 'fracciones.md');
    });

    test('el siguiente mensaje usa el historial guardado (el cliente solo manda la pregunta nueva)', async () => {
      const res = await send(CAMILA, DEMO.mate, conv, { content: 'Explícame otra vez qué indica el denominador de una fracción' });
      assert.equal(res.headers.get('x-tutor-turn'), 'grounded');
      await res.text();
      const sent = llm.calls.at(-1).slice(1); // sin el prompt de sistema
      assert.deepEqual(sent.map((m) => m.role), ['user', 'assistant', 'user']);
      assert.equal(sent[0].content, PREGUNTA);
      assert.equal(await count('SELECT count(*) AS n FROM mensajes_tutor WHERE conversacion_id = $1', [conv]), 4);
    });

    test('GET lista sus conversaciones del curso, con título, modo y cantidad de mensajes', async () => {
      const res = await get(CAMILA, `/v1/courses/${DEMO.mate}/tutor-conversations`);
      assert.equal(res.status, 200);
      const { data } = await res.json();
      assert.equal(data.length, 1);
      assert.equal(data[0].id, conv);
      assert.equal(data[0].mode, 'tutor');
      assert.equal(data[0].title, PREGUNTA);
      assert.equal(data[0].messages_count, 4);
    });

    test('GET de la conversación devuelve los mensajes en orden', async () => {
      const res = await get(CAMILA, `/v1/tutor-conversations/${conv}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.course_id, DEMO.mate);
      assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
      assert.equal(body.messages[0].content, PREGUNTA);
      assert.deepEqual(body.messages[0].sources, []);
    });

    test('el modo guardado manda sobre el del cuerpo', async () => {
      const res = await send(CAMILA, DEMO.mate, conv, { content: 'Gracias', mode: 'pruebas' });
      assert.equal(res.headers.get('x-conversation-mode'), 'tutor');
      await res.text();
    });

    test('una respuesta fija (curso sin apuntes) también se guarda', async () => {
      const otra = randomUUID();
      const res = await send(CAMILA, DEMO.historia, otra, { content: '¿Quiénes eran los mayas?' });
      assert.equal(await res.text(), NO_NOTES_REPLY);
      assert.equal(await count('SELECT count(*) AS n FROM mensajes_tutor WHERE conversacion_id = $1', [otra]), 2);
    });

    test('si el LLM falla responde 503 y no queda nada guardado', async () => {
      const otra = randomUUID();
      llm.fail = true;
      try {
        const res = await send(CAMILA, DEMO.mate, otra, { content: PREGUNTA });
        assert.equal(res.status, 503);
      } finally {
        llm.fail = false;
      }
      assert.equal(await count('SELECT count(*) AS n FROM conversaciones_tutor WHERE id = $1', [otra]), 0);
    });
  });

  describe('nadie más las ve (API + RLS)', () => {
    const conv = randomUUID();
    before(async () => {
      await (await send(CAMILA, DEMO.mate, conv, { content: PREGUNTA })).text();
    });

    test('otro estudiante del mismo curso: 404 al leer o borrar, y no aparece en su lista', async () => {
      assert.equal((await get(BENJA, `/v1/tutor-conversations/${conv}`)).status, 404);
      assert.equal((await del(BENJA, `/v1/tutor-conversations/${conv}`)).status, 404);
      const { data } = await (await get(BENJA, `/v1/courses/${DEMO.mate}/tutor-conversations`)).json();
      assert.equal(data.some((c) => c.id === conv), false);
    });

    test('otro estudiante que escribe con el id ajeno no agrega mensajes a esa conversación', async () => {
      const antes = await count('SELECT count(*) AS n FROM mensajes_tutor WHERE conversacion_id = $1', [conv]);
      await (await send(BENJA, DEMO.mate, conv, { content: PREGUNTA })).text();
      assert.equal(await count('SELECT count(*) AS n FROM mensajes_tutor WHERE conversacion_id = $1', [conv]), antes);
      assert.equal(await count('SELECT count(*) AS n FROM conversaciones_tutor WHERE estudiante_id = $1', [DEMO.benja]), 0);
    });

    test('el docente y el admin reciben 403 (el tutor es privado de cada estudiante)', async () => {
      assert.equal((await get(ANA, `/v1/courses/${DEMO.mate}/tutor-conversations`)).status, 403);
      assert.equal((await get(ANA, `/v1/tutor-conversations/${conv}`)).status, 403);
      assert.equal((await get(MARTA, `/v1/tutor-conversations/${conv}`)).status, 403);
      assert.equal((await send(ANA, DEMO.mate, randomUUID(), { content: PREGUNTA })).status, 403);
    });

    test('aunque la API se equivocara, la base no le muestra nada al docente ni al admin', async () => {
      for (const user of [ANA, MARTA]) {
        const n = await db.withUser({ ...user, colegioId: DEMO.colegioA }, async (c) =>
          (await c.query('SELECT count(*)::int AS n FROM conversaciones_tutor')).rows[0].n + (await c.query('SELECT count(*)::int AS n FROM mensajes_tutor')).rows[0].n);
        assert.equal(n, 0, user.rol);
      }
    });

    test('la base no deja crear una conversación a nombre de otro estudiante', async () => {
      await assert.rejects(
        db.withUser({ ...BENJA, colegioId: DEMO.colegioA }, (c) =>
          c.query('INSERT INTO conversaciones_tutor (id, curso_id, estudiante_id, titulo) VALUES ($1, $2, $3, $4)', [randomUUID(), DEMO.mate, DEMO.camila, 'x'])),
        { code: '42501' },
      );
    });

    test('estudiante de otro colegio: 404 en un curso del colegio A', async () => {
      assert.equal((await send(JAVIERA, DEMO.mate, randomUUID(), { content: PREGUNTA }, DEMO.colegioB)).status, 404);
    });

    test('la conversación de un curso no se puede seguir desde otro curso: 404', async () => {
      assert.equal((await send(CAMILA, DEMO.historia, conv, { content: PREGUNTA })).status, 404);
    });
  });

  describe('borrar y retención', () => {
    test('la estudiante borra su conversación (y sus mensajes)', async () => {
      const conv = randomUUID();
      await (await send(CAMILA, DEMO.mate, conv, { content: PREGUNTA })).text();
      assert.equal((await del(CAMILA, `/v1/tutor-conversations/${conv}`)).status, 204);
      assert.equal((await get(CAMILA, `/v1/tutor-conversations/${conv}`)).status, 404);
      assert.equal(await count('SELECT count(*) AS n FROM mensajes_tutor WHERE conversacion_id = $1', [conv]), 0);
    });

    test('purgar_conversaciones_tutor() borra las de años anteriores y deja las de este año', async () => {
      const vieja = randomUUID();
      const nueva = randomUUID();
      await (await send(CAMILA, DEMO.mate, vieja, { content: PREGUNTA })).text();
      await (await send(CAMILA, DEMO.mate, nueva, { content: PREGUNTA })).text();
      // Sin el trigger de updated_at (si no, pondría now() encima de la fecha antigua).
      await testDb.superuser.query('ALTER TABLE conversaciones_tutor DISABLE TRIGGER trg_conversaciones_tutor_updated_at');
      await testDb.superuser.query("UPDATE conversaciones_tutor SET updated_at = date_trunc('year', now()) - interval '1 day' WHERE id = $1", [vieja]);
      await testDb.superuser.query('ALTER TABLE conversaciones_tutor ENABLE TRIGGER trg_conversaciones_tutor_updated_at');

      const { rows } = await testDb.superuser.query('SELECT purgar_conversaciones_tutor() AS borradas');
      assert.ok(rows[0].borradas >= 1);
      assert.equal(await count('SELECT count(*) AS n FROM conversaciones_tutor WHERE id = $1', [vieja]), 0);
      assert.equal(await count('SELECT count(*) AS n FROM conversaciones_tutor WHERE id = $1', [nueva]), 1);
    });

    test('el usuario de la API no puede ejecutar la purga', async () => {
      await assert.rejects(
        db.withUser({ ...MARTA, colegioId: DEMO.colegioA }, (c) => c.query('SELECT purgar_conversaciones_tutor()')),
        { code: '42501' },
      );
    });
  });

  describe('validación', () => {
    test('400 si falta el contenido, si el modo no existe o si los ids no son UUID', async () => {
      assert.equal((await send(CAMILA, DEMO.mate, randomUUID(), { content: '  ' })).status, 400);
      assert.equal((await send(CAMILA, DEMO.mate, randomUUID(), { content: 'hola', mode: 'libre' })).status, 400);
      assert.equal((await send(CAMILA, DEMO.mate, 'no-es-uuid', { content: 'hola' })).status, 400);
      assert.equal((await get(CAMILA, '/v1/tutor-conversations/123')).status, 400);
    });

    test('401 sin token', async () => {
      assert.equal((await fetch(`${url}/v1/tutor-conversations/${randomUUID()}`)).status, 401);
    });
  });
});

