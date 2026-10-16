import { describe, expect, test } from 'vitest';
import { ApiError } from './http.js';
import { getCourses, getMyGrades, login } from './portalApi.js';

/** fetch falso: registra las llamadas y responde en orden. */
function fakeFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

describe('portalApi', () => {
  test('login envía las credenciales en JSON, sin token', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { access_token: 'x', expires_in: 60, user: {} } });
    await login({ rbd: '99901', email: 'camila@demo-a.cl', password: 'demo1234' }, { fetchImpl });
    expect(calls[0].url).toBe('/v1/auth/login');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body)).toEqual({ rbd: '99901', email: 'camila@demo-a.cl', password: 'demo1234' });
    expect(calls[0].init.headers.authorization).toBeUndefined();
  });

  test('las rutas con datos envían el token como Bearer', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { courses: [] } });
    await getMyGrades('token-123', { fetchImpl });
    expect(calls[0].init.headers.authorization).toBe('Bearer token-123');
  });

  test('un error RFC 7807 llega como ApiError con su detail, status y type', async () => {
    const { fetchImpl } = fakeFetch({
      status: 401,
      body: { type: 'https://api.feathersforall.example/errors/invalid-credentials', title: 'Credenciales inválidas', detail: 'El RBD, el correo o la contraseña no son correctos', status: 401 },
    });
    const err = await login({ rbd: '1', email: 'a@b.cl', password: 'x' }, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('El RBD, el correo o la contraseña no son correctos');
    expect(err.type).toMatch(/invalid-credentials$/);
  });

  test('sin conexión con el servidor da un ApiError con status 0 y un mensaje claro', async () => {
    const { fetchImpl } = fakeFetch(new TypeError('Failed to fetch'));
    const err = await getMyGrades('t', { fetchImpl }).catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/No pudimos conectar/);
  });

  test('getCourses recorre todas las páginas siguiendo next_cursor', async () => {
    const { fetchImpl, calls } = fakeFetch(
      { body: { data: [{ id: 'a' }], next_cursor: 'c1' } },
      { body: { data: [{ id: 'b' }], next_cursor: null } },
    );
    expect((await getCourses('t', { fetchImpl })).map((c) => c.id)).toEqual(['a', 'b']);
    expect(calls[1].url).toBe('/v1/courses?limit=100&cursor=c1');
  });
});
