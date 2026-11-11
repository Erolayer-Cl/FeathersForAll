// Casos de prueba de la regla (semgrep --test .semgrep/). No es código de la app.
import { createHmac } from 'node:crypto';
import { signJwt, verifyJwt, requireAuth } from '../code/backend/src/platform/auth.js';

const claims = { sub: 'x', tenant_id: 'y', role: 'estudiante' };

// ruleid: ffa-jwt-secreto-hardcodeado
signJwt(claims, 'un-secreto-que-quedo-en-el-repo');

const SECRETO = 'otro-secreto-en-una-constante';
// ruleid: ffa-jwt-secreto-hardcodeado
verifyJwt('a.b.c', SECRETO);

// ruleid: ffa-jwt-secreto-hardcodeado
requireAuth('secreto-fijo');

// ruleid: ffa-jwt-secreto-hardcodeado
createHmac('sha256', 'secreto-fijo');

// ruleid: ffa-jwt-secreto-hardcodeado
const conDefecto = process.env.JWT_SECRET || 'cambiar-en-produccion';

// ok: ffa-jwt-secreto-hardcodeado
signJwt(claims, process.env.JWT_SECRET);

// ok: ffa-jwt-secreto-hardcodeado
requireAuth(config.jwtSecret);

// ok: ffa-jwt-secreto-hardcodeado
const sinDefecto = process.env.JWT_SECRET;
