// Casos de prueba de la regla (semgrep --test .semgrep/). No es código de la app.
function casos(req, db) {
  // ruleid: ffa-tenant-desde-el-cliente
  const colegio = req.body.colegio_id;

  // ruleid: ffa-tenant-desde-el-cliente
  const rol = req.query.role;

  // ruleid: ffa-tenant-desde-el-cliente
  const { tenant_id } = req.body;

  // ok: ffa-tenant-desde-el-cliente
  const tenant = req.user.colegioId;

  // ok: ffa-tenant-desde-el-cliente
  const courseId = req.body.course_id;

  // ok: ffa-tenant-desde-el-cliente
  return db.withUser(req.user, (c) => c.query('SELECT 1'));
}
