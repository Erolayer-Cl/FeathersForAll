import { getMyGrades } from '../../../api/portalApi.js';
import { Card, Chip, EmptyState, Kpi, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useSession } from '../../session/useSession.js';
import { contarNotas, formatNota, periodosDe, primerNombre, promedioGeneral, tonoNota } from '../../utils/notas.js';
import styles from './InicioPage.module.css';

const SIN_DATOS = 'Sin datos todavía';

/** Estudiante · Inicio (Figma: «Estudiante / Inicio»), con sus ramos y notas reales (GET /v1/me/grades). */
export function EstudianteInicioPage() {
  const { user } = useSession();
  const { data, loading, error, reload } = useApiData(getMyGrades);
  // Mismo criterio que Mis notas: el promedio general es el del período más reciente.
  const todos = data?.courses ?? [];
  const periodo = periodosDe(todos)[0];
  const ramos = periodo ? todos.filter((r) => r.period === periodo) : todos;
  const promedio = promedioGeneral(ramos);
  const notas = contarNotas(ramos);
  const conApuntes = ramos.filter((r) => r.tutor_available).length;

  return (
    <>
      <Card as="header" tight>
        <h1 className={styles.hello}>
          Hola {primerNombre(user?.name)} <span aria-hidden="true">👋</span>
        </h1>
        <p className={styles.sub}>Continúa avanzando en tu aprendizaje inteligente</p>
      </Card>

      {/* Mientras carga o si falló, LoadState reemplaza los KPI: así nunca dice "Aún no tienes notas" sin saberlo. */}
      <LoadState loading={loading} error={error} onRetry={reload}>
        <div className={styles.kpis}>
          <Kpi
            label="Promedio general"
            value={formatNota(promedio)}
            hint={promedio === null ? 'Aún no tienes notas' : `${notas} ${notas === 1 ? 'nota registrada' : 'notas registradas'}`}
            tone={promedio === null ? 'accent' : tonoNota(promedio)}
          />
          {/* La asistencia todavía no existe en la base de datos. */}
          <Kpi label="Asistencia" value="—" hint={SIN_DATOS} tone="success" />
          <Kpi
            label="Cursos activos"
            value={String(ramos.length)}
            hint={ramos.length ? 'Asignaturas actuales' : 'Aún no estás inscrito en cursos'}
            tone="warning"
          />
        </div>
      </LoadState>

      <section className={styles.promo}>
        <div>
          <span className={styles.eyebrow}>Tutor IA</span>
          <h2>Aprende con tu asistente inteligente</h2>
          <p className={styles.sub}>Pregunta sobre tus cursos y recibe explicaciones basadas en el material de aprendizaje.</p>
        </div>
        <div className={styles.promoAction}>
          {data && (
            <Chip solid>
              {conApuntes ? `Con apuntes en ${conApuntes} de ${ramos.length} asignaturas` : 'Sin apuntes todavía'}
            </Chip>
          )}
          {/* El tutor dentro del portal llega en una próxima etapa: no se ofrece un botón que no lleva a nada. */}
          <span className={styles.soon}>Muy pronto podrás preguntarle desde aquí.</span>
        </div>
      </section>

      <div className={styles.two}>
        <Card as="section">
          <h2>Próximas evaluaciones</h2>
          <p className={styles.sub}>Organiza tus próximas actividades</p>
          <EmptyState>Aún no tienes evaluaciones. Aparecerán cuando tu docente las publique.</EmptyState>
        </Card>

        <Card as="section">
          <h2>Notificaciones</h2>
          <p className={styles.sub}>Mantente al día con tu actividad académica</p>
          <EmptyState>No tienes notificaciones nuevas.</EmptyState>
        </Card>
      </div>
    </>
  );
}
