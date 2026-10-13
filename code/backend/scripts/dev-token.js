// Genera un JWT de DESARROLLO firmado con JWT_SECRET (en producción lo emite el SSO).
//
//   npm run dev:token -- docente      -> Ana Rojas, docente de Matemáticas (datos de 90_seed_demo.sql)
//   npm run dev:token -- estudiante   -> Camila Díaz
//   npm run dev:token -- admin        -> Marta Soto, admin del Colegio Demo A
//   npm run dev:token -- <sub> <tenant_id> <role>
//   npm run dev:token -- --http       -> todas las variables @token_* para pegar en requests/notas.http
import { signJwt } from '../src/platform/auth.js';

const COLEGIO_A = '11111111-1111-1111-1111-111111111111';
const COLEGIO_B = '22222222-2222-2222-2222-222222222222';
const DEMO = {
  docente: ['a0000000-0000-0000-0000-000000000001', COLEGIO_A, 'docente'],
  estudiante: ['e0000000-0000-0000-0000-000000000001', COLEGIO_A, 'estudiante'],
  admin: ['a0000000-0000-0000-0000-000000000003', COLEGIO_A, 'admin_colegio'],
  // Solo para probar rechazos: docente de otro curso y docente de otro colegio.
  docente_historia: ['a0000000-0000-0000-0000-000000000002', COLEGIO_A, 'docente'],
  docente_colegio_b: ['b0000000-0000-0000-0000-000000000001', COLEGIO_B, 'docente'],
};

const secret = process.env.JWT_SECRET;
const token = ([sub, tenant_id, role]) => signJwt({ sub, tenant_id, role }, secret, { expiresInSec: 8 * 3600 });

const args = process.argv.slice(2);
if (!secret) {
  console.error('Falta JWT_SECRET en .env');
  process.exit(1);
}

if (args[0] === '--http') {
  for (const [name, claims] of Object.entries(DEMO)) console.log(`@token_${name} = ${token(claims)}`);
} else {
  const claims = DEMO[args[0]] ?? args;
  if (claims.length !== 3) {
    console.error('Uso: npm run dev:token -- docente|estudiante|admin|--http  (o <sub> <tenant_id> <role>)');
    process.exit(1);
  }
  console.log(token(claims));
}
