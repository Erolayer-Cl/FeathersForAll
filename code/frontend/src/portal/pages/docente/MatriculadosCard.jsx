import { useState } from 'react';
import { enrollStudent, getEnrollments } from '../../../api/portalApi.js';
import { Button, Card, EmptyState, Field, FormMessage, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { useSession } from '../../session/useSession.js';
import { formatFecha } from '../../utils/notas.js';
import styles from './Gestion.module.css';

/** Docente · Estudiantes del curso: lista de matriculados y matrícula por correo institucional (H1). */
export function MatriculadosCard({ courseId }) {
  const { token, expire } = useSession();
  const lista = useApiData((t, opts) => getEnrollments(t, courseId, opts), courseId);
  const key = useIdempotencyKey();
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState(null); // { tone, text }

  async function matricular(e) {
    e.preventDefault();
    if (enviando || !email.trim()) return;
    setEnviando(true);
    setMensaje(null);
    try {
      await enrollStudent(token, courseId, email.trim(), key.get());
      key.renew();
      setMensaje({ tone: 'success', text: `Matriculaste a ${email.trim()}.` });
      setEmail('');
      lista.reload();
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      if (err.status !== 0) key.renew(); // con la red caída se reintenta con la misma clave
      setMensaje({ tone: 'error', text: err.message });
    } finally {
      setEnviando(false);
    }
  }

  const estudiantes = lista.data?.data ?? [];
  return (
    <Card as="section" aria-labelledby="matriculados-titulo">
      <h2 id="matriculados-titulo" className={styles.h2}>Estudiantes del curso</h2>
      <p className={styles.sub}>Matricula con el correo institucional del estudiante. Solo puedes matricular estudiantes de tu colegio.</p>

      <form className={styles.formRow} onSubmit={matricular}>
        <Field label="Correo del estudiante">
          <input type="email" name="student_email" placeholder="estudiante@colegio.cl" autoComplete="off" required maxLength={150} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" disabled={enviando}>{enviando ? 'Matriculando…' : 'Matricular'}</Button>
      </form>
      {mensaje && <div style={{ marginTop: 12 }}><FormMessage tone={mensaje.tone}>{mensaje.text}</FormMessage></div>}

      <LoadState loading={lista.loading} error={lista.error} onRetry={lista.reload}>
        {estudiantes.length === 0 ? (
          <EmptyState title="Aún no hay estudiantes">Matricula al primero con su correo.</EmptyState>
        ) : (
          <ul className={styles.rows}>
            {estudiantes.map((s) => (
              <li key={s.id} className={styles.row}>
                <div className={styles.grow}>
                  <b>{s.name}</b>
                  <small>{s.email} · desde {formatFecha(s.enrolled_at)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </LoadState>
    </Card>
  );
}
