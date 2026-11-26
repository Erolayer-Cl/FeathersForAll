// Archivos que suben docentes y estudiantes (material de tareas y entregas) y cómo se descargan.
//
// Reglas de seguridad (los archivos de un usuario los abre otro: el estudiante descarga lo del docente y al revés):
//   - Solo extensiones de una lista cerrada; el tipo MIME lo decide el servidor por la extensión, nunca el cliente.
//   - Los primeros bytes deben calzar con el formato (un .pdf que no empieza con %PDF- se rechaza).
//   - La descarga va siempre como adjunto, con nosniff y CSP sandbox: el navegador no ejecuta nada del archivo.
//   - El contenido nunca va a los logs.
import { HttpProblem } from '../../platform/problem.js';
import { invalid } from '../../platform/validation.js';

/** Tamaño máximo del archivo de una tarea o de una entrega (la base lo vuelve a limitar en 10). */
export const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;
export const MAX_NOMBRE_ARCHIVO = 150;

const OOXML = 'application/vnd.openxmlformats-officedocument';
const OPENDOC = 'application/vnd.oasis.opendocument';
const ZIP = 'zip';
const OLE = 'ole';

/** extensión -> { tipo MIME, firma esperada } */
export const TIPOS_ARCHIVO = {
  pdf: { tipo: 'application/pdf', firma: 'pdf' },
  doc: { tipo: 'application/msword', firma: OLE },
  docx: { tipo: `${OOXML}.wordprocessingml.document`, firma: ZIP },
  ppt: { tipo: 'application/vnd.ms-powerpoint', firma: OLE },
  pptx: { tipo: `${OOXML}.presentationml.presentation`, firma: ZIP },
  xls: { tipo: 'application/vnd.ms-excel', firma: OLE },
  xlsx: { tipo: `${OOXML}.spreadsheetml.sheet`, firma: ZIP },
  odt: { tipo: `${OPENDOC}.text`, firma: ZIP },
  odp: { tipo: `${OPENDOC}.presentation`, firma: ZIP },
  ods: { tipo: `${OPENDOC}.spreadsheet`, firma: ZIP },
  txt: { tipo: 'text/plain', firma: 'texto' },
  md: { tipo: 'text/markdown', firma: 'texto' },
  jpg: { tipo: 'image/jpeg', firma: 'jpeg' },
  jpeg: { tipo: 'image/jpeg', firma: 'jpeg' },
  png: { tipo: 'image/png', firma: 'png' },
  zip: { tipo: 'application/zip', firma: ZIP },
};

export const EXTENSIONES_ARCHIVO = Object.keys(TIPOS_ARCHIVO);

const empiezaCon = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
const FIRMAS = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  [ZIP]: (b) => empiezaCon(b, [0x50, 0x4b, 0x03, 0x04]),
  [OLE]: (b) => empiezaCon(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  jpeg: (b) => empiezaCon(b, [0xff, 0xd8, 0xff]),
  png: (b) => empiezaCon(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // Texto: sin bytes NUL en el comienzo (un binario renombrado a .txt casi siempre los tiene).
  texto: (b) => !b.subarray(0, 8192).includes(0),
};

// Controles, separadores de ruta y caracteres que Windows no acepta en un nombre de archivo.
const NOMBRE_PROHIBIDO = /[\p{Cc}/\\:*?"<>|]/u;

/** Valida el nombre que viene en la URL; devuelve { nombre, ext, tipo, firma } o lanza 400/415. */
export function leerNombreArchivo(raw) {
  const nombre = (raw ?? '').trim();
  if (!nombre || nombre.length > MAX_NOMBRE_ARCHIVO || NOMBRE_PROHIBIDO.test(nombre) || nombre.startsWith('.')) {
    throw invalid(`El nombre del archivo debe tener de 1 a ${MAX_NOMBRE_ARCHIVO} caracteres, sin / \\ : * ? " < > | ni saltos de línea`);
  }
  const ext = (nombre.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  const formato = TIPOS_ARCHIVO[ext];
  if (!formato) {
    throw new HttpProblem(415, 'Formato no soportado', `Solo se aceptan archivos ${EXTENSIONES_ARCHIVO.map((e) => `.${e}`).join(', ')}`, 'unsupported-media-type');
  }
  return { nombre, ext, ...formato };
}

/** Revisa el cuerpo (Buffer, no vacío, firma correcta). Devuelve el Buffer. */
export function leerCuerpoArchivo(body, archivo) {
  if (!Buffer.isBuffer(body)) {
    throw new HttpProblem(415, 'Formato no soportado', 'Envía el archivo como cuerpo binario (no JSON ni formulario)', 'unsupported-media-type');
  }
  if (body.length === 0) throw new HttpProblem(422, 'Archivo inválido', 'El archivo está vacío', 'invalid-file');
  if (!FIRMAS[archivo.firma](body)) {
    throw new HttpProblem(422, 'Archivo inválido', `El contenido no corresponde a un archivo .${archivo.ext}`, 'invalid-file');
  }
  return body;
}

// Tipos de cuerpo que NO son un archivo: un formulario o JSON se rechaza sin leerlo.
const NO_BINARIOS = /^(application\/json|application\/x-www-form-urlencoded|multipart\/)/i;

/** Middleware: corta antes de leer el cuerpo si el Content-Type es de formulario o JSON. */
export function soloBinario(req, _res, next) {
  if (NO_BINARIOS.test(req.headers['content-type'] ?? '')) {
    throw new HttpProblem(415, 'Formato no soportado', 'Envía el archivo como cuerpo binario (application/octet-stream o su tipo)', 'unsupported-media-type');
  }
  next();
}

/** Nombre ASCII de respaldo para Content-Disposition (los navegadores modernos usan filename*). */
const nombreAscii = (nombre) => nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

/** Envía un archivo como descarga, sin que el navegador lo interprete. */
export function enviarArchivo(res, { nombre, tipo, contenido }) {
  res.set({
    'Content-Type': tipo,
    'Content-Length': String(contenido.length),
    'Content-Disposition': `attachment; filename="${nombreAscii(nombre)}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
  });
  res.end(contenido);
}
