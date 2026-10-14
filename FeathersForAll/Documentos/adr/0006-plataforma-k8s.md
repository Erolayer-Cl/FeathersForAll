# ADR 0006 · Contenedores, Kubernetes e IaC: distroless, kind, Kustomize y Terraform

## Estado

Propuesto — 2026-10-14. Entregable de la S07 (la pauta lo llama `0004-plataforma-k8s.md`, pero el número 0004 ya es "Datos y eventos": un ADR aceptado no se renumera). Pendiente de ratificar en la reunión del equipo.

## Contexto

Hasta la S06 la API y el frontend corren con `npm run dev` en cada PC: "en mi máquina funciona". La S07 pide empaquetar el servicio principal en una imagen reproducible y segura, desplegarlo con manifiestos declarativos y describir la infraestructura como código, como base para CI/CD (S08) y DevSecOps (S09–S10).

Fuerzas en juego:

- Equipo de 6 sin DevOps dedicado; cada integrante debe poder levantar el clúster en su PC con Windows.
- Datos de menores: imagen mínima, sin root, sin secretos dentro de la imagen ni en git.
- Picos de uso en periodo de pruebas (escalado horizontal; RNF del charter).
- ADR 0003 ya eligió servicios administrados (Render, Vercel, AWS) para el piloto. Esta decisión no la reemplaza: Kubernetes es el **modelo de despliegue portátil** del sistema y el ambiente local/de laboratorio; el destino productivo del piloto se reevalúa con el costo real (S15, FinOps).
- El estado (PostgreSQL + pgvector) y el LLM (Ollama, ~3 GB de modelos) no son stateless.

## Decisión

1. **Imágenes Docker multi-stage**
   - API: `node:22-bookworm-slim` para instalar dependencias y correr pruebas (stage `test`) → runtime `gcr.io/distroless/nodejs22-debian12:nonroot`.
   - Frontend: build con Node → `nginxinc/nginx-unprivileged` sirviendo solo estáticos.
   - Ambas corren sin root (uid 65532 y 101), con raíz de solo lectura.
   - Se publican en GHCR y se referencian **por digest** (`@sha256:…`), nunca `:latest`.
2. **Distro de Kubernetes local: kind** (Kubernetes dentro de Docker), un nodo, con ingress-nginx y metrics-server.
3. **Manifiestos con Kustomize** (`k8s/`, `kubectl apply -k k8s/`): Deployment, Service, Ingress, ConfigMap, HPA y PodDisruptionBudget.
4. **Terraform** (`terraform/`) crea la plataforma del equipo:
   - namespace con Pod Security `restricted`;
   - ResourceQuota y LimitRange;
   - el Secret de la API.

   El módulo es reutilizable (`modules/app-namespace`). El state es remoto con locking (backend `pg`) y hay un workspace por ambiente.
5. **Lo stateful queda fuera del clúster:** PostgreSQL (administrado, como en ADR 0003/0004) y Ollama (en el PC, accesible como `host.docker.internal`). En el clúster solo corren servicios stateless.

## Por qué cada elección

| Tema | Elegido | Razón |
|---|---|---|
| Base de runtime de la API | distroless nodejs22 nonroot | Sin shell, apt ni npm: menos CVE y nada que ejecutar si alguien entra. Misma versión mayor que en desarrollo. Estimado < 200 MB (verificar con `docker images`). |
| Base de runtime del frontend | nginx-unprivileged | Servir estáticos con un servidor probado; variante sin root en el puerto 8080. Es Alpine (tiene shell): aceptable porque solo sirve archivos públicos. |
| Distro K8s | kind | Se crea y destruye en segundos, se describe en un YAML versionado (`k8s/cluster/kind.yaml`) y es lo que usaremos en GitHub Actions en la S08. |
| Manifiestos | Kustomize | Viene dentro de `kubectl`, es YAML puro y no hay plantillas que depurar. Con un solo servicio no hacen falta los valores parametrizados de Helm. Un ambiente nuevo es un overlay. |
| IaC | Terraform | Multi-cloud, el estándar del curso y el que más documentación tiene. El mismo módulo sirve con el provider de EKS si algún día se migra. |
| State | backend `pg` (local), S3 + DynamoDB lock (AWS) | Remoto y con bloqueo sin cuentas extra: reutiliza el PostgreSQL que ya corremos. Nunca `.tfstate` en git (está en `.gitignore`). |
| Secretos | Secret de K8s creado por Terraform, valores por `TF_VAR_*` | Nada sensible en el repo ni en la imagen. En AWS: External Secrets + Secrets Manager (ADR 0003). |
| Escalado | HPA por CPU 65 %, 2–6 réplicas | Con mínimo 2, un reinicio no deja el servicio caído. El techo de 6 controla el costo y las conexiones a la BD (6 × pool 10). El escalado por latencia p95 requiere Prometheus (S11). |
| Sondas | `/livez` (proceso) y `/readyz` (BD) | Si cae Ollama o la BD, no se reinicia el pod en bucle: solo sale del balanceo. El chat ya responde 503 RFC 7807. |

## Consecuencias

**Gana:**

- Mismo artefacto inmutable (digest) en el PC, en CI y en cualquier ambiente.
- Seguridad por defecto:
  - sin root;
  - sin escalamiento de privilegios;
  - capabilities eliminadas;
  - raíz de solo lectura;
  - namespace `restricted`;
  - secretos fuera de git.
- Escalado horizontal declarado y probado (HPA + carga sintética).
- La S08 automatiza estos pasos tal cual: build → push → `kubectl apply -k` (o Argo CD).

**Pierde / se vuelve más difícil:**

- Más herramientas que instalar (Docker Desktop, kind, kubectl, Terraform).
- Depurar una imagen distroless sin shell: se usa `kubectl debug` con un contenedor efímero.
- Dos modelos de despliegue conviven (servicios administrados del ADR 0003 y Kubernetes) hasta decidir el destino del piloto.
- Ollama fuera del clúster: el clúster local depende del PC. En un ambiente real se usa un proveedor LLM administrado o un nodo con GPU.

## Alternativas descartadas

- **minikube:** una VM más pesada en Windows y más lento de recrear.
- **k3d:** liviano, pero menos usado en CI que kind.
- **Kubernetes de Docker Desktop:** no se versiona como código y no existe en CI.
- **Helm:** agrega plantillas y valores que no necesitamos con un solo servicio. Se reconsidera si publicamos un chart para otros colegios.
- **Pulumi:** IaC en TypeScript con pruebas unitarias, pero suma un SDK y su servicio de state; el equipo ya conoce HCL desde el curso.
- **CloudFormation:** solo AWS, y el clúster local no es AWS.
- **`node:22-alpine` como runtime:** más pequeña, pero trae shell y npm, y usa musl (diferencias con desarrollo).
- **PostgreSQL dentro del clúster (StatefulSet):** volúmenes, respaldos y actualizaciones a cargo nuestro. Se mantiene administrado (ADR 0003).

## Fecha

2026-10-14

## Autores

Equipo AulaViva (redacción: Tech Lead)
