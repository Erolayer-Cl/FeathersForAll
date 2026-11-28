import { Router } from 'express';
import { signJwt } from '../../platform/auth.js';
import { verifyPassword } from '../../platform/password.js';
import { HttpProblem } from '../../platform/problem.js';
import * as Q from '../../../db/queries.js';

// Roles que entran por este login. El master (sin colegio) opera con feathersforall_plataforma.
const ROLES_DE_COLEGIO = new Set(['docente', 'estudiante', 'admin_colegio', 'apoderado']);
const MAX_LARGO = { rbd: 20, email: 150, password: 256 };

// Freno del login en tres llaves. Topes en múltiplos del máximo del limiter (5 fallos en 15 min por defecto):
//   ip+correo -> x1 (5):  fuerza bruta sobre una cuenta desde un equipo. No deja afuera al dueño desde otro equipo.
//   ip        -> x10 (50): rociado de claves (la misma clave contra muchos correos) y gasto de CPU en scrypt.
//                          El margen es amplio porque una sala de computación sale a internet con una sola IP.
//   correo    -> x10 (50): ataque repartido entre muchas IP contra una misma cuenta.
const FRENOS = [
  { llave: (ip, email) => `ip+correo|${ip}|${email}`, veces: 1 },
  { llave: (ip) => `ip|${ip}`, veces: 10 },
  { llave: (_ip, email) => `correo|${email}`, veces: 10 },
];

const credencialesInvalidas = () =>
  new HttpProblem(401, 'Credenciales inválidas', 'El correo o la contraseña no son correctos', 'invalid-credentials');

const invalido = (nombre, obligatorio) => new HttpProblem(400, 'Solicitud inválida',
  `"${nombre}" ${obligatorio ? 'es obligatorio (texto' : 'debe ser texto'} de hasta ${MAX_LARGO[nombre]} caracteres${obligatorio ? ')' : ''}`, 'validation-error');

/**
 * Valida el cuerpo del login. El correo se normaliza para que el freno no se esquive con mayúsculas.
 * El RBD es opcional: estudiantes y docentes entran solo con correo (su cuenta ya está enlazada a un
 * colegio). Si viene, restringe la búsqueda a ese colegio (lo usa el acceso de administración).
 */
function leerCredenciales(body) {
  for (const nombre of ['email', 'password']) {
    const valor = body?.[nombre];
    if (typeof valor !== 'string' || !valor.trim() || valor.length > MAX_LARGO[nombre]) throw invalido(nombre, true);
  }
  let rbd = body?.rbd;
  if (rbd !== undefined && rbd !== null) {
    if (typeof rbd !== 'string' || rbd.length > MAX_LARGO.rbd) throw invalido('rbd', false);
    rbd = rbd.trim() || null;
  } else {
    rbd = null;
  }
  return { rbd, email: body.email.trim().toLowerCase(), password: body.password };
}

/**
 * Busca la cuenta y verifica la clave. Devuelve { id, colegioId, rol } o null.
 * Con RBD: dentro de ese colegio (login en dos pasos de siempre).
 * Sin RBD: el correo en todos los colegios; entra solo si la clave coincide con UNA cuenta.
 * Siempre se calcula al menos un hash, exista o no la cuenta (no se revela qué correos existen).
 */
async function autenticar(db, { rbd, email, password }) {
  let cuentas;
  if (rbd) {
    const colegioId = (await db.query(Q.COLEGIO_POR_RBD, [rbd])).rows[0]?.colegio_id ?? null;
    const fila = colegioId
      ? (await db.withColegio(colegioId, (c) => c.query(Q.LOGIN, [email]), { readOnly: true })).rows[0]
      : undefined;
    cuentas = fila ? [{ ...fila, colegio_id: colegioId }] : [];
  } else {
    cuentas = (await db.query(Q.CUENTAS_POR_CORREO, [email])).rows;
  }

  if (cuentas.length === 0) {
    await verifyPassword(password, undefined);
    return null;
  }
  const validas = [];
  for (const cuenta of cuentas) {
    if ((await verifyPassword(password, cuenta.password_hash)) && ROLES_DE_COLEGIO.has(cuenta.rol)) validas.push(cuenta);
  }
  // Más cuentas que las que entrega cuentas_por_correo() (14, LIMIT 21): no se adivina, se pide el RBD.
  if (!rbd && cuentas.length > 20) {
    throw new HttpProblem(409, 'Cuenta en varios colegios', 'Este correo está en más de un colegio: ingresa también el RBD', 'school-required');
  }
  // Mismo correo y misma clave en dos colegios: no se adivina cuál; se pide entrar con el RBD.
  if (validas.length > 1) {
    throw new HttpProblem(409, 'Cuenta en varios colegios', 'Este correo está en más de un colegio: ingresa también el RBD', 'school-required');
  }
  const cuenta = validas[0];
  return cuenta ? { id: cuenta.id, colegioId: cuenta.colegio_id, rol: cuenta.rol } : null;
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
 * Identidad y tenancy (bounded context, S06): login propio por correo + contraseña, RBD opcional (ADR 0007)
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

  // Login por correo + contraseña (el RBD es opcional, ver leerCredenciales). El colegio sale de la
  // cuenta encontrada, nunca de lo que mande el cliente. Pública: es la única ruta sin token.
  router.post('/v1/auth/login', async (req, res) => {
    const credenciales = leerCredenciales(req.body);
    // Las llaves no usan el RBD: pedirlo con y sin RBD no duplica los intentos permitidos.
    const llaves = FRENOS.map((f) => ({ key: f.llave(req.ip, credenciales.email), max: f.veces * limiter.maxFailures }));

    const espera = Math.max(...llaves.map(({ key, max }) => limiter.retryAfterSeconds(key, max)));
    if (espera > 0) {
      res.set('Retry-After', String(espera));
      throw new HttpProblem(429, 'Demasiados intentos', `Espera ${Math.ceil(espera / 60)} min antes de volver a intentar`, 'too-many-attempts');
    }

    // El intento se anota ANTES de verificar la clave (scrypt tarda): si se anotara después, cien logins
    // simultáneos leerían todos el contador en 0 y el freno no frenaría nada. Si la clave es correcta se devuelve.
    for (const { key } of llaves) limiter.recordFailure(key);
    let user;
    try {
      user = await autenticar(db, credenciales);
    } catch (err) {
      // 409 (cuenta en varios colegios) o la base caída: no es una clave mala, no cuenta.
      for (const { key } of llaves) limiter.forgive(key);
      throw err;
    }
    if (!user) throw credencialesInvalidas();
    // La clave correcta limpia lo de esta cuenta; a la IP solo se le devuelve este intento (no se "lava" con una cuenta propia).
    limiter.reset(llaves[0].key);
    limiter.reset(llaves[2].key);
    limiter.forgive(llaves[1].key);

    // El JWT lleva lo mínimo (datos de menores): quién es, de qué colegio y con qué rol.
    // El iat va explícito para cargar el perfil con la misma sesión que tendrá el token: si la clave
    // cambió hace poco (sesiones_desde, 13), un perfil cargado sin iat se tomaría por sesión vencida.
    const iat = Math.floor(Date.now() / 1000);
    const accessToken = signJwt({ sub: user.id, tenant_id: user.colegioId, role: user.rol, iat }, jwtSecret, { expiresInSec: tokenTtlSeconds });
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: tokenTtlSeconds,
      user: await cargarPerfil(db, { ...user, iat }),
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
