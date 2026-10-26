# CI/CD y GitOps (S08)

Del commit al clúster sin que nadie corra `kubectl`. La decisión y sus porqués están en el [ADR 0009](../adr/0009-ci-cd-y-gitops.md).

```text
 repo app (Erolayer-Cl/FeathersForAll)                     repo gitops (Erolayer-Cl/feathersforall-gitops)
 ──────────────────────────────────────                    ─────────────────────────────────────────────
 PR a main ──▶ ci.yml: quality gates + build (sin push)
 merge a main ──▶ ci.yml: gates ──▶ build + Trivy ──▶ push GHCR (por sha)
                                                    └─▶ promote: PR "deploy(dev): <sha>"  ──▶ overlays/dev
                                                                                               │ merge
 Actions → promote-prod (aprobación Environment) ──────▶ PR "deploy(prod): …" (2 revisores) ──▶ overlays/prod
                                                                                               │
 clúster kind ◀──────── Argo CD (dentro del clúster) observa main del repo gitops y reconcilia ◀┘
```

| Archivo | Qué hace |
|---|---|
| `.github/workflows/ci.yml` | Quality gates, build/escaneo/push de imágenes y PR de promoción a dev |
| `.github/workflows/promote-prod.yml` | Copia a prod los digest de dev (manual, con aprobación) |
| repo `feathersforall-gitops` | `base/` + `overlays/{dev,prod}/` (Kustomize) y `argocd/` (AppProject + Applications) |
| [`Documentos/seguridad/vulnerabilidades.md`](../seguridad/vulnerabilidades.md) | Lo que encontraron los gates (CVE, CWE, CVSS) y cómo se cerró |

## Quality gates

Regla de la PPT: *si un gate no bloquea, es un log, no un gate*. Todos estos bloquean el merge (una vez activada la protección de rama, paso 5).

| Gate | Job | Herramienta | Falla si… |
|---|---|---|---|
| Contrato | `contrato` | Spectral + openapi-typescript + tsc | Hay errores de lint en `openapi.yaml` o el cliente TS no está regenerado |
| Lint | `backend`, `frontend` | ESLint | Hay un error |
| Pruebas + cobertura | `backend` | `node --test` con PostgreSQL real (RLS incluido) | Falla una prueba o la cobertura de líneas baja de **70 %** (hoy 98,9 %) |
| Pruebas + cobertura | `frontend` | Vitest + v8 | Falla una prueba o la cobertura de líneas de la lógica (`src/**/*.js`) baja de **70 %** (hoy 91 %) |
| SCA | `backend`, `frontend` | `npm audit --omit=dev --audit-level=high` | Hay una dependencia de producción con CVE High/Critical |
| SAST | `sast` | Semgrep (`p/javascript`, `p/nodejs`) | Hay un hallazgo de severidad ERROR |
| e2e | `e2e-newman` | Docker Compose + Newman | Falla una aserción (salud, login, perfil, cursos, notas, privacidad y seguridad; sin el tutor, porque en CI no hay Ollama) |
| Imagen | `build-and-push` | Trivy | La imagen tiene CVE High/Critical **con arreglo disponible** |
| Aprobación humana | `promote-prod` | Environment `production` + PR con 2 revisores | Nadie aprueba |

**Cobertura en rojo = menos de 70 %**, en backend y frontend. En el frontend se mide la lógica: quedan fuera los componentes `.jsx` y los hooks/contextos de React (`use*.js`, `*Context.js`), que todavía no tienen pruebas.

### Bloqueantes hoy y en S09

| Hoy (S08) | Pasa a bloquear en S09 (DevSecOps I) |
|---|---|
| Todos los de la tabla de arriba | Cobertura ≥ 70 % también en `.jsx` y hooks (Testing Library + jsdom) |
| | Secret scanning (gitleaks) en cada PR |
| | SBOM (Syft) publicado junto a la imagen y firma con cosign (OIDC, sin claves largas) |
| | DAST: ZAP baseline contra dev |
| | Dependabot o SCA programado (`schedule`), para no depender de que alguien haga push ([VULN-001](../seguridad/vulnerabilidades.md)) |

## Puesta en marcha (una vez)

Lo hace alguien con permisos de admin en la organización **Erolayer-Cl** (DevSecOps / Tech Lead).

### 1. Crear el repo gitops

1. Abre <https://github.com/organizations/Erolayer-Cl/repositories/new> (o "+" → **New repository** y en *Owner* elige **Erolayer-Cl**).
2. **Repository name:** `feathersforall-gitops`.
3. **Public**: así Argo CD lo lee sin credenciales. No tiene nada secreto: los Secrets los crea Terraform.
4. **No** marques README, `.gitignore` ni licencia: el repo debe quedar **vacío**.
5. **Create repository**.

No es un fork: el repo gitops no lleva código de la app, solo manifiestos. El contenido inicial ya está armado en local (`../feathersforall-gitops`, al lado de este repo). Para subirlo:

```bash
cd ../feathersforall-gitops          # ya tiene git init, rama main y el remoto configurado
git add .
git commit -m "feat: base Kustomize, overlays dev/prod y Applications de Argo CD (S08)"
git push -u origin main
```

### 2. Token para que CI abra PRs en el repo gitops (`GITOPS_TOKEN`)

El `GITHUB_TOKEN` de Actions solo sirve para el repo donde corre el workflow; para escribir en **otro** repo hace falta un token.

1. GitHub → tu foto → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner:** Erolayer-Cl. **Expiration:** hasta fin de semestre.
3. **Repository access:** *Only select repositories* → `feathersforall-gitops` (**solo** ese).
4. **Permissions** → *Repository permissions*: **Contents: Read and write** y **Pull requests: Read and write**. Nada más.
5. Copia el token y guárdalo en el repo app: `FeathersForAll` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → nombre `GITOPS_TOKEN`.

Si la organización exige aprobar los tokens fine-grained, un owner lo aprueba en *Settings → Personal access tokens → Pending requests*.

### 3. Environment `production` (aprobación humana para prod)

Repo app → **Settings** → **Environments** → **New environment** → `production` → **Required reviewers**: dos personas del equipo (por ejemplo, Iván y Juan) → **Prevent self-review** activado → **Save protection rules**.

### 4. Paquetes de GHCR públicos

La primera vez que `ci.yml` publica en `main` se crean (o actualizan) `feathersforall-api` y `feathersforall-web` en GHCR. Si son nuevos: organización → **Packages** → cada paquete → **Package settings** → **Change visibility → Public** (kind los descarga sin credenciales), y en **Manage Actions access** agrega el repo `FeathersForAll` con rol **Write**.

### 5. Protección de rama (2 revisores, checks obligatorios, sin push directo)

En **ambos** repos: **Settings** → **Branches** → **Add branch ruleset** (o *Add classic branch protection rule*) para `main`:

- **Require a pull request before merging** → **Required approvals: 2** → *Dismiss stale approvals* activado.
- **Require status checks to pass** → en el repo app agrega: `contrato`, `backend`, `frontend`, `sast`, `e2e-newman`, `build-and-push (api, code/backend)` y `build-and-push (web, code/frontend)`. Los nombres aparecen después de la primera run.
- **Block force pushes** y sin *bypass* (ni siquiera para admins).

Con `gh` (si lo tienen instalado), el equivalente para el repo app:

```bash
gh api -X PUT repos/Erolayer-Cl/FeathersForAll/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["contrato", "backend", "frontend", "sast", "e2e-newman",
    "build-and-push (api, code/backend)", "build-and-push (web, code/frontend)"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 2, "dismiss_stale_reviews": true },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

> Con 6 integrantes, 2 revisores es viable. Ojo: el PR automático `deploy(dev)` también necesitará 2 aprobaciones en el repo gitops. Si el equipo prefiere que dev se despliegue sin revisión, se puede bajar a 1 en el repo gitops y dejar 2 para los PR de prod (con CODEOWNERS sobre `overlays/prod/`).

### 6. Argo CD en el clúster kind

Requiere el clúster, la plataforma de Terraform y el namespace de S07 (`k8s/README.md`, pasos 1 y 2).

```bash
kubectl create namespace argocd
# --server-side: los CRD de Argo CD superan el límite de anotaciones de un apply normal
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/install.yaml
kubectl wait -n argocd --for=condition=available deployment --all --timeout=300s

# Proyecto y aplicación dev (desde el repo gitops)
kubectl apply -f ../feathersforall-gitops/argocd/project.yaml
kubectl apply -f ../feathersforall-gitops/argocd/application-dev.yaml
```

Si antes desplegaste con `kubectl apply -k k8s/` (S07), Argo CD adopta esos recursos: tienen el mismo nombre y namespace.

**UI y screenshot del entregable:**

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
kubectl -n argocd port-forward svc/argocd-server 8443:443
```

Abre <https://localhost:8443> (usuario `admin`, acepta el certificado autofirmado). La app `feathersforall-dev` debe verse **Synced** y **Healthy** → captura en `Documentos/infra/argocd-synced.png`.

Mientras `overlays/dev` tenga los digest de ejemplo (`sha256:0000…`), la app va a estar **Degraded** (`ImagePullBackOff`): es lo esperado hasta el primer PR `deploy(dev)` (paso siguiente).

## Verificar el flujo completo (entregable)

1. Abre un PR al repo app → `ci.yml` corre los gates y construye las imágenes sin publicarlas.
2. Con 2 aprobaciones y todo en verde, merge → `ci.yml` vuelve a correr en `main`, publica en GHCR y el job `promote` abre en el repo gitops el PR **`deploy(dev): FeathersForAll <sha>`**.
3. Merge de ese PR → en ≤ 3 min (intervalo de sondeo de Argo CD; o **Refresh** en la UI) la app pasa a la nueva versión:

   ```bash
   kubectl -n feathersforall get deploy ffa-api -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
   kubectl -n feathersforall rollout status deploy/ffa-api
   ```

4. **Rollback:** *Revert* del PR `deploy(dev)` en GitHub → Argo CD vuelve a la imagen anterior. Nadie toca el clúster.
5. **Drift:** `kubectl -n feathersforall scale deploy/ffa-web --replicas=5` → Argo CD lo devuelve a 2 (`selfHeal`).

Evidencia para el entregable: la run verde de `ci.yml` en `main`, el PR `deploy(dev)` mergeado y el screenshot Synced/Healthy.

## Correr los gates en local antes del PR

```bash
cd code/backend
npm run lint
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:coverage
npm audit --omit=dev --audit-level=high

cd ../frontend
npm run lint && npm run test:coverage && npm run build

cd ../..   # raíz
docker run --rm -v "$PWD:/src:ro" -w /src semgrep/semgrep:1.140.0 \
  semgrep scan --config p/javascript --config p/nodejs --severity ERROR --error --metrics=off code
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12     # sintaxis de los workflows
```
