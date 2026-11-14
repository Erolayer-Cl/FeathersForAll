import { useState } from 'react';
import { createCourse } from '../../../api/portalApi.js';
import { Button, Card, Field, FormMessage, PageHead } from '../../components/ui/index.js';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey.js';
import { PortalLink } from '../../router/PortalLink.jsx';
import { usePortalRoute } from '../../router/usePortalRoute.js';
import { useSession } from '../../session/useSession.js';
import { periodosDisponibles } from '../../utils/evaluaciones.js';
import styles from './Gestion.module.css';

/** Docente · Nuevo curso (H1): el curso queda a su nombre y en su colegio. Al crearlo abre su pantalla para matricular. */
export function DocenteCursoNuevoPage() {
  const { token, expire } = useSession();
  const { navigate } = usePortalRoute();
  const key = useIdempotencyKey();
  const { lista, porDefecto } = periodosDisponibles();
  const [form, setForm] = useState({ name: '', period: porDefecto, subject: '', grade_level: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function crear(e) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const curso = await createCourse(token, {
        name: form.name.trim(),
        period: form.period,
        ...(form.subject.trim() && { subject: form.subject.trim() }),
        ...(form.grade_level.trim() && { grade_level: form.grade_level.trim() }),
      }, key.get());
      key.renew();
      navigate('doc-curso', curso.id);
    } catch (err) {
      if (err.status === 401) {
        expire();
        return;
      }
      if (err.status !== 0) key.renew();
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <>
      <p className={styles.crumbs}><PortalLink to="doc-cursos">Mis cursos</PortalLink> / Nuevo curso</p>
      <PageHead title="Nuevo curso" subtitle="Crea el curso y después matricula a tus estudiantes con su correo institucional." />
      <Card as="section">
        <form className={styles.form} onSubmit={crear} aria-busy={enviando}>
          <Field label="Nombre del curso" hint="Por ejemplo: Matemáticas 7° Básico A.">
            <input name="name" required minLength={3} maxLength={120} value={form.name} onChange={cambiar('name')} />
          </Field>
          <div className={styles.grid2}>
            <Field label="Período">
              <select name="period" value={form.period} onChange={cambiar('period')}>
                {lista.map((p) => <option key={p} value={p}>{p.replace('-S', ' · semestre ')}</option>)}
              </select>
            </Field>
            <Field label="Asignatura (opcional)">
              <input name="subject" maxLength={80} placeholder="Matemática" value={form.subject} onChange={cambiar('subject')} />
            </Field>
            <Field label="Nivel (opcional)" hint="Por ejemplo: 7B o 2M.">
              <input name="grade_level" maxLength={10} placeholder="7B" value={form.grade_level} onChange={cambiar('grade_level')} />
            </Field>
          </div>
          {error && <FormMessage>{error}</FormMessage>}
          <div className={styles.footer}>
            <Button type="submit" disabled={enviando}>{enviando ? 'Creando…' : 'Crear curso'}</Button>
            <Button variant="ghost" href="#/portal/doc-cursos">Cancelar</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
