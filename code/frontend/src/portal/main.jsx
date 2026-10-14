// Punto de entrada propio del portal (lo usa portal.html). No comparte nada con src/main.jsx.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from './PortalApp.jsx';

createRoot(document.getElementById('portal-root')).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
);
