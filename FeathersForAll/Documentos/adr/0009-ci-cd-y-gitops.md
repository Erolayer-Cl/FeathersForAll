# ADR 0009 · CI/CD con GitHub Actions y GitOps pull-based con Argo CD

> La PPT S08 pide este ADR como `0005-gitops-strategy.md`. En este repo el 0005 ya es el del frontend, así que va con el siguiente número.

## Estado

Propuesto — 2026-10-26. Pendiente de ratificar en la reunión del equipo.

## Contexto

Hasta S07, desplegar era manual: `k8s/tools/publicar-imagenes.ps1` construía las imágenes en el PC de alguien, las subía a GHCR, escribía los digest en `k8s/kustomization.yaml` y luego alguien corría `kubectl apply -k k8s/`. Las pruebas, el lint y el contrato se verificaban solo si cada uno se acordaba de correrlos.

**Fuerzas en juego:**
- **Datos de menores:** un cambio que rompa el RLS (por ejemplo, que un docente vea notas de otro curso) no puede llegar al clúster. Las pruebas que lo verifican necesitan un PostgreSQL real.
- **El clúster es un kind en el PC** del laboratorio, sin IP pública. Un pipeline en GitHub no tiene cómo llegar a su API server.
- **Equipo de 6 personas, estudiantes, un solo producto SaaS** con una sola versión en producción y PRs cortos.
- **Credenciales:** el ADR 0006 ya separa plataforma (Terraform: namespace y Secrets) de aplicación (Kustomize). Las credenciales del clúster no deberían salir de él.
- **Auditoría:** con datos de menores (Ley 19.628 / 21.719) conviene que cada despliegue deje un registro de quién lo aprobó y qué cambió.
- **El tutor necesita Ollama**, que no existe en los runners de CI.

## Decisión

1. **CI en GitHub Actions** (`.github/workflows/ci.yml`), en el mismo repo del código, con quality gates **bloqueantes**: contrato (Spectral + cliente TS al día), ESLint, pruebas con cobertura de líneas **≥ 70 %** (backend con PostgreSQL + pgvector reales, incluido el RLS; frontend sobre la lógica `src/**/*.js`), SCA (`npm audit` High/Critical), SAST (Semgrep), e2e con Compose + Newman sin la carpeta del tutor y escaneo de imagen con Trivy (High/Critical con arreglo). Detalle en `Documentos/infra/ci-cd.md`.
2. **Imágenes** en GHCR, tagueadas por `${{ github.sha }}` y desplegadas **por digest**. Se publican solo desde `main`, con el `GITHUB_TOKEN` del workflow (sin tokens personales para el registro).
3. **GitOps pull-based con Argo CD**, en un **repo separado** `Erolayer-Cl/feathersforall-gitops` con `base/` + `overlays/{dev,prod}/`. CI no habla con Kubernetes: el job `promote` abre un PR que cambia el digest en `overlays/dev` y, al mergearlo, Argo CD (dentro del clúster) lo aplica. Dev se sincroniza solo (`prune` + `selfHeal`).
4. **Prod** recibe solo lo que ya corre en dev: workflow manual `promote-prod`, con el Environment `production` (revisores obligatorios) y un PR con 2 revisores en el repo gitops. Su Application tiene sync manual.
5. **Branching: GitHub Flow** sobre `main` protegida: PR obligatorio con 2 aprobaciones, todos los checks en verde, sin push directo ni force push. Ramas `feat/...` de vida corta (< 48 h).
6. **Estrategia de despliegue: rolling update** (la que ya tienen los Deployments: `maxUnavailable: 0`, `maxSurge: 1`). Canary con Argo Rollouts y feature flags por colegio quedan para cuando haya tráfico real que lo justifique.

## Consecuencias

**Gana:**

- Ningún cambio llega a `main` sin pasar los gates. En la primera corrida local ya aparecieron 3 hallazgos reales (`Documentos/seguridad/vulnerabilidades.md`): `body-parser` con DoS (CVSS 7.5) y las dos imágenes base con OpenSSL vulnerable (CVSS 9.8).
- Las credenciales del clúster no salen del clúster: GitHub solo tiene un token con permiso sobre **un** repo de manifiestos.
- Cada despliegue es un PR: queda quién lo pidió, quién lo aprobó y qué digest cambió. **Rollback = revertir el PR.**
- El drift se detecta y se corrige solo: un `kubectl edit` a mano dura hasta la siguiente reconciliación.
- Funciona con el kind del PC, que no es alcanzable desde internet: es Argo CD el que sale a GitHub, no al revés.

**Pierde / se vuelve más difícil:**

- Dos repos que mantener coordinados, y `k8s/` del repo app queda como referencia de S07. Desde S08, la fuente de verdad del despliegue es el repo gitops.
- Hay que instalar y operar Argo CD (un namespace más, su UI y sus actualizaciones).
- Con 2 revisores, incluso el PR automático de dev espera aprobaciones. Si frena demasiado al equipo, se puede bajar a 1 en el repo gitops y mantener 2 para `overlays/prod` (CODEOWNERS).
- `GITOPS_TOKEN` es un secreto que vence y hay que rotar. En S09 se puede cambiar por una GitHub App.
- El tutor (Ollama) no se prueba end-to-end en CI: lo cubren las pruebas con LLM simulado y la carpeta 6/8 de Postman en local.
- Pipeline más lento (~5–8 min por PR), a cambio de jobs en paralelo y caché de npm y Docker.

## Alternativas descartadas

- **Push-based (CI con `kubectl apply` o `helm upgrade`):** requiere guardar el kubeconfig en GitHub y que el API server sea alcanzable desde internet, y el kind del laboratorio no lo es. Además, el estado real puede desviarse del repo sin que nadie lo note.
- **Flux en vez de Argo CD:** más liviano y 100 % por CLI, pero sin UI. El entregable pide mostrar el estado *Synced/Healthy* y al equipo le sirve ver el árbol de recursos. Si el equipo crece hacia multi-clúster, Argo CD además tiene ApplicationSets.
- **Carpeta `gitops/` en el mismo repo:** más simple (el `GITHUB_TOKEN` alcanzaría), pero mezcla los permisos (quien puede tocar código puede desplegar) y el historial de despliegues queda enterrado entre commits de código. La PPT recomienda separarlos.
- **GitFlow:** sobrecosto de ramas `develop` y `release` sin beneficio: hay una sola versión en producción. El remoto ni siquiera tiene `develop`.
- **Trunk-based puro (commits directos a `main`):** necesita feature flags maduros y un CI muy rápido. Por ahora, PRs cortos con revisión dan más seguridad a un equipo de estudiantes.
- **GitLab CI o Azure DevOps:** el código ya vive en GitHub y GHCR está integrado con Actions. Migrar no aporta nada que falte.

## Fecha

2026-10-26

## Autores

Ignacio (DevSecOps), con asistencia de IA (Claude Code).

> Regla del taller: un ADR nunca se edita una vez aceptado. Si cambia la decisión, se marca como "Reemplazado" y se crea uno nuevo. Un archivo por ADR en `Documentos/adr/`, numerados: `NNNN-titulo-corto.md`.
