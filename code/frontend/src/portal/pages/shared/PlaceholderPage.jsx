import { Card, PageHead } from '../../components/ui/index.js';
import styles from './PlaceholderPage.module.css';

/** Marcador de una pantalla del Figma que aún no se construye. Se reemplaza en pages/index.js. */
export function PlaceholderPage({ route, param }) {
  return (
    <>
      <PageHead title={route.title} subtitle={`${route.group} · pantalla pendiente de construir`} />
      <Card>
        <h2 className={styles.title}>Aquí irá «{route.title}»</h2>
        <p className={styles.text}>
          Id de la pantalla: <code>{route.id}</code>.{route.detail && <> Muestra un elemento según el id de la URL{param ? <> (recibido: <code>{param}</code>)</> : ' (aún sin id)'}.</>} Para construirla: crea el componente en{' '}
          <code>src/portal/pages/</code> y regístralo en <code>pages/index.jsx</code>. El marco, el menú y la
          personalización ya funcionan.
        </p>
      </Card>
    </>
  );
}
