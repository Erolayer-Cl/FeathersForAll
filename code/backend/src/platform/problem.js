import { LlmUnavailableError } from '../modules/tutor/llm-client.js';
import { DbUnavailableError, SessionRevokedError } from './db.js';

const TYPE_BASE = 'https://api.feathersforall.example/errors/';

/** Error HTTP que se serializa como RFC 7807 (application/problem+json). */
export class HttpProblem extends Error {
  /** `extra`: campos adicionales del problema (extensiones RFC 7807), p. ej. `errors` en un 422. */
  constructor(status, title, detail, type = slug(title), extra = undefined) {
    super(detail ?? title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
    this.extra = extra;
  }
}

function slug(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toProblem(err) {
  if (err instanceof HttpProblem) return err;
  if (err instanceof LlmUnavailableError) {
    return new HttpProblem(503, 'Tutor no disponible', err.message, 'llm-unavailable');
  }
  if (err instanceof SessionRevokedError) {
    return new HttpProblem(401, 'No autenticado', 'Tu sesión ya no es válida: vuelve a iniciar sesión', 'unauthorized');
  }
  if (err instanceof DbUnavailableError) {
    return new HttpProblem(503, 'Base de datos no disponible', err.message, 'db-unavailable');
  }
  // Errores de PostgreSQL que son del cliente y no un fallo del servidor. El mensaje de la base nunca sale.
  if (err.code === '42501') return new HttpProblem(403, 'Prohibido', 'Tu rol no puede hacer esta operación', 'forbidden');
  if (err.code === '23505') return new HttpProblem(409, 'Conflicto', 'Ya existe un registro con esos datos', 'conflict');
  if (['23503', '23514', '22001', '22P02', '22021', '22023'].includes(err.code)) {
    return new HttpProblem(422, 'Datos inválidos', 'Los datos enviados no cumplen las reglas del sistema', 'validation-error');
  }
  // Express no pudo decodificar un parámetro de la URL ("%E0%A4%A"): es un error del cliente.
  if (err instanceof URIError) {
    return new HttpProblem(400, 'Solicitud inválida', 'La URL tiene caracteres mal codificados', 'invalid-request');
  }
  if (err.type === 'entity.parse.failed') {
    return new HttpProblem(400, 'Solicitud inválida', 'El cuerpo no es JSON válido', 'invalid-json');
  }
  if (err.type === 'entity.too.large') {
    return new HttpProblem(413, 'Solicitud demasiado grande', 'El cuerpo supera el tamaño permitido');
  }
  // Otros errores del cliente que detecta Express (charset o Content-Encoding no soportado → 415, etc.).
  if (err.expose && err.status >= 400 && err.status < 500) {
    return new HttpProblem(err.status, 'Solicitud inválida', err.message, 'invalid-request');
  }
  return new HttpProblem(500, 'Error interno', 'Ocurrió un error inesperado', 'internal-error');
}

export function notFound(req, _res, next) {
  next(new HttpProblem(404, 'No encontrado', `No existe ${req.method} ${req.path}`, 'not-found'));
}

export function problemHandler(err, req, res, _next) {
  const problem = toProblem(err);
  if (problem.status >= 500) req.log.error({ err }, problem.title);

  if (res.headersSent) return res.destroy();
  res
    .status(problem.status)
    .type('application/problem+json')
    .json({
      type: TYPE_BASE + problem.type,
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      instance: req.originalUrl,
      trace_id: req.traceId,
      ...problem.extra,
    });
}
