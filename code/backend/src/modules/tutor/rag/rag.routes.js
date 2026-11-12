import express, { Router } from 'express';
import { HttpProblem } from '../../../platform/problem.js';
import { CourseNotFoundError, EmbeddingDimensionError, RagForbiddenError, UnreadableDocumentError } from './errors.js';
import { extractPdfPages } from './pdf-text.js';

export const COURSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 120;
const MAX_TEXT = 500_000;
const MAX_FILE = '40mb'; // un PDF de apuntes; las bases curriculares completas pesan ~4 MB
const TEXT_EXT = /\.(txt|md|markdown)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * Carga de apuntes (ruta de desarrollo, fuera del contrato OpenAPI).
 *
 * Con PostgreSQL (`rag.backend === 'postgres'`):
 *   - exige JWT (`requireAuth` montado antes, deja req.user);
 *   - el colegio sale del token, nunca del cliente;
 *   - un estudiante recibe 403 aquí, y aunque la API se equivocara, la base rechaza la escritura
 *     (políticas por rol de 02_s06_ajustes.sql §9): solo el docente del curso o el admin del colegio suben apuntes.
 * Con el almacén en archivo (sin BD) no hay usuarios: queda abierta y usa `tenantId` de la config.
 *
 * Debe montarse ANTES del express.json global: trae su propio límite (apuntes > 100 kb).
 */
export function createRagRouter({ rag, tenantId }) {
  const router = Router();
  const pg = rag.backend === 'postgres';
  const pattern = pg ? UUID_PATTERN : COURSE_ID_PATTERN;
  router.use(express.json({ limit: '2mb' }));

  const ctx = (req) => {
    if (!pattern.test(req.params.courseId)) {
      throw new HttpProblem(400, 'Solicitud inválida', pg ? 'courseId debe ser un UUID' : 'courseId solo admite letras, números, "-" y "_" (máx. 64)');
    }
    return { tenantId: req.user?.colegioId ?? tenantId, courseId: req.params.courseId };
  };
  const mustManage = (req) => {
    if (pg && req.user?.rol === 'estudiante') {
      throw new HttpProblem(403, 'Prohibido', 'Solo el docente del curso o el administrador del colegio pueden gestionar apuntes', 'forbidden');
    }
  };
  const actorOf = (req) => (req.user ? { id: req.user.id, rol: req.user.rol } : undefined);

  function translate(err) {
    if (err instanceof CourseNotFoundError) return new HttpProblem(404, 'No encontrado', 'El curso no existe en este colegio', 'not-found');
    if (err instanceof RagForbiddenError) return new HttpProblem(403, 'Prohibido', 'No puedes gestionar los apuntes de este curso', 'forbidden');
    if (err instanceof EmbeddingDimensionError) return new HttpProblem(503, 'Configuración inválida', err.message);
    if (err instanceof UnreadableDocumentError) return new HttpProblem(422, 'Archivo ilegible', err.message);
    if (err instanceof RangeError) return new HttpProblem(422, 'Documento inválido', err.message);
    return err;
  }

  router.get('/:courseId/documents', async (req, res) => {
    const ref = ctx(req);
    if (pg && req.user && !(await rag.canUseCourse({ ...ref, user: req.user }))) {
      throw new HttpProblem(404, 'No encontrado', 'El curso no existe o no participas en él', 'not-found');
    }
    res.json({ documents: await rag.listDocuments(ref) });
  });

  router.post('/:courseId/documents', async (req, res) => {
    const ref = ctx(req);
    mustManage(req);

    const name = req.body?.name;
    const text = req.body?.text;
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) {
      throw new HttpProblem(422, 'Documento inválido', `"name" debe ser texto de 1 a ${MAX_NAME} caracteres`);
    }
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      throw new HttpProblem(422, 'Documento inválido', `"text" debe ser texto de 1 a ${MAX_TEXT} caracteres`);
    }

    try {
      res.status(201).json(await rag.ingest({ ...ref, docId: name.trim(), text, actor: actorOf(req) }));
    } catch (err) {
      throw translate(err);
    }
  });

  /**
   * Sube un archivo de apuntes (PDF, .txt o .md) como cuerpo binario: POST .../files?name=clase1.pdf
   * El texto se extrae en el servidor, se limpia, se parte en fragmentos y se indexa en el RAG del curso.
   * Si ya existe un documento con ese nombre, se reemplaza.
   */
  router.post('/:courseId/files', express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
    const ref = ctx(req);
    mustManage(req);

    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name || name.length > MAX_NAME) {
      throw new HttpProblem(422, 'Documento inválido', `"name" debe ser el nombre del archivo (1 a ${MAX_NAME} caracteres)`);
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpProblem(422, 'Documento inválido', 'El archivo está vacío');
    }

    const isPdf = PDF_EXT.test(name);
    if (!isPdf && !TEXT_EXT.test(name)) {
      throw new HttpProblem(415, 'Formato no soportado', 'Solo se aceptan archivos .pdf, .txt o .md', 'unsupported-media-type');
    }
    if (isPdf && body.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HttpProblem(422, 'Archivo ilegible', 'El archivo no es un PDF válido');
    }

    try {
      const input = isPdf ? { pages: await extractPdfPages(body) } : { text: body.toString('utf8') };
      if (!isPdf && !input.text.trim()) throw new RangeError('El documento no tiene texto');
      const result = await rag.ingest({ ...ref, docId: name, title: name.replace(/\.[^.]+$/, ''), ...input, actor: actorOf(req) });
      res.status(201).json({ ...result, ...(input.pages && { pages: input.pages.length }) });
    } catch (err) {
      throw translate(err);
    }
  });

  router.delete('/:courseId/documents/:docId', async (req, res) => {
    const ref = ctx(req);
    mustManage(req);
    let removed;
    try {
      removed = await rag.deleteDocument({ ...ref, docId: req.params.docId, actor: actorOf(req) });
    } catch (err) {
      throw translate(err);
    }
    // Bajo RLS, un DELETE no permitido afecta 0 filas: para el cliente es igual que "no existe".
    if (removed === 0) throw new HttpProblem(404, 'No encontrado', 'El documento no existe en este curso', 'not-found');
    res.status(204).end();
  });

  return router;
}
