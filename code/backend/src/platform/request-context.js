import { randomUUID } from 'node:crypto';

/**
 * Asigna trace_id a cada request y registra una línea JSON al terminar (12-Factor 11).
 * Nunca se registra el cuerpo: puede contener preguntas de menores de edad. Tampoco la ruta real: trae ids de
 * conversaciones y nombres de archivos de apuntes; se registra el PATRÓN de la ruta ("/v1/courses/:courseId/documents/:documentName").
 */
export function requestContext(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    req.traceId = randomUUID();
    req.log = logger.child({ trace_id: req.traceId });
    res.set('X-Trace-Id', req.traceId);

    res.on('close', () => {
      req.log.info({
        method: req.method,
        route: req.route ? `${req.baseUrl}${req.route.path}` : '(sin ruta)',
        status: res.statusCode,
        completed: res.writableFinished,
        duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
      }, 'request');
    });
    next();
  };
}
