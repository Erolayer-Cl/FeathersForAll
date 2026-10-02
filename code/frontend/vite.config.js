import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, Vite reenvía /v1 y /health al backend Express: el navegador
// ve un solo origen y no hace falta CORS. En producción (Vercel) la URL de la
// API se configura con VITE_API_URL (ver src/api/chatApi.js).
const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': backend,
      '/health': backend,
    },
  },
  test: {
    environment: 'node',
  },
});
