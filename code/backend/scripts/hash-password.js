// Genera el hash de una contraseña para usuarios.password_hash (formato de src/platform/password.js).
//
//   npm run -s hash:password -- 'la-contraseña'
//
// Sirve para crear usuarios a mano o regenerar los del seed demo (db/90_seed_demo.sql).
// La contraseña queda en el historial de la terminal: úsalo solo con claves de desarrollo.
import { hashPassword } from '../src/platform/password.js';

const [password] = process.argv.slice(2);
if (!password) {
  console.error("Uso: npm run -s hash:password -- '<contraseña>'");
  process.exit(1);
}
console.log(await hashPassword(password));
