import { describe, expect, test } from 'vitest';
import { ApiError } from './http.js';
import {
  createAssessment,
  createCourse,
  deleteAssessment,
  generateAssessment,
  updateAssessment,
  deleteCourseDocument,
  enrollStudent,
  getAssessment,
  getAssessments,
  getEnrollments,
  getGradebook,
  getGradesSummary,
  getStudentGrades,
  updateGrading,
  setAssessmentStatus,
  submitAssessment,
  deleteTutorConversation,
  getCourseDocuments,
  getCourses,
  getMyGrades,
  getTutorConversation,
  getTutorConversations,
  login,
  uploadCourseFile,
} from './portalApi.js';

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

describe('conversaciones del tutor (v1.2)', () => {
  test('lista las del curso (hasta 50) con el token', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { data: [] } });
    expect(await getTutorConversations('t1', 'c1', { fetchImpl })).toEqual({ data: [] });
    expect(calls[0].url).toBe('/v1/courses/c1/tutor-conversations?limit=50');
    expect(calls[0].init.headers.authorization).toBe('Bearer t1');
  });

  test('pide una conversación por su id', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { id: 'k1', messages: [] } });
    expect((await getTutorConversation('t1', 'k1', { fetchImpl })).id).toBe('k1');
    expect(calls[0].url).toBe('/v1/tutor-conversations/k1');
    expect(calls[0].init.method).toBe('GET');
  });

  test('borrar usa DELETE y un 204 sin cuerpo devuelve null', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    };
    expect(await deleteTutorConversation('t1', 'k1', { fetchImpl })).toBeNull();
    expect(calls[0].url).toBe('/v1/tutor-conversations/k1');
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].init.headers.authorization).toBe('Bearer t1');
  });

  test('los ids van codificados en la URL', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { data: [] } });
    await getTutorConversations('t1', 'a/b?c', { fetchImpl });
    expect(calls[0].url).toBe('/v1/courses/a%2Fb%3Fc/tutor-conversations?limit=50');
  });

  test('un 404 (conversación ajena o borrada) llega como ApiError', async () => {
    const { fetchImpl } = fakeFetch({ status: 404, body: { status: 404, detail: 'La conversación o el curso no existe, o no es tuyo' } });
    const err = await getTutorConversation('t1', 'k1', { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
  });
});

describe('apuntes del tutor por curso (v1.3)', () => {
  test('lista los apuntes del curso con el token', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { data: [{ name: 'a.md', chunks: 2, official: false }] } });
    expect((await getCourseDocuments('t1', 'c1', { fetchImpl })).data[0].name).toBe('a.md');
    expect(calls[0].url).toBe('/v1/courses/c1/documents');
    expect(calls[0].init.headers.authorization).toBe('Bearer t1');
  });

  test('subir usa PUT con el nombre codificado, el archivo como cuerpo y el tipo según la extensión', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 201, body: { name: 'Clase 1 · Ángulos.pdf', chunks: 3, official: false, pages: 2 } });
    const file = new File(['%PDF-1.4'], 'Clase 1 · Ángulos.pdf');
    expect((await uploadCourseFile('t1', 'c1', file, { fetchImpl })).pages).toBe(2);
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].url).toBe(`/v1/courses/c1/documents/${encodeURIComponent('Clase 1 · Ángulos.pdf')}`);
    expect(calls[0].init.headers['content-type']).toBe('application/pdf');
    expect(calls[0].init.headers.authorization).toBe('Bearer t1');
    expect(calls[0].init.body).toBe(file);
  });

  test('un .md se envía como text/markdown y un .txt como text/plain', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 201, body: {} }, { status: 200, body: {} });
    await uploadCourseFile('t', 'c', new File(['# A'], 'a.MD'), { fetchImpl });
    await uploadCourseFile('t', 'c', new File(['a'], 'a.txt'), { fetchImpl });
    expect(calls[0].init.headers['content-type']).toBe('text/markdown');
    expect(calls[1].init.headers['content-type']).toBe('text/plain');
  });

  test('un error al subir (p. ej. 422 PDF escaneado) llega como ApiError con su detail', async () => {
    const { fetchImpl } = fakeFetch({ status: 422, body: { status: 422, detail: 'El PDF no tiene texto seleccionable (parece un escaneo).' } });
    const err = await uploadCourseFile('t', 'c', new File(['%PDF'], 'x.pdf'), { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/escaneo/);
  });

  test('sin conexión al subir da ApiError con status 0', async () => {
    const { fetchImpl } = fakeFetch(new TypeError('Failed to fetch'));
    const err = await uploadCourseFile('t', 'c', new File(['a'], 'a.md'), { fetchImpl }).catch((e) => e);
    expect(err.status).toBe(0);
  });

  test('quitar usa DELETE con el nombre codificado y un 204 devuelve null', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    };
    expect(await deleteCourseDocument('t1', 'c1', 'MINEDUC · Matemática', { fetchImpl })).toBeNull();
    expect(calls[0].url).toBe(`/v1/courses/c1/documents/${encodeURIComponent('MINEDUC · Matemática')}`);
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('ciclo mínimo (v1.4)', () => {
  const KEY = crypto.randomUUID(); // UUID de prueba generado en cada corrida

  test('los POST envían la Idempotency-Key y el cuerpo JSON', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 201, body: { id: 'c1' } }, { status: 201, body: {} }, { status: 201, body: {} }, { status: 201, body: {} });
    await createCourse('t', { name: 'Lenguaje 7° B', period: '2026-S2' }, KEY, { fetchImpl });
    await enrollStudent('t', 'c1', 'camila@demo-a.cl', KEY, { fetchImpl });
    await createAssessment('t', 'c1', { title: 'Prueba', questions: [] }, KEY, { fetchImpl });
    await submitAssessment('t', 'e1', [{ question_id: 'q1', selected_option: 1 }], KEY, { fetchImpl });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', '/v1/courses'], ['POST', '/v1/courses/c1/enrollments'], ['POST', '/v1/courses/c1/assessments'], ['POST', '/v1/assessments/e1/submissions'],
    ]);
    for (const c of calls) {
      expect(c.init.headers['idempotency-key']).toBe(KEY);
      expect(c.init.headers.authorization).toBe('Bearer t');
    }
    expect(JSON.parse(calls[1].init.body)).toEqual({ student_email: 'camila@demo-a.cl' });
    expect(JSON.parse(calls[3].init.body)).toEqual({ answers: [{ question_id: 'q1', selected_option: 1 }] });
  });

  test('las lecturas y el PATCH no llevan Idempotency-Key; los ids van codificados', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { data: [] } }, { body: { data: [] } }, { body: {} }, { body: {} });
    await getEnrollments('t', 'a/b', { fetchImpl });
    await getAssessments('t', 'c1', { fetchImpl });
    await getAssessment('t', 'e1', { fetchImpl });
    await setAssessmentStatus('t', 'e1', 'published', { fetchImpl });
    expect(calls[0].url).toBe('/v1/courses/a%2Fb/enrollments');
    expect(calls.map((c) => c.init.method)).toEqual(['GET', 'GET', 'GET', 'PATCH']);
    expect(JSON.parse(calls[3].init.body)).toEqual({ status: 'published' });
    for (const c of calls) expect(c.init.headers['idempotency-key']).toBeUndefined();
  });

  test('un 409 (ya rindió) o un 422 (falta la correcta) llegan como ApiError con su detalle', async () => {
    const { fetchImpl } = fakeFetch({ status: 409, body: { status: 409, detail: 'Ya rendiste esta evaluación.' } }, { status: 422, body: { status: 422, detail: 'No se puede publicar: la pregunta 2 no tiene respuesta correcta.' } });
    const a = await submitAssessment('t', 'e1', [], KEY, { fetchImpl }).catch((e) => e);
    const b = await setAssessmentStatus('t', 'e1', 'published', { fetchImpl }).catch((e) => e);
    expect([a.status, a.message]).toEqual([409, 'Ya rendiste esta evaluación.']);
    expect(b.status).toBe(422);
  });
});

describe('evaluaciones con IA y borradores (v1.5)', () => {
  test('generar es un POST sin Idempotency-Key (no crea nada); editar es PUT y borrar es DELETE', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return init.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ title: 'T', questions: [], source: 'tema', sources: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    await generateAssessment('t', 'c1', { topic: 'Fracciones', questions_count: 3, use_notes: false }, { fetchImpl });
    await updateAssessment('t', 'e1', { title: 'Nuevo', questions: [] }, { fetchImpl });
    expect(await deleteAssessment('t', 'e1', { fetchImpl })).toBeNull();
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([['POST', '/v1/courses/c1/assessments/generate'], ['PUT', '/v1/assessments/e1'], ['DELETE', '/v1/assessments/e1']]);
    expect(calls[0].init.headers['idempotency-key']).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toEqual({ topic: 'Fracciones', questions_count: 3, use_notes: false });
  });

  test('los errores de la IA (422 sin apuntes, 429 tope, 502 modelo) llegan con su mensaje', async () => {
    for (const [status, detail] of [[422, 'No encontré apuntes del curso sobre ese tema.'], [429, 'Espera 10 min antes de generar otra evaluación'], [502, 'El modelo no devolvió preguntas utilizables.']]) {
      const { fetchImpl } = fakeFetch({ status, body: { status, detail } });
      const err = await generateAssessment('t', 'c1', { topic: 'x y z' }, { fetchImpl }).catch((e) => e);
      expect([err.status, err.message]).toEqual([status, detail]);
    }
  });
});

describe('notas del curso para el docente (H3)', () => {
  test('libro, resumen y notas de un estudiante son GET con los ids codificados', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: {} }, { body: {} }, { body: {} }, { body: {} });
    await getGradebook('t', 'c/1', { fetchImpl });
    await getGradesSummary('t', 'c1', { fetchImpl });
    await getGradesSummary('t', 'c1', { threshold: 4.5, fetchImpl });
    await getStudentGrades('t', 'c1', 's/1', { fetchImpl });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', '/v1/courses/c%2F1/gradebook'],
      ['GET', '/v1/courses/c1/grades/summary'],
      ['GET', '/v1/courses/c1/grades/summary?threshold=4.5'],
      ['GET', '/v1/courses/c1/students/s%2F1/grades'],
    ]);
    for (const c of calls) expect(c.init.headers.authorization).toBe('Bearer t');
  });

  test('cambiar exigencia o ponderación es un PATCH con solo los campos enviados', async () => {
    const { fetchImpl, calls } = fakeFetch({ body: { assessment_id: 'e1', title: 'T', pass_threshold: 50, weight: 2 } });
    const r = await updateGrading('t', 'e1', { pass_threshold: 50 }, { fetchImpl });
    expect([calls[0].init.method, calls[0].url]).toEqual(['PATCH', '/v1/assessments/e1/grading']);
    expect(JSON.parse(calls[0].init.body)).toEqual({ pass_threshold: 50 });
    expect(calls[0].init.headers['idempotency-key']).toBeUndefined();
    expect(r.weight).toBe(2);
  });

  test('un 403 (estudiante) o un 400 (valor fuera de rango) llegan como ApiError', async () => {
    const { fetchImpl } = fakeFetch({ status: 403, body: { status: 403, detail: 'No tienes permiso' } }, { status: 400, body: { status: 400, detail: '"weight" debe ser un número mayor que 0' } });
    const a = await getGradebook('t', 'c1', { fetchImpl }).catch((e) => e);
    const b = await updateGrading('t', 'e1', { weight: 0 }, { fetchImpl }).catch((e) => e);
    expect(a).toBeInstanceOf(ApiError);
    expect(a.status).toBe(403);
    expect([b.status, b.message]).toEqual([400, '"weight" debe ser un número mayor que 0']);
  });
});
