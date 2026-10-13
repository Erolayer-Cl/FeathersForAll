import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpProblem } from './problem.js';

// Contrato S05 (bearerAuth): el JWT trae sub, tenant_id y role.
const ROLES = new Set(['docente', 'estudiante', 'admin_colegio']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(data, secret) {
  return createHmac('sha256', secret).update(data).digest();
}

/** Firma un JWT HS256. Lo usan las pruebas y `npm run dev:token`; en producción emite el SSO. */
export function signJwt(claims, secret, { expiresInSec = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now, exp: now + expiresInSec, ...claims }));
  return `${header}.${payload}.${b64url(sign(`${header}.${payload}`, secret))}`;
}

/** Devuelve los claims si el token es válido; si no, null. */
export function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    // Solo HS256: un token con alg "none" u otro algoritmo se rechaza.
    if (JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') return null;
    const expected = sign(`${header}.${payload}`, secret);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Exige un Bearer JWT válido y deja en req.user { id, colegioId, rol }.
 * Sin secreto configurado rechaza todo (fail-closed), igual que el RLS.
 */
export function requireAuth(secret) {
  return (req, _res, next) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    const claims = secret && scheme === 'Bearer' && token ? verifyJwt(token, secret) : null;
    if (!claims || !UUID.test(claims.sub ?? '') || !UUID.test(claims.tenant_id ?? '') || !ROLES.has(claims.role)) {
      throw new HttpProblem(401, 'No autenticado', 'Falta un token válido (Authorization: Bearer <JWT>)', 'unauthorized');
    }
    req.user = { id: claims.sub, colegioId: claims.tenant_id, rol: claims.role };
    next();
  };
}

/**
 * Como requireAuth, pero sin token deja pasar sin req.user (rutas de desarrollo
 * como el chat). Un token presente pero inválido igual se rechaza con 401.
 */
export function optionalAuth(secret) {
  const strict = requireAuth(secret);
  return (req, res, next) => {
    if (!req.get('authorization')) return next();
    return strict(req, res, next);
  };
}
