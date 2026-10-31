import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, Vite reenvía /v1 y /health al backend Express: el navegador
// ve un solo origen y no hace falta CORS. En producción (Vercel) la URL de la
// API se configura con VITE_API_URL (ver src/api/chatApi.js).
const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Dos entradas: la app del chat (index.html) y el portal por rol (portal.html), ambas en el build (S07: imagen web).
  build: {
    rollupOptions: {
      input: { main: 'index.html', portal: 'portal.html' },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': backend,
      '/health': backend,
    },
  },
  test: {
    environment: 'node',
    // Gate de CI (S08, ADR 0009): ≥ 70 % de líneas en la lógica (src/**/*.js). Los componentes .jsx y los
    // hooks/contextos de React (use*.js, *Context.js) todavía no tienen pruebas; entran al gate en S09
    // junto con Testing Library.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'src/**/use*.js', 'src/**/*Context.js'],
      thresholds: { lines: 70 },
    },
  },
});
