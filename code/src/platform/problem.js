import { LlmUnavailableError } from '../modules/tutor/llm-client.js';

const TYPE_BASE = 'https://api.feathersforall.example/errors/';

/** Error HTTP que se serializa como RFC 7807 (application/problem+json). */
export class HttpProblem extends Error {
  constructor(status, title, detail, type = slug(title)) {
    super(detail ?? title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
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
  if (err.type === 'entity.parse.failed') {
    return new HttpProblem(400, 'Solicitud inválida', 'El cuerpo no es JSON válido', 'invalid-json');
  }
  if (err.type === 'entity.too.large') {
    return new HttpProblem(413, 'Solicitud demasiado grande', 'El cuerpo supera el tamaño permitido');
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
    });
}
