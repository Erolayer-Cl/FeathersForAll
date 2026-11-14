import pino from 'pino';

// Logger de la API con defensa en profundidad. La regla de fondo es no registrar nunca cuerpos, preguntas ni
// credenciales (menores de edad); esto protege por si algún día alguien registra un objeto de más.
//   - redact: cualquier campo que se llame password, token, authorization, cookie, etc. sale como [REDACTADO],
//     a cualquier profundidad razonable.
//   - err: los errores de PostgreSQL traen `detail` ("Key (email)=(x@y.cl) already exists"), `where` y `parameters`
//     con VALORES de las filas; se quitan. Queda el mensaje, el tipo, el código y la pila.
const CENSOR = '[REDACTADO]';
const CAMPOS = ['password', 'password_hash', 'token', 'access_token', 'authorization', 'cookie', 'secret', 'jwt'];
export const REDACT_PATHS = [...CAMPOS, ...CAMPOS.map((c) => `*.${c}`), ...CAMPOS.map((c) => `*.*.${c}`), 'req.headers', 'headers'];

const CAMPOS_DE_FILAS = ['detail', 'where', 'parameters', 'query', 'internalQuery', 'hint', 'data'];

/** Serializador de errores sin los valores de filas que agrega el driver de PostgreSQL. */
export function safeErr(err) {
  const base = pino.stdSerializers.err(err);
  for (const campo of CAMPOS_DE_FILAS) delete base[campo];
  return base;
}

export function createLogger({ level = 'info', destination } = {}) {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: CENSOR }, serializers: { err: safeErr } }, destination);
}
