import { Button } from '../Button/Button.jsx';
import { EmptyState } from '../EmptyState/EmptyState.jsx';

// 403 y 404 no son fallas técnicas: reintentar no cambia nada, así que no se ofrece.
const TITULOS = {
  403: 'No tienes acceso a esta información',
  404: 'No encontramos lo que buscas',
};

/**
 * Estados de una pantalla que pide datos a la API (ver hooks/useApiData.js): mientras carga muestra
 * un aviso, si falló muestra el mensaje y "Reintentar"; si todo salió bien, muestra `children`.
 * `notFound` = { title, action } reemplaza el título y la acción de un 404 (p. ej. "Volver a Mis cursos").
 */
export function LoadState({ loading, error, onRetry, notFound, children }) {
  if (loading) {
    return (
      <EmptyState>
        <span role="status">Cargando…</span>
      </EmptyState>
    );
  }
  if (error) {
    const esNotFound = error.status === 404;
    const sinReintento = esNotFound || error.status === 403;
    return (
      <EmptyState
        title={(esNotFound && notFound?.title) || TITULOS[error.status] || 'No pudimos cargar esta información'}
        action={
          (esNotFound && notFound?.action) ||
          (onRetry && !sinReintento && (
            <Button size="sm" variant="soft" onClick={onRetry}>
              Reintentar
            </Button>
          ))
        }
      >
        {error.message}
      </EmptyState>
    );
  }
  return children;
}
