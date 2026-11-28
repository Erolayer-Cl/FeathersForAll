import express, { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import { esStaffDelCurso } from '../cursos/acceso-curso.js';
import { isReferenceDoc } from './rag/doc-kinds.js';
import { extractPdfPages } from './rag/pdf-text.js';
import { toRagProblem } from './rag/rag.routes.js';
import { assertCleanDocument } from './rag/injection-scan.js';
import * as Q from '../../../db/queries.js';

export const MAX_DOCUMENT_NAME = 120;
/** Tamaño máximo de un archivo de apuntes (el portal valida lo mismo antes de enviarlo). */
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

const TEXT_EXT = /\.(txt|md|markdown)$/i;
const PDF_EXT = /\.pdf$/i;
// Saltos de línea y otros caracteres de control: el nombre llega al prompt del tutor (lista de temas del curso).
const CONTROL_CHARS = /\p{Cc}/u;
// Tipos del contrato (putCourseDocument). Sin Content-Type también se acepta (binario).
const UPLOAD_TYPES = new Set(['', 'application/pdf', 'text/plain', 'text/markdown', 'application/octet-stream']);

/**
 * Texto de un .txt/.md: UTF-8, o UTF-16 con BOM (Bloc de notas "Unicode"); si no es UTF-8 válido se lee como
 * Windows-1252 (los "ANSI" de Windows), así "Fracción" no queda "Fracci�n". Sin el BOM ni caracteres NUL, que
 * PostgreSQL no acepta en un TEXT.
 */
export function decodeText(buffer) {
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buffer);
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) text = new TextDecoder('utf-16be').decode(buffer);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('windows-1252').decode(buffer);
    }
  }
  return text.replaceAll('\u0000', '');
}

/** Solo los tipos binarios del contrato: un formulario (multipart, urlencoded) o JSON se rechaza sin leerlo. */
function binaryBody(req, _res, next) {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_TYPES.has(type)) {
    throw new HttpProblem(415, 'Formato no soportado', 'Envía el archivo como cuerpo binario: application/pdf, text/plain, text/markdown o application/octet-stream', 'unsupported-media-type');
  }
  next();
}

/** Fila del RAG -> schema CourseDocument del contrato. `visible`: si los estudiantes lo descargan como material (14). */
const toDocument = ({ doc_id, chunks }, pages, visible) => ({
  name: doc_id,
  chunks,
  official: isReferenceDoc(doc_id),
  ...(visible !== undefined && !isReferenceDoc(doc_id) && { visible_to_students: visible }),
  ...(pages !== undefined && { pages }),
});

/** ?visible_to_students=true|false del PUT (v1.12). Ausente = undefined (nuevo: visible; reemplazo: no cambia). */
function leerVisible(valor) {
  if (valor === undefined) return undefined;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  throw invalid('"visible_to_students" debe ser true o false');
}

/**
 * Nombre del documento que se sube. Debe terminar en .pdf, .txt o .md; el prefijo "MINEDUC" queda
 * reservado para las Bases Curriculares (el tutor las trata como documento oficial, no como apunte).
 */
function uploadName(raw) {
  const name = (raw ?? '').trim();
  if (!name || name.length > MAX_DOCUMENT_NAME || CONTROL_CHARS.test(name)) {
    throw invalid(`El nombre del documento debe tener de 1 a ${MAX_DOCUMENT_NAME} caracteres, sin saltos de línea`);
  }
  if (!PDF_EXT.test(name) && !TEXT_EXT.test(name)) {
    throw new HttpProblem(415, 'Formato no soportado', 'Solo se aceptan archivos .pdf, .txt o .md', 'unsupported-media-type');
  }
  if (/^MINEDUC\b/i.test(name)) {
    throw new HttpProblem(422, 'Documento inválido', 'Los nombres que empiezan con "MINEDUC" están reservados para las Bases Curriculares');
  }
  return name;
}

/**
 * Apuntes del curso que usa el Tutor IA (contrato v1.3: listCourseDocuments, putCourseDocument,
 * deleteCourseDocument). Requiere req.user (requireAuth) y el RAG en PostgreSQL.
 *
 *   404 -> el curso no existe en el colegio del token o no participas en él (RLS de 04);
 *   403 -> participas, pero eres estudiante: solo el docente del curso o el admin gestionan apuntes.
 *
 * La base vuelve a validar cada escritura (02 §9): aunque la API se equivocara, un estudiante no escribe.
 * Nunca se registra el contenido de los archivos en los logs.
 */
export function createApuntesRouter({ db, rag }) {
  const router = Router();

  /**
   * v1.8: guarda el archivo ORIGINAL para que los estudiantes del curso lo descarguen (GET .../materials).
   * El tutor ya quedó listo con el texto: si esto falla, el apunte igual sirve y el estudiante recibe el texto
   * (.txt) en vez del archivo. Por eso solo se avisa en el log (sin el contenido).
   */
  async function guardarOriginal(req, courseId, name, tipo, body) {
    try {
      await db.withUser(req.user, (c) => c.query(Q.GUARDAR_ARCHIVO_APUNTE, [courseId, name, tipo, body.length, body]));
    } catch (err) {
      req.log?.warn({ err: err.message, code: err.code }, 'no se pudo guardar el archivo original del apunte');
      // Si era un reemplazo, el original ANTERIOR ya no corresponde al texto nuevo: se quita para que el estudiante
      // descargue el texto vigente (.txt) y no una versión vieja.
      await db.withUser(req.user, (c) => c.query(Q.QUITAR_ARCHIVO_APUNTE, [courseId, name])).catch(() => {});
    }
  }
  const base = '/v1/courses/:courseId/documents';

  /** Verifica el acceso ANTES de leer el cuerpo: un estudiante no alcanza a subir 40 MB. */
  async function staffOnly(req, _res, next) {
    const courseId = uuidParam(req.params.courseId, 'courseId');
    // puede_ver_curso() (04): el admin ve los de su colegio, el docente los que dicta y el estudiante aquellos donde
    // está matriculado. Igual que getCourse: si no participas, 404 (no se revela que el curso existe).
    const curso = await db.withUser(req.user, async (c) => (await c.query(
      'SELECT docente_id FROM cursos WHERE id = $1 AND puede_ver_curso(id)',
      [courseId],
    )).rows[0], { readOnly: true });
    if (!curso) throw new HttpProblem(404, 'No encontrado', 'El curso no existe o no participas en él', 'not-found');
    if (!esStaffDelCurso(req.user, curso)) {
      throw new HttpProblem(403, 'Prohibido', 'Solo el docente del curso o el administrador del colegio gestionan sus apuntes', 'forbidden');
    }
    req.courseRef = { tenantId: req.user.colegioId, courseId };
    next();
  }

  const actorOf = (req) => ({ id: req.user.id, rol: req.user.rol, iat: req.user.iat });

  router.get(base, staffOnly, async (req, res) => {
    const documents = await rag.listDocuments(req.courseRef);
    const visibles = new Map((await db.withUser(req.user, (c) => c.query(Q.VISIBILIDAD_APUNTES_CURSO, [req.courseRef.courseId]), { readOnly: true }))
      .rows.map((r) => [r.titulo, r.visible_estudiante]));
    res.json({ data: documents.map((d) => toDocument(d, undefined, visibles.get(d.doc_id))) });
  });

  // v1.12 · Mostrar u ocultar un apunte como material descargable (p. ej. una pauta con respuestas que solo usa el tutor).
  router.patch(`${base}/:documentName`, staffOnly, async (req, res) => {
    const name = (req.params.documentName ?? '').trim();
    if (typeof req.body?.visible_to_students !== 'boolean') throw invalid('"visible_to_students" debe ser true o false');
    const row = (await db.withUser(req.user, (c) => c.query(Q.VISIBILIDAD_APUNTE, [req.courseRef.courseId, name, req.body.visible_to_students]))).rows[0];
    if (!row) throw new HttpProblem(404, 'No encontrado', 'El documento no existe en este curso', 'not-found');
    res.json({ name: row.titulo, visible_to_students: row.visible_estudiante });
  });

  router.put(
    `${base}/:documentName`,
    staffOnly,
    binaryBody,
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    async (req, res) => {
      const name = uploadName(req.params.documentName);
      const visible = leerVisible(req.query.visible_to_students);
      const body = req.body;
      if (!Buffer.isBuffer(body)) {
        throw new HttpProblem(415, 'Formato no soportado', 'Envía el archivo como cuerpo binario (no JSON)', 'unsupported-media-type');
      }
      if (body.length === 0) throw new HttpProblem(422, 'Documento inválido', 'El archivo está vacío');

      const isPdf = PDF_EXT.test(name);
      if (isPdf && body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new HttpProblem(422, 'Archivo ilegible', 'El archivo no es un PDF válido');
      }

      const ref = req.courseRef;
      try {
        const input = isPdf ? { pages: await extractPdfPages(body) } : { text: decodeText(body) };
        if (!isPdf && !input.text.trim()) throw new RangeError('El documento no tiene texto');
        // T-4: antes de gastar embeddings, se revisa que el apunte no traiga órdenes para la IA.
        assertCleanDocument(input, req);
        const result = await rag.ingest({ ...ref, docId: name, title: name.replace(/\.[^.]+$/, ''), ...input, actor: actorOf(req) });
        await guardarOriginal(req, ref.courseId, name, isPdf ? 'application/pdf' : /\.md$|\.markdown$/i.test(name) ? 'text/markdown' : 'text/plain', body);
        // Visibilidad como material: la pedida; si no viene, un apunte nuevo queda visible y un reemplazo conserva la suya.
        const fila = (await db.withUser(req.user, (c) => (visible === undefined
          ? c.query(Q.VISIBILIDAD_APUNTES_CURSO + ' AND titulo = $2', [ref.courseId, name])
          : c.query(Q.VISIBILIDAD_APUNTE, [ref.courseId, name, visible])))).rows[0];
        // 200 = reemplazó a uno con ese nombre; 201 = nuevo (lo decide la misma transacción que guarda).
        res.status(result.created === false ? 200 : 201).json(toDocument(result, input.pages?.length, fila?.visible_estudiante));
      } catch (err) {
        throw toRagProblem(err);
      }
    },
  );

  router.delete(`${base}/:documentName`, staffOnly, async (req, res) => {
    let removed;
    try {
      // Mismo recorte que al subir: "PUT / a.md" guarda "a.md", así que "DELETE / a.md" debe encontrarlo.
      removed = await rag.deleteDocument({ ...req.courseRef, docId: (req.params.documentName ?? '').trim(), actor: actorOf(req) });
    } catch (err) {
      throw toRagProblem(err);
    }
    // Bajo RLS, un DELETE no permitido afecta 0 filas: para el cliente es igual que "no existe".
    if (removed === 0) throw new HttpProblem(404, 'No encontrado', 'El documento no existe en este curso', 'not-found');
    res.status(204).end();
  });

  return router;
}
