# Checklist 12-Factor — AulaViva (FeathersForAll)

> S04 · Auditoría de la arquitectura de S03 contra los 12 factores. Fuente del estado: deck de S04 del equipo. Las acciones concretas y los responsables son la propuesta de trabajo derivada de esa auditoría; se ratifican en la reunión del equipo. Decisión cloud: [ADR 0003](adr/0003-cloud.md). Servicios: [managed-services.md](cloud/managed-services.md).

Resumen: **3 cumplen** (Codebase, Dependencies, Port Binding) · **9 parciales**. Ninguno queda como "no cumple".

| # | Factor | Estado | Acción concreta (por cada gap) | Responsable |
|---|---|---|---|---|
| 1 | Codebase | Cumple | Un repo en Git (`Erolayer-Cl/FeathersForAll`), varios deploys (Vercel y Render) desde `main`. Sin acción. | Tech Lead |
| 2 | Dependencies | Cumple | Dependencias declaradas en `package.json` con `package-lock.json` versionado; usar `npm ci` en el build. | Tech Lead |
| 3 | Config | Parcial | Sacar toda configuración y secretos del código: `.env` local (fuera del repo, con `.env.example` versionado) y variables de entorno en Vercel/Render; secretos reales (API keys, credenciales) en AWS Secrets Manager. Incluir `TENANT_STRATEGY="shared_schema_rls"` y `RATE_LIMIT_PER_TENANT`. | DevSecOps + Tech Lead |
| 4 | Backing services | Parcial | Cada dependencia externa se configura por variable de entorno, sin recompilar: `DATABASE_URL`, `LLM_ENDPOINT`, `LLM_API_KEY`, `SQS_QUEUE_URL`, `SMTP_URL` (o API de email) y configuración de SSO. Verificar que cambiar la BD o el LLM no requiere tocar código. | Tech Lead + AI/Data |
| 5 | Build / Release / Run | Parcial | Pipeline CI/CD con etapas separadas: build y tests en GitHub Actions, release versionado, deploy automático a Vercel y Render solo desde `main` protegida. Prohibido editar código en producción. | DevSecOps |
| 6 | Processes | Parcial | Backend stateless: sin sesión en memoria del proceso (usar token/JWT o sesión en PostgreSQL); el estado del tutor y de los jobs vive en la BD o en SQS, no en variables del proceso. | Tech Lead |
| 7 | Port Binding | Cumple | Express escucha en el puerto de `process.env.PORT`. Sin acción. | Tech Lead |
| 8 | Concurrency | Parcial | Escalar por más instancias del backend y del worker (Render), no por hilos. Definir cuántas instancias en picos de pruebas y validarlo con una prueba de carga simple. Requiere el punto 6 (stateless). | DevSecOps |
| 9 | Disposability | Parcial | Manejar `SIGTERM` en backend y worker: dejar de aceptar requests, drenar el pool de PostgreSQL y terminar en menos de 30 s. Agregar endpoint de health check (`/health`) para Render. | Tech Lead + DevSecOps |
| 10 | Dev / Prod parity | Parcial | Misma versión de PostgreSQL (con pgvector y RLS) en local y en Render, idealmente con Docker Compose para desarrollo; mismo runtime de Node. Usar datos sintéticos en todos los ambientes (datos de menores). | DevSecOps + QA |
| 11 | Logs | Parcial | Logs estructurados en JSON a stdout con `tenant_id`, `user_id` y `trace_id` (sin PII); envío y retención en Amazon CloudWatch, con métricas y alarmas (disponibilidad, errores del LLM). | DevSecOps |
| 12 | Admin processes | Parcial | Migraciones de BD versionadas en el repo y ejecutadas de forma automática como paso one-off del release (no a mano por SSH); mismo comando en local y en Render. | Tech Lead + DevSecOps |

## Brechas detectadas (agrupadas)

| Brecha | Factores | Acción resumida |
|---|---|---|
| Configuración | 3, 4 | Separar secretos y configuración del código. |
| Despliegue | 5, 12 | Automatizar build, release y ejecución con CI/CD; migraciones automáticas. |
| Disponibilidad | 6, 8, 9 | Backend stateless, health checks y apagado controlado. |
| Logs | 11 | Centralizar registros y métricas en CloudWatch. |
| Ambientes | 10 | Mantener desarrollo y producción similares. |
| Responsables | todos | Cada acción tiene responsable por rol del Charter. |

## Notas

- Los responsables usan los roles del Charter (Tech Lead: Iván; DevSecOps: Ignacio; AI/Data: Bastián; QA: Cristofer y Alex). Son una propuesta.
- Los datos de menores obligan a usar solo datos sintéticos fuera de producción y a definir la región de Render y AWS antes del piloto (pendiente en ADR 0003).
