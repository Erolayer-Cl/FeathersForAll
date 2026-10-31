import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt con N=2^14, r=8, p=5: equivale al mínimo de OWASP (Password Storage Cheat Sheet) y usa
// 16 MiB por cálculo, dentro del límite por defecto de Node (32 MiB). Los parámetros quedan
// guardados en cada hash, así que se pueden subir más adelante sin invalidar las claves antiguas.
const PARAMS = { N: 2 ** 14, r: 8, p: 5 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Para no aceptar un hash guardado con parámetros absurdos (un cálculo de varios segundos).
const LIMITS = { N: 2 ** 17, r: 16, p: 16 };

// Hash de una clave cualquiera: se usa cuando no hay hash que comparar (ver verifyPassword).
let dummyHash;

/** Hash de una contraseña con el formato "scrypt$N$r$p$<sal>$<clave>" (base64url). */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize('NFC'), salt, KEY_BYTES, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

function parse(stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64url');
  const key = Buffer.from(parts[5], 'base64url');
  const sane = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0 && N <= LIMITS.N
    && Number.isInteger(r) && r > 0 && r <= LIMITS.r
    && Number.isInteger(p) && p > 0 && p <= LIMITS.p
    && salt.length >= 8 && key.length >= 16;
  return sane ? { params: { N, r, p }, salt, key } : null;
}

/**
 * ¿La contraseña coincide con el hash guardado? Nunca lanza error.
 *
 * Siempre calcula un scrypt, aunque no haya hash (usuario inexistente) o el hash no sea de
 * contraseña (por ejemplo '!sso', una cuenta que solo entra por SSO): así el tiempo de respuesta
 * del login no revela qué correos existen.
 */
export async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed) {
    dummyHash ??= parse(await hashPassword('clave-de-relleno'));
    await scryptAsync(String(password ?? ''), dummyHash.salt, dummyHash.key.length, dummyHash.params);
    return false;
  }
  const key = await scryptAsync(String(password).normalize('NFC'), parsed.salt, parsed.key.length, parsed.params);
  return timingSafeEqual(key, parsed.key);
}
