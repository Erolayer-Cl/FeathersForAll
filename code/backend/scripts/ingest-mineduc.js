// Carga las Bases Curriculares del Mineduc en el RAG de uno o varios cursos, SOLO las que le corresponden a cada
// curso: su asignatura y su nivel (un curso de "Matemática 7° Básico" recibe las bases de Matemática de 7° básico a
// 2° medio y las generales; no las de Historia ni las de 1° a 6° básico).
//
//   npm run ingest:mineduc                                  → los PDF de data/mineduc/asignaturas/ (o, si no existe, los de data/mineduc/) en el curso por defecto
//   npm run ingest:mineduc -- --all-courses                 → en TODOS los cursos del colegio (DEFAULT_TENANT_ID), cada uno con lo suyo
//   npm run ingest:mineduc -- --course <id> --course <id>   → en cursos concretos
//   npm run ingest:mineduc -- ruta/a/archivo.pdf ...        → solo esos archivos
//   opciones:
//     --tenant <id>      otro colegio
//     --only <texto>     solo los PDF cuyo nombre, asignatura o título lo contenga
//     --subject <texto>  asignatura a usar en vez de la del curso (p. ej. con el almacén en archivo, que no sabe la del curso)
//     --level <nivel>    nivel a usar en vez del del curso (p. ej. 7B, 2M)
//     --force            reindexar aunque ya esté cargado
//     --remove-legacy    quitar de los cursos destino las Bases antiguas (un PDF por nivel con todas las asignaturas)
//
// Los PDF por asignatura traen varios niveles uno tras otro: se separan en tramos ("MINEDUC · Matemática · 7° básico a 2° medio").
// Los embeddings de cada tramo se calculan UNA vez y se guardan en todos los cursos que lo necesitan. Si un curso ya
// tiene el documento, se omite (puedes interrumpir con Ctrl+C y repetir: continúa donde quedó). Con DATABASE_URL guarda en
// PostgreSQL actuando como el docente de cada curso; sin ella, en el archivo JSON. Requiere `ollama serve` con bge-m3.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createDb } from '../src/platform/db.js';
import { createRag, ragConfigFromEnv } from '../src/modules/tutor/rag/create-rag.js';
import { extractPdfPages } from '../src/modules/tutor/rag/pdf-text.js';
import { referenceAppliesToLevel, referenceAppliesToSubject } from '../src/modules/tutor/rag/doc-kinds.js';
import { segmentPagesByLevel } from '../src/modules/tutor/rag/mineduc-segments.js';

const readJson = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const legacy = await readJson('./mineduc-catalogo.json'); // un PDF por nivel, todas las asignaturas mezcladas
const subjects = await readJson('./mineduc-asignaturas.json'); // un PDF por asignatura

// ---- argumentos
const args = process.argv.slice(2);
const courses = [];
const files = [];
let tenantId;
let only = '';
let subjectFlag;
let levelFlag;
let force = false;
let allCourses = false;
let removeLegacy = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--course') courses.push(args[++i]);
  else if (a === '--tenant') tenantId = args[++i];
  else if (a === '--only') only = (args[++i] ?? '').toLowerCase();
  else if (a === '--subject') subjectFlag = args[++i];
  else if (a === '--level') levelFlag = args[++i];
  else if (a === '--force') force = true;
  else if (a === '--all-courses') allCourses = true;
  else if (a === '--remove-legacy') removeLegacy = true;
  else if (a.startsWith('--')) { console.error(`Opción desconocida: ${a}`); process.exit(1); }
  else files.push(a);
}

const config = ragConfigFromEnv();
tenantId ??= config.tenantId;

const DIR = existsSync('data/mineduc/asignaturas') ? 'data/mineduc/asignaturas' : 'data/mineduc';
const legacyTitle = (file) => legacy[basename(file)] ?? `MINEDUC · ${basename(file, '.pdf').replace(/[_-]+/g, ' ')}`;
const subjectOf = (file) => subjects[basename(file)];
const labelOf = (file) => subjectOf(file)?.subject ?? legacyTitle(file);

let pdfs = files.length ? files : (existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)).sort().map((f) => join(DIR, f)) : []);
pdfs = pdfs.filter((f) => !only || basename(f).toLowerCase().includes(only) || labelOf(f).toLowerCase().includes(only));
if (pdfs.length === 0) {
  console.error(`No hay PDF para cargar. Copia los archivos a code/backend/${DIR}/ o pásalos como argumento.`);
  process.exit(1);
}
const missing = pdfs.filter((f) => !existsSync(f));
if (missing.length) {
  console.error(`No existe: ${missing.join(', ')}`);
  process.exit(1);
}

/** Documentos que salen de un PDF: uno por tramo de nivel (por asignatura), o uno solo (PDF antiguo). */
function entriesOf(file, pages) {
  const spec = subjectOf(file);
  if (!spec) return [{ title: legacyTitle(file), pages, offset: 0 }];
  const base = `MINEDUC · ${spec.subject}`;
  if (spec.level) return [{ title: `${base} · ${spec.level}`, pages, offset: 0 }];
  return segmentPagesByLevel(pages).map((s) => ({ title: s.level ? `${base} · ${s.level}` : base, pages: s.pages, offset: s.offset }));
}

const db = process.env.DATABASE_URL ? createDb({ connectionString: process.env.DATABASE_URL, max: 2 }) : undefined;
try {
  const rag = await createRag(config, { db });

  // ---- cursos de destino
  let targets = courses;
  if (allCourses) {
    if (!db) throw new Error('--all-courses necesita DATABASE_URL (con el almacén en archivo hay un solo curso).');
    targets = await db.withSession({ colegioId: tenantId, rol: 'admin_colegio' }, async (c) => (await c.query('SELECT id FROM cursos WHERE activo ORDER BY nombre')).rows.map((r) => r.id), { readOnly: true });
  }
  if (targets.length === 0) targets = [config.defaultCourseId];
  if (targets.length === 0) throw new Error('No hay curso de destino.');

  // Un curso = su docente como actor (la base aplica los mismos permisos que a la API) + su nivel y asignatura.
  const actors = new Map();
  const infos = new Map();
  for (const courseId of targets) {
    if (db) {
      const owner = await rag.courseOwner({ tenantId, courseId });
      if (!owner) throw new Error(`El curso "${courseId}" no existe en el colegio "${tenantId}".`);
      actors.set(courseId, { id: owner, rol: 'docente' });
    } else {
      actors.set(courseId, undefined);
    }
    const found = await rag.courseInfo?.({ tenantId, courseId });
    infos.set(courseId, { nivel: levelFlag ?? found?.nivel, asignatura: subjectFlag ?? found?.asignatura, nombre: found?.nombre });
  }
  console.log(`Destino: ${targets.length} curso(s) · colegio ${tenantId} · almacén ${rag.backend} · embeddings ${config.embeddingModel}`);
  for (const courseId of targets) {
    const i = infos.get(courseId);
    console.log(`  · ${courseId}: ${i.asignatura ?? i.nombre ?? 'asignatura desconocida'} · nivel ${i.nivel ?? 'desconocido'}`);
  }
  console.log('');

  // ¿Le sirve este documento a este curso? (asignatura y nivel; lo que no se sabe no se excluye)
  const servesCourse = (title, courseId) => {
    const i = infos.get(courseId);
    return referenceAppliesToLevel(title, i.nivel) && referenceAppliesToSubject(title, i.asignatura || i.nombre);
  };

  if (removeLegacy) {
    for (const courseId of targets) {
      for (const docId of Object.values(legacy)) {
        const removed = await rag.deleteDocument({ tenantId, courseId, docId, actor: actors.get(courseId) });
        if (removed) console.log(`− quitado "${docId}" del curso ${courseId}`);
      }
    }
    console.log('');
  }

  // ---- PDF por PDF
  let saved = 0;
  let skipped = 0;
  for (const file of pdfs) {
    // Sin leer el PDF: si su asignatura no sirve a ningún curso destino, se salta.
    const spec = subjectOf(file);
    if (spec && !targets.some((id) => servesCourse(`MINEDUC · ${spec.subject}`, id))) {
      console.log(`· ${spec.subject}: no corresponde a la asignatura de ningún curso destino`);
      continue;
    }

    process.stdout.write(`▶ ${labelOf(file)}\n  leyendo PDF… `);
    const pages = await extractPdfPages(await readFile(file));
    const entries = entriesOf(file, pages);
    console.log(`${pages.length} páginas → ${entries.length} documento(s)`);

    for (const entry of entries) {
      const serving = targets.filter((id) => servesCourse(entry.title, id));
      const pending = [];
      for (const courseId of serving) {
        const docs = await rag.listDocuments({ tenantId, courseId });
        if (!force && docs.some((d) => d.doc_id === entry.title)) skipped++;
        else pending.push(courseId);
      }
      if (serving.length === 0) { console.log(`  · ${entry.title}: no es del nivel/asignatura de ningún curso destino`); continue; }
      if (pending.length === 0) { console.log(`  · ${entry.title}: ya estaba cargado (usa --force para reindexar)`); continue; }

      const t0 = Date.now();
      let lastPrinted = 0;
      const prepared = await rag.prepare({
        pages: entry.pages,
        pageOffset: entry.offset,
        title: entry.title,
        onProgress: (done, total) => {
          if (done === total || done - lastPrinted >= 160) {
            lastPrinted = done;
            process.stdout.write(`\r  ${entry.title}: embeddings ${done}/${total} (${Math.round((Date.now() - t0) / 1000)} s)   `);
          }
        },
      });
      process.stdout.write('\n');
      for (const courseId of pending) {
        await rag.save({ tenantId, courseId, docId: entry.title, prepared, actor: actors.get(courseId) });
        saved++;
        console.log(`    ✔ ${prepared.chunks.length} fragmentos → curso ${courseId}`);
      }
    }
  }
  console.log(`\nListo: ${saved} documento(s) guardado(s), ${skipped} omitido(s) por estar ya cargados.`);
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  if (err.cause) console.error(`  causa: ${err.cause.message ?? err.cause}`);
  process.exitCode = 1;
} finally {
  await db?.end();
}
