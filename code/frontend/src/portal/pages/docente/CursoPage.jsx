import { useRef, useState } from 'react';
import { APUNTE_EXTENSIONES, MAX_APUNTE_BYTES, deleteCourseDocument, getCourse, getCourseDocuments, uploadCourseFile } from '../../../api/portalApi.js';
import { Button, Card, Chip, EmptyState, LoadState, PageHead } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { routeHref } from '../../router/parseRoute.js';
import { useSession } from '../../session/useSession.js';
import styles from './CursoPage.module.css';

const NO_DISPONIBLE = {
  title: 'Curso no disponible',
  action: (
    <Button size="sm" variant="soft" href={routeHref('doc-cursos')}>
      Volver a Mis cursos
    </Button>
  ),
};

const esMineduc = (docId) => /^MINEDUC\b/i.test(docId);
const extension = (nombre) => (nombre.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();

/** Valida el archivo antes de enviarlo; devuelve el motivo si no sirve. */
function motivoRechazo(file) {
  if (!APUNTE_EXTENSIONES.includes(extension(file.name))) return 'Solo se aceptan archivos PDF, TXT o MD.';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > MAX_APUNTE_BYTES) return `Pesa más de ${MAX_APUNTE_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** Docente · Curso: sube y administra los apuntes que alimentan el Tutor IA de ese curso. */
export function DocenteCursoPage({ param: courseId }) {
  const { token, expire } = useSession();
  const curso = useApiData((t, opts) => getCourse(t, courseId, opts), courseId);
  const docs = useApiData((t, opts) => getCourseDocuments(t, courseId, opts), courseId);

  const [envios, setEnvios] = useState([]); // [{ id, nombre, estado: 'subiendo' | 'ok' | 'error', detalle }]
  const [arrastrando, setArrastrando] = useState(false);
  const [borrando, setBorrando] = useState(null);
  const [errorBorrar, setErrorBorrar] = useState(null);
  const inputRef = useRef(null);
  const subiendo = envios.some((e) => e.estado === 'subiendo');

  const actualizar = (id, cambios) => setEnvios((lista) => lista.map((e) => (e.id === id ? { ...e, ...cambios } : e)));

  async function subir(archivos) {
    const lista = [...archivos];
    if (lista.length === 0) return;
    const nuevos = lista.map((file, i) => ({ id: `${Date.now()}-${i}`, file }));
    setEnvios((prev) => [
      ...nuevos.map(({ id, file }) => ({ id, nombre: file.name, estado: 'espera', detalle: '' })),
      ...prev.filter((e) => e.estado === 'subiendo'),
    ]);

    for (const { id, file } of nuevos) {
      const motivo = motivoRechazo(file);
      if (motivo) {
        actualizar(id, { estado: 'error', detalle: motivo });
        continue;
      }
      actualizar(id, { estado: 'subiendo', detalle: 'Leyendo el archivo e indexándolo…' });
      try {
        const r = await uploadCourseFile(token, courseId, file);
        actualizar(id, { estado: 'ok', detalle: `${r.chunks} fragmentos indexados${r.pages ? ` (${r.pages} páginas)` : ''}` });
        docs.reload();
      } catch (err) {
        if (err?.status === 401) {
          expire();
          return;
        }
        actualizar(id, { estado: 'error', detalle: err.message });
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  async function borrar(docId) {
    if (!window.confirm(`¿Quitar «${docId}» del tutor? Tus estudiantes dejarán de recibir respuestas basadas en este apunte.`)) return;
    setBorrando(docId);
    setErrorBorrar(null);
    try {
      await deleteCourseDocument(token, courseId, docId);
      docs.reload();
    } catch (err) {
      if (err?.status === 401) expire();
      else setErrorBorrar(err.message);
    } finally {
      setBorrando(null);
    }
  }

  const documentos = docs.data?.documents ?? [];
  const totalFragmentos = documentos.reduce((n, d) => n + d.chunks, 0);

  return (
    <>
      <p className={styles.crumbs}>
        <a href={routeHref('doc-cursos')}>Mis cursos</a> / {curso.data?.subject ?? curso.data?.name ?? 'Curso'}
      </p>

      <LoadState loading={curso.loading} error={curso.error} onRetry={curso.reload} notFound={NO_DISPONIBLE}>
        <PageHead
          title={curso.data?.subject ?? curso.data?.name ?? 'Curso'}
          subtitle={`${curso.data?.name ?? ''} · Apuntes del Tutor IA`}
        />

        <div className={styles.split}>
          <Card as="section" aria-labelledby="subir-titulo">
            <h2 id="subir-titulo" className={styles.h2}>Subir apuntes</h2>
            <p className={styles.sub}>
              Acepta PDF, TXT o MD (hasta {MAX_APUNTE_BYTES / 1024 / 1024} MB). El tutor los lee, los divide en fragmentos y responde a tus
              estudiantes citando este material. Si subes un archivo con el mismo nombre, se reemplaza.
            </p>

            <label
              className={`${styles.drop} ${arrastrando ? styles.dropOver : ''}`}
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => { e.preventDefault(); setArrastrando(false); subir(e.dataTransfer.files); }}
            >
              <input
                ref={inputRef}
                className={styles.fileInput}
                type="file"
                multiple
                accept={APUNTE_EXTENSIONES.join(',')}
                disabled={subiendo}
                onChange={(e) => subir(e.target.files)}
              />
              <b>{subiendo ? 'Procesando…' : 'Arrastra tus archivos aquí o haz clic para elegirlos'}</b>
              <span>PDF, TXT o MD</span>
            </label>

            <ul className={styles.envios} aria-live="polite">
              {envios.map((e) => (
                <li key={e.id} className={styles[e.estado]}>
                  <b>{e.nombre}</b>
                  <span>{e.estado === 'espera' ? 'En espera…' : e.detalle}</span>
                </li>
              ))}
            </ul>
            {subiendo && <p className={styles.sub}>Un PDF largo puede tardar unos minutos. No cierres esta página.</p>}
          </Card>

          <Card as="section" aria-labelledby="docs-titulo">
            <h2 id="docs-titulo" className={styles.h2}>Apuntes del curso</h2>
            <p className={styles.sub}>
              {documentos.length} documento{documentos.length === 1 ? '' : 's'} · {totalFragmentos} fragmentos que el tutor puede consultar.
            </p>
            {errorBorrar && <p role="alert" className={styles.alerta}>{errorBorrar}</p>}

            <LoadState loading={docs.loading} error={docs.error} onRetry={docs.reload}>
              {documentos.length === 0 && (
                <EmptyState title="Este curso aún no tiene apuntes">Sube el primero y tus estudiantes podrán preguntarle al tutor.</EmptyState>
              )}
              <ul className={styles.rows}>
                {documentos.map((d) => (
                  <li key={d.doc_id} className={styles.row}>
                    <div className={styles.grow}>
                      <b>{d.doc_id}</b>
                      <small>{d.chunks} fragmentos</small>
                    </div>
                    {esMineduc(d.doc_id) && <Chip tone="accent">Bases Mineduc</Chip>}
                    <Button size="sm" variant="warn" disabled={borrando === d.doc_id} onClick={() => borrar(d.doc_id)} aria-label={`Quitar ${d.doc_id}`}>
                      {borrando === d.doc_id ? 'Quitando…' : 'Quitar'}
                    </Button>
                  </li>
                ))}
              </ul>
            </LoadState>
          </Card>
        </div>
      </LoadState>
    </>
  );
}
