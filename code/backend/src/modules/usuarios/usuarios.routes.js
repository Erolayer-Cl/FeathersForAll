import { Router } from 'express';
import { signJwt } from '../../platform/auth.js';
import { hashPassword, verifyPassword } from '../../platform/password.js';
import { HttpProblem } from '../../platform/problem.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../platform/pagination.js';
import { withIdempotency } from '../../platform/idempotency.js';
import { UUID, invalid, uuidParam } from '../../platform/validation.js';
import * as Q from '../../../db/queries.js';

// Gestión de usuarios del colegio y ciclo de vida de la cuenta (contrato v1.12, ADR 0017).
//   Admin del colegio: listar, crear, ver, editar (nombre, correo, activo) y restablecer la clave.
//   Cualquier rol: cambiar SU contraseña (POST /v1/me/password).
// El colegio sale del token (db.withUser); el RLS de 02 §9 solo deja escribir usuarios al admin y
// el trigger de 13 impide cambiar el rol o el colegio de una cuenta.

const ROLES = new Set(['docente', 'estudiante', 'admin_colegio', 'apoderado']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAVE = { min: 8, max: 256 };

const forbidden = (detail) => new HttpProblem(403, 'Prohibido', detail, 'forbidden');
const notFound = () => new HttpProblem(404, 'No encontrado', 'La cuenta no existe en tu colegio', 'not-found');
const soloAdmin = (user) => {
  if (user.rol !== 'admin_colegio') throw forbidden('Solo el administrador del colegio gestiona cuentas');
};

function leerNombre(value, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 3 || name.length > 150) throw invalid('"name" debe ser un texto de 3 a 150 caracteres');
  return name;
}

function leerCorreo(value, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 150) throw invalid('"email" debe ser un correo válido de hasta 150 caracteres');
  return email;
}

/** Contraseña nueva: 8 a 256 caracteres, con algo más que espacios y distinta del correo. */
function leerClave(value, nombre, { email } = {}) {
  if (typeof value !== 'string' || value.length < CLAVE.min || value.length > CLAVE.max || !value.trim()) {
    throw invalid(`"${nombre}" debe tener entre ${CLAVE.min} y ${CLAVE.max} caracteres`);
  }
  if (email && value.trim().toLowerCase() === email.toLowerCase()) {
    throw invalid(`"${nombre}" no puede ser igual al correo`);
  }
  return value;
}

/** Escapa % _ y \ para usar el texto de búsqueda dentro de un ILIKE. */
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

const toWard = (r) => ({ student_id: r.estudiante_id, name: r.nombre, email: r.email, active: r.activo, linked_at: r.created_at });

/** Fila de la base -> schema User del contrato. */
const toUser = (row) => ({
  id: row.id,
  name: row.nombre,
  email: row.email,
  role: row.rol,
  active: row.activo,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const cursorUsuarios = (v) => v.length === 2 && typeof v[0] === 'string' && UUID.test(v[1]);
const cursorAuditoria = (v) => v.length === 2 && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && UUID.test(v[1]);

/** Registra una acción en la bitácora del colegio, dentro de la MISMA transacción que la acción. */
const auditar = (c, accion, recursoId, detalle = {}) =>
  c.query(Q.AUDITAR, [accion, 'usuario', recursoId, JSON.stringify(detalle)]);

/**
 * @param {object} deps
 * @param {ReturnType<import('../../platform/db.js').createDb>} deps.db
 * @param {string} deps.jwtSecret
 * @param {number} deps.tokenTtlSeconds
 * @param {ReturnType<import('../../platform/login-limiter.js').createLoginLimiter>} deps.limiter
 *   freno de la clave actual en el cambio de contraseña (mismo que el login)
 */
export function createUsuariosRouter({ db, jwtSecret, tokenTtlSeconds, limiter }) {
  const router = Router();
  const read = (user, fn) => db.withUser(user, fn, { readOnly: true });

  router.get('/v1/users', async (req, res) => {
    soloAdmin(req.user);
    const { role, active, q } = req.query;
    if (role !== undefined && !ROLES.has(role)) throw invalid('"role" debe ser docente, estudiante, admin_colegio o apoderado');
    if (active !== undefined && active !== 'true' && active !== 'false') throw invalid('"active" debe ser true o false');
    if (q !== undefined && (typeof q !== 'string' || q.length > 100)) throw invalid('"q" debe ser un texto de hasta 100 caracteres');
    const busqueda = typeof q === 'string' && q.trim() ? escaparLike(q.trim()) : null;
    const limit = parseLimit(req.query.limit);
    const after = req.query.cursor === undefined ? [null, null] : decodeCursor(req.query.cursor, cursorUsuarios);

    const rows = await read(req.user, async (c) => (await c.query(Q.USUARIOS_LISTA, [
      role ?? null, active === undefined ? null : active === 'true', busqueda, limit + 1, ...after,
    ])).rows);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    res.json({
      data: page.map(toUser),
      next_cursor: rows.length > limit ? encodeCursor([last.nombre, last.id]) : null,
    });
  });

  router.post('/v1/users', async (req, res) => {
    soloAdmin(req.user);
    const name = leerNombre(req.body?.name);
    const email = leerCorreo(req.body?.email);
    const role = req.body?.role;
    if (!ROLES.has(role)) throw invalid('"role" debe ser docente, estudiante, admin_colegio o apoderado');
    const password = leerClave(req.body?.password, 'password', { email });
    // El hash se calcula antes de abrir la transacción: scrypt no debe retener una conexión del pool.
    const hash = await hashPassword(password);
    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const row = (await c.query(Q.USUARIO_CREAR, [name, email, hash, role])).rows[0];
        await auditar(c, 'usuario.crear', row.id, { rol: role });
        // La respuesta (que se guarda para la idempotencia) nunca lleva la clave.
        return { status: 201, body: toUser(row) };
      },
    });
  });

  router.get('/v1/users/:userId', async (req, res) => {
    soloAdmin(req.user);
    const userId = uuidParam(req.params.userId, 'userId');
    const out = await read(req.user, async (c) => {
      const row = (await c.query(Q.USUARIO_DETALLE, [userId])).rows[0];
      if (!row) return null;
      const cursos = (await c.query(Q.USUARIO_CURSOS, [userId])).rows;
      const pupilos = row.rol === 'apoderado' ? (await c.query(Q.PUPILOS_DE_APODERADO, [userId])).rows : null;
      return { row, cursos, pupilos };
    });
    if (!out) throw notFound();
    res.json({
      ...toUser(out.row),
      courses: out.cursos.map((c) => ({ id: c.id, name: c.nombre, period: c.periodo, subject: c.asignatura, relation: c.relacion })),
      // v1.12 (MVP 5): estudiantes a cargo de un apoderado.
      ...(out.pupilos && { wards: out.pupilos.map(toWard) }),
    });
  });

  router.patch('/v1/users/:userId', async (req, res) => {
    soloAdmin(req.user);
    const userId = uuidParam(req.params.userId, 'userId');
    const body = req.body ?? {};
    const permitidos = new Set(['name', 'email', 'active']);
    const desconocidos = Object.keys(body).filter((k) => !permitidos.has(k));
    if (desconocidos.length) throw invalid(`Campos no editables: ${desconocidos.join(', ')} (el rol no se cambia: crea otra cuenta)`);
    const name = leerNombre(body.name, { optional: true });
    const email = leerCorreo(body.email, { optional: true });
    if (body.active !== undefined && typeof body.active !== 'boolean') throw invalid('"active" debe ser true o false');
    const active = body.active ?? null;
    if (name === null && email === null && active === null) throw invalid('Indica al menos uno de: name, email, active');
    // Un admin que se desactiva a sí mismo deja al colegio sin acceso de administración.
    if (userId === req.user.id && active === false) {
      throw new HttpProblem(409, 'Conflicto', 'No puedes desactivar tu propia cuenta', 'self-deactivation');
    }

    const row = await db.withUser(req.user, async (c) => {
      const antes = (await c.query(Q.USUARIO_DETALLE, [userId])).rows[0];
      if (!antes) return null;
      const despues = (await c.query(Q.USUARIO_ACTUALIZAR, [userId, name, email, active])).rows[0];
      const cambios = {};
      if (name !== null && name !== antes.nombre) cambios.nombre = true;
      if (email !== null && email !== String(antes.email).toLowerCase()) cambios.correo = true;
      if (active !== null && active !== antes.activo) cambios.activo = active;
      if (Object.keys(cambios).length) {
        await auditar(c, active === false && antes.activo ? 'usuario.desactivar'
          : active === true && !antes.activo ? 'usuario.reactivar' : 'usuario.editar', userId, cambios);
      }
      return despues;
    });
    if (!row) throw notFound();
    res.json(toUser(row));
  });

  // MVP 5 · Vincular un estudiante del colegio a un apoderado (por correo). Solo admin; queda en la bitácora.
  router.post('/v1/users/:userId/wards', async (req, res) => {
    soloAdmin(req.user);
    const userId = uuidParam(req.params.userId, 'userId');
    const email = typeof req.body?.student_email === 'string' ? req.body.student_email.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 150) throw invalid('"student_email" debe ser un correo válido');
    await withIdempotency({
      db, req, res,
      run: async (c) => {
        const apoderado = (await c.query(Q.USUARIO_DETALLE, [userId])).rows[0];
        if (!apoderado) throw notFound();
        if (apoderado.rol !== 'apoderado') throw new HttpProblem(409, 'Conflicto', 'Solo se vinculan estudiantes a una cuenta de apoderado', 'not-a-guardian');
        const fila = (await c.query(Q.VINCULAR_PUPILO, [userId, email])).rows[0];
        if (!fila) throw new HttpProblem(404, 'No encontrado', 'No hay un estudiante activo con ese correo en tu colegio', 'not-found');
        await auditar(c, 'apoderado.vincular', userId, { estudiante: fila.estudiante_id });
        const pupilo = (await c.query(Q.PUPILOS_DE_APODERADO, [userId])).rows.find((r) => r.estudiante_id === fila.estudiante_id);
        return { status: 201, body: toWard(pupilo) };
      },
    });
  });

  router.delete('/v1/users/:userId/wards/:studentId', async (req, res) => {
    soloAdmin(req.user);
    const userId = uuidParam(req.params.userId, 'userId');
    const studentId = uuidParam(req.params.studentId, 'studentId');
    const ok = await db.withUser(req.user, async (c) => {
      const fila = (await c.query(Q.DESVINCULAR_PUPILO, [userId, studentId])).rows[0];
      if (!fila) return false;
      await auditar(c, 'apoderado.desvincular', userId, { estudiante: studentId });
      return true;
    });
    if (!ok) throw new HttpProblem(404, 'No encontrado', 'Ese estudiante no está vinculado a esta cuenta', 'not-found');
    res.status(204).end();
  });

  // Restablecer la clave de otra cuenta. Corta sus sesiones abiertas (trigger de 13). 204, sin cuerpo:
  // la clave la eligió el admin y no se devuelve ni se registra.
  router.put('/v1/users/:userId/password', async (req, res) => {
    soloAdmin(req.user);
    const userId = uuidParam(req.params.userId, 'userId');
    if (userId === req.user.id) {
      throw new HttpProblem(409, 'Conflicto', 'Para tu propia cuenta usa «Cambiar contraseña» (pide la clave actual)', 'use-own-password-change');
    }
    const password = leerClave(req.body?.password, 'password');
    const hash = await hashPassword(password);
    const ok = await db.withUser(req.user, async (c) => {
      const row = (await c.query(Q.USUARIO_RESTABLECER_CLAVE, [userId, hash])).rows[0];
      if (!row) return false;
      await auditar(c, 'usuario.restablecer_clave', userId);
      return true;
    });
    if (!ok) throw notFound();
    res.status(204).end();
  });

  // Cambiar la propia contraseña (cualquier rol). Pide la clave actual y entrega un token nuevo:
  // los anteriores, incluido el de esta petición, dejan de valer (sesiones_desde).
  router.post('/v1/me/password', async (req, res) => {
    const actual = req.body?.current_password;
    if (typeof actual !== 'string' || !actual || actual.length > CLAVE.max) throw invalid('"current_password" es obligatorio');

    const llave = `cambio-clave|${req.user.id}`;
    const espera = limiter.retryAfterSeconds(llave, limiter.maxFailures);
    if (espera > 0) {
      res.set('Retry-After', String(espera));
      throw new HttpProblem(429, 'Demasiados intentos', `Espera ${Math.ceil(espera / 60)} min antes de volver a intentar`, 'too-many-attempts');
    }

    const perfil = (await read(req.user, (c) => c.query(Q.PERFIL, [req.user.id]))).rows[0];
    if (!perfil) throw new HttpProblem(401, 'No autenticado', 'Tu cuenta ya no está activa', 'unauthorized');
    const nueva = leerClave(req.body?.new_password, 'new_password', { email: perfil.email });
    if (nueva === actual) throw invalid('La contraseña nueva debe ser distinta de la actual');

    // Igual que el login: el intento se reserva antes de verificar, para que pedidos en paralelo no se salten el freno.
    limiter.recordFailure(llave);
    const cred = (await read(req.user, (c) => c.query(Q.LOGIN, [perfil.email]))).rows.find((r) => r.id === req.user.id);
    if (!(await verifyPassword(actual, cred?.password_hash))) {
      throw new HttpProblem(422, 'Contraseña actual incorrecta', 'La contraseña actual no es correcta', 'invalid-current-password');
    }
    limiter.reset(llave);

    const hash = await hashPassword(nueva);
    await db.withUser(req.user, async (c) => {
      await c.query(Q.CAMBIAR_MI_CLAVE, [hash]);
      await auditar(c, 'usuario.cambiar_clave', req.user.id);
    });
    const accessToken = signJwt({ sub: req.user.id, tenant_id: req.user.colegioId, role: req.user.rol }, jwtSecret, { expiresInSec: tokenTtlSeconds });
    res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: tokenTtlSeconds });
  });

  // Bitácora del colegio (R-1): quién creó, editó, desactivó o restableció cuentas. Solo admin.
  router.get('/v1/audit-log', async (req, res) => {
    soloAdmin(req.user);
    const limit = parseLimit(req.query.limit);
    const after = req.query.cursor === undefined ? [null, null] : decodeCursor(req.query.cursor, cursorAuditoria);
    const rows = await read(req.user, async (c) => (await c.query(Q.AUDITORIA_LISTA, [limit + 1, ...after])).rows);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    res.json({
      data: page.map((r) => ({
        id: r.id,
        action: r.accion,
        resource: r.recurso,
        resource_id: r.recurso_id,
        details: r.detalle,
        actor: { id: r.actor_id, name: r.actor, role: r.actor_rol },
        created_at: r.created_at,
      })),
      next_cursor: rows.length > limit ? encodeCursor([last.cursor_at, last.id]) : null,
    });
  });

  return router;
}
