import { Router } from 'express';
import { signJwt } from '../../platform/auth.js';
import { verifyPassword } from '../../platform/password.js';
import { HttpProblem } from '../../platform/problem.js';
import * as Q from '../../../db/queries.js';

// Roles que entran por este login. El master (sin colegio) opera con feathersforall_plataforma.
const ROLES_DE_COLEGIO = new Set(['docente', 'estudiante', 'admin_colegio']);
const MAX_LARGO = { rbd: 20, email: 150, password: 256 };

const credencialesInvalidas = () =>
  new HttpProblem(401, 'Credenciales inválidas', 'El RBD, el correo o la contraseña no son correctos', 'invalid-credentials');

/** Valida el cuerpo del login. El correo se normaliza para que el freno no se esquive con mayúsculas. */
function leerCredenciales(body) {
  const campos = { rbd: body?.rbd, email: body?.email, password: body?.password };
  for (const [nombre, valor] of Object.entries(campos)) {
    if (typeof valor !== 'string' || !valor.trim() || valor.length > MAX_LARGO[nombre]) {
      throw new HttpProblem(400, 'Solicitud inválida', `"${nombre}" es obligatorio (texto de hasta ${MAX_LARGO[nombre]} caracteres)`, 'validation-error');
    }
  }
  return { rbd: campos.rbd.trim(), email: campos.email.trim().toLowerCase(), password: campos.password };
}

/** Perfil del usuario de la sesión (contrato: schema Me), o null si la cuenta ya no está activa. */
async function cargarPerfil(db, user) {
  const row = (await db.withUser(user, (c) => c.query(Q.PERFIL, [user.id]), { readOnly: true })).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.nombre,
    email: row.email,
    role: row.rol,
    school: { id: row.colegio_id, name: row.colegio, rbd: row.rbd },
  };
}

/**
 * Identidad y tenancy (bounded context, S06): login propio por RBD + correo + contraseña (ADR 0007)
 * y el perfil del usuario autenticado.
 *
 * @param {object} deps
 * @param {ReturnType<import('../../platform/db.js').createDb>} deps.db
 * @param {string} deps.jwtSecret
 * @param {number} deps.tokenTtlSeconds        duración del JWT
 * @param {ReturnType<import('../../platform/login-limiter.js').createLoginLimiter>} deps.limiter
 */
export function createIdentidadRouter({ db, jwtSecret, tokenTtlSeconds, limiter }) {
  const router = Router();

  // Login en dos pasos (02 §7 + 04): el RBD da el colegio y, dentro de ESE colegio, se buscan
  // las credenciales del correo. Pública: es la única ruta con datos de colegio sin token.
  router.post('/v1/auth/login', async (req, res) => {
    const { rbd, email, password } = leerCredenciales(req.body);
    const claveFreno = `${rbd}|${email}`;

    const espera = limiter.retryAfterSeconds(claveFreno);
    if (espera > 0) {
      res.set('Retry-After', String(espera));
      throw new HttpProblem(429, 'Demasiados intentos', `Espera ${Math.ceil(espera / 60)} min antes de volver a intentar`, 'too-many-attempts');
    }

    const colegioId = (await db.query(Q.COLEGIO_POR_RBD, [rbd])).rows[0]?.colegio_id ?? null;
    const cuenta = colegioId
      ? (await db.withColegio(colegioId, (c) => c.query(Q.LOGIN, [email]), { readOnly: true })).rows[0]
      : undefined;

    // verifyPassword calcula el hash aunque no exista la cuenta: el tiempo de respuesta no
    // revela qué correos existen. Todos los fallos dan el mismo 401.
    const claveCorrecta = await verifyPassword(password, cuenta?.password_hash);
    if (!claveCorrecta || !ROLES_DE_COLEGIO.has(cuenta.rol)) {
      limiter.recordFailure(claveFreno);
      throw credencialesInvalidas();
    }
    limiter.reset(claveFreno);

    // El JWT lleva lo mínimo (datos de menores): quién es, de qué colegio y con qué rol.
    const user = { id: cuenta.id, colegioId, rol: cuenta.rol };
    const accessToken = signJwt({ sub: user.id, tenant_id: colegioId, role: user.rol }, jwtSecret, { expiresInSec: tokenTtlSeconds });
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: tokenTtlSeconds,
      user: await cargarPerfil(db, user),
    });
  });

  // Requiere req.user (requireAuth en app.js).
  router.get('/v1/me', async (req, res) => {
    const perfil = await cargarPerfil(db, req.user);
    if (!perfil) throw new HttpProblem(401, 'No autenticado', 'Tu cuenta ya no está activa', 'unauthorized');
    res.json(perfil);
  });

  return router;
}
