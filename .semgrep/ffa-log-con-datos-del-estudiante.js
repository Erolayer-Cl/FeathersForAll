// Casos de prueba de la regla (semgrep --test .semgrep/). No es código de la app.
function casos(req, logger, metrics, messages, text, err) {
  // ruleid: ffa-log-con-datos-del-estudiante
  req.log.info({ body: req.body }, 'request');

  // ruleid: ffa-log-con-datos-del-estudiante
  logger.debug(req.body.messages);

  // ruleid: ffa-log-con-datos-del-estudiante
  req.log.info({ ...metrics, messages }, 'tutor');

  // ruleid: ffa-log-con-datos-del-estudiante
  console.log('pregunta del estudiante', req.body);

  // ruleid: ffa-log-con-datos-del-estudiante
  const hijo = logger.child({ question: req.body.messages.at(-1) });

  // ok: ffa-log-con-datos-del-estudiante
  req.log.info({ ...metrics, total_ms: 12 }, 'tutor');

  // ok: ffa-log-con-datos-del-estudiante
  req.log.warn({ err: err.message }, 'no se pudo guardar el turno del tutor');

  // ok: ffa-log-con-datos-del-estudiante
  logger.info({ method: req.method, path: req.path, status: 200 }, 'request');

  // ok: ffa-log-con-datos-del-estudiante
  console.log('✔ usuario feathersforall_app (sin BYPASSRLS)');
}
