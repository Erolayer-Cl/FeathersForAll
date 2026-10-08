# ADR 0005 · Frontend con React + Vite (reemplaza la línea de frontend del ADR 0002)

## Estado

Propuesto — 2026-10-07. Documenta una decisión que ya está en el código (`code/frontend/`). Pendiente de ratificar en la reunión del equipo.

## Contexto

El ADR 0002 definió el frontend como "HTML + CSS + JavaScript, sin framework de SPA". El frontend que hoy está en `main` (`code/frontend/`) usa **React 19 + Vite**, con componentes, estado del chat en un reducer, pruebas con Vitest y ESLint. Los ADR no se editan: cuando una decisión cambia, se registra en uno nuevo.

## Decisión

El frontend de AulaViva se construye con **React + Vite**, desplegado en Vercel (ADR 0003). Consume la API del backend según el contrato `FeathersForAll/api/openapi.yaml`; en desarrollo Vite reenvía `/v1` y `/health` al backend, y en producción se configura `VITE_API_URL`.

El resto del ADR 0002 sigue vigente (monolito modular en Node.js + Express, PostgreSQL, aislamiento con RLS).

## Consecuencias

**Gana:**

- Componentes reutilizables para chat, aula y evaluaciones; estado más fácil de mantener que con JS sin framework.
- Pruebas (Vitest) y lint ya integrados.
- Puede usar el cliente tipado `packages/api-client` (generado desde el contrato).

**Pierde / se vuelve más difícil:**

- Un paso de build y más dependencias que mantener.
- Curva de aprendizaje de React para quien no lo conoce.
- El backend deja de servir el HTML: frontend y API viven en dominios distintos (CORS y autenticación entre dominios, ya anotado en el ADR 0003).

## Alternativas descartadas

- **Mantener HTML + CSS + JS sin framework:** ya no refleja lo implementado y escala peor para el chat y las vistas del aula.
- **Otro framework (Vue, Svelte, Next.js):** el equipo ya avanzó con React; cambiar no aporta valor al MVP.

## Fecha

2026-10-07

## Autores

Equipo AulaViva (redacción: Tech Lead)
