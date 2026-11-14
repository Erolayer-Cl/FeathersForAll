import express, { Router } from 'express';
import { HttpProblem } from '../../platform/problem.js';
import { invalid, uuidParam } from '../../platform/validation.js';
import { esStaffDelCurso } from '../cursos/acceso-curso.js';
import { isReferenceDoc } from './rag/doc-kinds.js';
import { extractPdfPages } from './rag/pdf-text.js';
import { toRagProblem } from './rag/rag.routes.js';

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

/** Fila del RAG -> schema CourseDocument del contrato. */
const toDocument = ({ doc_id, chunks }, pages) => ({
  name: doc_id,
  chunks,
  official: isReferenceDoc(doc_id),
  ...(pages !== undefined && { pages }),
});

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

  const actorOf = (req) => ({ id: req.user.id, rol: req.user.rol });

  router.get(base, staffOnly, async (req, res) => {
    const documents = await rag.listDocuments(req.courseRef);
    res.json({ data: documents.map((d) => toDocument(d)) });
  });

  router.put(
    `${base}/:documentName`,
    staffOnly,
    binaryBody,
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    async (req, res) => {
      const name = uploadName(req.params.documentName);
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
        const result = await rag.ingest({ ...ref, docId: name, title: name.replace(/\.[^.]+$/, ''), ...input, actor: actorOf(req) });
        // 200 = reemplazó a uno con ese nombre; 201 = nuevo (lo decide la misma transacción que guarda).
        res.status(result.created === false ? 200 : 201).json(toDocument(result, input.pages?.length));
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
