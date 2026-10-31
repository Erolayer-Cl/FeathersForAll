import { useState } from 'react';
import { getMyGrades } from '../../../api/portalApi.js';
import { Card, EmptyState, Kpi, LoadState } from '../../components/ui/index.js';
import { useApiData } from '../../hooks/useApiData.js';
import {
  contarNotas, formatNota, formatNumero, nombrePeriodo, periodosDe, promedioGeneral, tablaNotas, tonoNota,
} from '../../utils/notas.js';
import styles from './MisNotasPage.module.css';

/**
 * Estudiante · Mis notas (prototipo: «Mis notas»). Solo lectura: KPIs del período y una tabla
 * Asignatura | N1…Nk | Promedio. Las columnas Examen, Examen Rep y Final del prototipo no se
 * muestran porque esos datos no existen todavía en la base.
 */
export function MisNotasPage() {
  const { data, loading, error, reload } = useApiData(getMyGrades);
  const todos = data?.courses ?? [];
  const periodos = periodosDe(todos);
  const [elegido, setElegido] = useState(null);
  const periodo = elegido ?? periodos[0] ?? null;
  const ramos = periodo ? todos.filter((r) => r.period === periodo) : todos;
  const { columnas, filas } = tablaNotas(ramos);

  return (
    <>
      <Card as="header" className={styles.hello}>
        <div>
          <h1>Mis notas</h1>
          <p className={styles.sub}>Consulta tus calificaciones del período actual.</p>
        </div>
        {periodos.length > 0 && (
          <select className={styles.select} aria-label="Período" value={periodo} onChange={(e) => setElegido(e.target.value)}>
            {periodos.map((p) => (
              <option key={p} value={p}>
                {nombrePeriodo(p)}
              </option>
            ))}
          </select>
        )}
      </Card>

      <LoadState loading={loading} error={error} onRetry={reload}>
        <div className={styles.kpis}>
          <Kpi label="Promedio general" value={formatNota(promedioGeneral(ramos))} hint="Promedio de tus asignaturas" />
          <Kpi label="Asignaturas" value={String(ramos.length)} hint="Cursos en curso" tone="success" />
          <Kpi label="Evaluaciones" value={String(contarNotas(ramos))} hint="Calificaciones registradas" tone="warning" />
        </div>

        <div>
          <h2 className={styles.title}>Mis calificaciones</h2>
          <p className={styles.sub}>Detalle de tus notas por asignatura. El promedio pondera cada evaluación según su peso.</p>
        </div>

        {filas.length === 0 ? (
          <EmptyState title="Aún no tienes asignaturas">Cuando tu colegio te matricule, verás aquí tus notas.</EmptyState>
        ) : (
          // Se puede enfocar para desplazarla con las flechas del teclado (WCAG 2.1.1).
          <div className={styles.scroll} tabIndex={0} role="region" aria-label="Tabla de notas">
            <table className={styles.table}>
              <caption className={styles.srOnly}>Notas por asignatura, en escala de 1,0 a 7,0</caption>
              <thead>
                <tr>
                  <th scope="col">Asignatura</th>
                  {Array.from({ length: columnas }, (_, i) => (
                    <th key={i} scope="col">
                      N{i + 1}
                    </th>
                  ))}
                  <th scope="col">Promedio</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <tr key={fila.id}>
                    <th scope="row">
                      {fila.asignatura}
                      <small>{fila.curso}</small>
                    </th>
                    {fila.notas.map((nota, i) => (
                      <td
                        key={nota?.assessment_id ?? i}
                        className={styles[tonoNota(nota?.grade)]}
                        title={nota ? `${nota.title} · Ponderación ${formatNumero(nota.weight)}` : undefined}
                      >
                        {/* El title solo se ve con mouse: el lector de pantalla recibe el nombre por aquí. */}
                        {nota && <span className={styles.srOnly}>{nota.title}: </span>}
                        {formatNota(nota?.grade)}
                      </td>
                    ))}
                    <td className={`${styles.average} ${styles[tonoNota(fila.promedio)]}`}>{formatNota(fila.promedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadState>
    </>
  );
}
