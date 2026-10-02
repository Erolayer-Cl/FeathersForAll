import { randomUUID } from 'node:crypto';

/**
 * Asigna trace_id a cada request y registra una línea JSON al terminar (12-Factor 11).
 * Nunca se registra el cuerpo: puede contener preguntas de menores de edad.
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
        path: req.path,
        status: res.statusCode,
        completed: res.writableFinished,
        duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
      }, 'request');
    });
    next();
  };
}
