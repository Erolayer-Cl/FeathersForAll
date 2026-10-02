import { EmptyState } from '../../components/EmptyState/EmptyState.jsx';
import { AULA } from '../../config/modes.js';

/**
 * Aula virtual: sección elegida en el menú (Inicio, Mis cursos, Notas).
 * Por ahora es una portada; aquí se mostrarán los cursos cuando esté la API.
 * @param {{section: keyof typeof AULA.sections}} props
 */
export function AulaView({ section }) {
  const { title, description } = AULA.sections[section];
  return <EmptyState label={AULA.label} greeting={title} intro={description} />;
}
