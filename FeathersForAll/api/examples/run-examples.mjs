// Ejecuta los ejemplos de esta carpeta contra el mock (Prism) o el backend real.
// Uso (Node 18+, sin dependencias):
//   1) npx @stoplight/prism-cli mock api/openapi.yaml      (en otra terminal)
//   2) node api/examples/run-examples.mjs                   (BASE_URL opcional)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4010";
const TOKEN = process.env.TOKEN ?? "token-de-prueba";
let failed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const ex = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const res = await fetch(BASE_URL + ex.path, {
    method: ex.method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...ex.headers },
    body: ex.body ? JSON.stringify(ex.body) : undefined,
  });
  const ok = res.status === ex.expect_status;
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${res.status} (esperado ${ex.expect_status})  ${ex.name}`);
}
process.exit(failed ? 1 : 0);
