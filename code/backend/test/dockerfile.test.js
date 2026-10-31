// La imagen final (etapa runtime del Dockerfile) solo lleva lo que copian sus COPY.
// Si un módulo de src/ importa un archivo que no se copia, el contenedor se cae al arrancar
// con ERR_MODULE_NOT_FOUND, aunque `npm test` pase (las pruebas corren con todo el repo).
// Esta prueba arma el mismo árbol de archivos que la imagen y carga la app en un proceso aparte.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** COPY de la última etapa (runtime), sin los que vienen de otra etapa (--from=...). */
function runtimeCopies(dockerfile) {
  const stages = dockerfile.split(/^FROM /m);
  return stages.at(-1)
    .split('\n')
    .filter((line) => /^COPY\s/.test(line) && !line.includes('--from='))
    .map((line) => {
      const [src, dest] = line.trim().split(/\s+/).slice(1);
      return { src, dest };
    });
}

// Dentro de `docker build --target test` el Dockerfile no está (.dockerignore lo excluye del contexto).
const SKIP = !existsSync(join(root, 'Dockerfile')) && 'sin Dockerfile (corriendo dentro del build de la imagen)';

describe('imagen de la API (Dockerfile, etapa runtime)', () => {
  test('la app carga solo con los archivos que copia la imagen', { skip: SKIP }, () => {
    const copies = runtimeCopies(readFileSync(join(root, 'Dockerfile'), 'utf8'));
    assert.ok(copies.some((c) => c.src === 'src'), 'el runtime debe copiar src/');

    const app = mkdtempSync(join(tmpdir(), 'ffa-image-'));
    try {
      for (const { src, dest } of copies) {
        const target = join(app, dest.endsWith('/') ? join(dest, src) : dest);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(root, src), target, { recursive: true });
      }
      // node_modules llega desde la etapa deps (COPY --from=deps).
      symlinkSync(join(root, 'node_modules'), join(app, 'node_modules'), 'dir');

      const run = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/app.js')"], {
        cwd: app,
        encoding: 'utf8',
      });
      assert.equal(run.status, 0, `la app no carga dentro de la imagen:\n${run.stderr}`);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
