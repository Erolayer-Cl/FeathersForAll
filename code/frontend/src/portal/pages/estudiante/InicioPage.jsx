import { Button, Card, Chip, EmptyState, Kpi } from '../../components/ui/index.js';
import { EST_INICIO as data } from '../../data/mock.js';
import styles from './InicioPage.module.css';

const SIN_DATOS = 'Sin datos todavía';

/** Estudiante · Inicio (Figma: «Estudiante / Inicio»). */
export function EstudianteInicioPage() {
  return (
    <>
      <Card as="header" tight>
        <h1 className={styles.hello}>{data.saludo}</h1>
        <p className={styles.sub}>Continúa avanzando en tu aprendizaje inteligente</p>
      </Card>

      <div className={styles.kpis}>
        <Kpi label="Promedio general" value={data.promedio?.value ?? '—'} hint={data.promedio?.hint ?? SIN_DATOS} tone="success" />
        <Kpi label="Asistencia" value={data.asistencia?.value ?? '—'} hint={data.asistencia?.hint ?? SIN_DATOS} tone="success" />
        <Kpi label="Cursos activos" value={data.cursosActivos?.value ?? '—'} hint={data.cursosActivos?.hint ?? 'Aún no estás inscrito en cursos'} tone="warning" />
      </div>

      <section className={styles.promo}>
        <div>
          <span className={styles.eyebrow}>Tutor IA</span>
          <h2>Aprende con tu asistente inteligente</h2>
          <p className={styles.sub}>Pregunta sobre tus cursos y recibe explicaciones basadas en el material de aprendizaje.</p>
        </div>
        <div className={styles.promoAction}>
          <Chip solid>IA disponible</Chip>
          <Button href="#/portal/est-tutor">Preguntar al Tutor IA</Button>
        </div>
      </section>

      <div className={styles.two}>
        <Card as="section">
          <h2>Próximas evaluaciones</h2>
          <p className={styles.sub}>Organiza tus próximas actividades</p>
          {data.evaluaciones.length === 0 && (
            <EmptyState>Aún no tienes evaluaciones. Aparecerán cuando tu profesor las publique.</EmptyState>
          )}
          <ul className={styles.rows}>
            {data.evaluaciones.map((e) => (
              <li key={e.curso} className={styles.row}>
                <b>{e.curso}</b>
                <span className={styles.grow} />
                <Chip tone="neutral">{e.fecha}</Chip>
                <Chip tone={e.tono}>{e.estado}</Chip>
              </li>
            ))}
          </ul>
        </Card>

        <Card as="section">
          <h2>
            Notificaciones
            {data.notificaciones.length > 0 && <span className={styles.count}>{data.notificaciones.length}</span>}
          </h2>
          <p className={styles.sub}>Mantente al día con tu actividad académica</p>
          {data.notificaciones.length === 0 && <EmptyState>No tienes notificaciones nuevas.</EmptyState>}
          <ul className={styles.rows}>
            {data.notificaciones.map((n) => (
              <li key={n.id} className={styles.row}>
                <span className={`${styles.dot} ${styles[n.tono]}`} aria-hidden="true" />
                <div className={styles.grow}>
                  <b>{n.titulo}</b>
                  <span className={styles.detail}>{n.detalle}</span>
                </div>
                <span className={styles.when}>{n.cuando}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
