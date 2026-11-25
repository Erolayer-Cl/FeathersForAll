# ADR 0014 · Despliegue real: Kubernetes (kind) con Argo CD y Vercel solo para el portal

## Estado

Aceptado — 2026-11-25. Reemplaza el [ADR 0003](0003-cloud.md), salvo Vercel para el frontend. Documenta lo que está en el repo desde la S07.

## Contexto

El ADR 0003 eligió una nube híbrida: Vercel (frontend), Render (API, worker y PostgreSQL) y AWS (SQS, Secrets Manager y CloudWatch). Desde la S07 el equipo construyó otra cosa:

- La API se empaqueta en imágenes firmadas y se despliega en Kubernetes (kind) con Kustomize, Terraform y Argo CD (ADR 0006, 0009 y 0011).
- PostgreSQL con pgvector corre fuera del clúster, en Docker Compose, y Ollama en el PC (`host.docker.internal`).
- El frontend tiene un proyecto en Vercel (`code/frontend/vercel.json`) que publica `main` con las cabeceras de seguridad.
- No existe cuenta de Render ni de AWS, y no hay presupuesto para pagarlas.

## Decisión

El ambiente del producto es **Kubernetes local (kind) gestionado con Argo CD**. Vercel se usa **solo como vitrina estática del portal**.

| Pieza | Dónde corre | Reemplaza a (ADR 0003) |
|---|---|---|
| API | kind, 2–6 réplicas con HPA, imágenes firmadas (Kyverno) | Render |
| Worker | No existe (ADR 0013) | Render + SQS |
| PostgreSQL + pgvector | Docker Compose fuera del clúster | PostgreSQL de Render |
| LLM y embeddings | Ollama en el PC | — |
| Secretos | Secret de Kubernetes creado por Terraform (`TF_VAR_*`) | AWS Secrets Manager |
| Logs | JSON a stdout (pino), con `kubectl logs` | CloudWatch |
| Frontend | Vercel (portal estático) y nginx en el clúster | Vercel |
| Staging para DAST | Compose efímero en el runner de CI | — |

## Consecuencias

**Gana:**

- Costo cero: todo corre en el PC del equipo y en los runners de GitHub.
- El mismo artefacto firmado pasa por CI, staging y clúster; Argo CD deja registro de cada despliegue.
- Ollama local: los textos de menores no salen a un proveedor externo.

**Pierde / se vuelve más difícil:**

- El sistema completo solo existe mientras el PC del laboratorio está prendido. No hay URL pública con API.
- El portal en Vercel carga, pero el login responde 404: `/v1` no existe allí hasta tener un backend público (ver `code/frontend/README.md`).
- Sin métricas centralizadas ni alertas: los logs se leen pod por pod.
- PostgreSQL fuera del clúster y sin respaldo automático: el plan de DR es nuestro.

## Alternativas descartadas

- **Render + AWS (ADR 0003):** requiere tarjeta y presupuesto mensual, y Ollama necesitaría un servidor con más memoria de la que da el plan gratuito.
- **Clúster administrado (EKS, GKE, AKS):** el costo mínimo del plano de control y los nodos supera lo que el taller puede pagar. El mismo Terraform sirve con el provider de EKS si se migra (ADR 0006).
- **Todo en Vercel con funciones serverless:** no sirve para streaming largo del tutor ni para la conexión a PostgreSQL con RLS por transacción.
- **Docker Compose sin Kubernetes:** más simple, pero sin HPA, sin políticas de admisión y sin GitOps, que son parte de lo que el taller evalúa.

## Fecha

2026-11-25

## Autores

Iván (Tech Lead)
