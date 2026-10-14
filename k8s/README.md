# FeathersForAll en Kubernetes (S07)

Imagen Docker → clúster local **kind** → plataforma con **Terraform** → aplicación con **Kustomize** → **HPA** probado con carga.
Las decisiones y su justificación están en el [ADR 0006](../FeathersForAll/Documentos/adr/0006-plataforma-k8s.md).

```text
PC (Windows)                                   clúster kind "feathersforall"
──────────────                                 ───────────────────────────────────────────────
Ollama :11434  ◀── host.docker.internal ──┐    namespace feathersforall  (Terraform: restricted, cuota, Secret)
PostgreSQL :5433 ◀────────────────────────┤    ├─ Ingress  /v1, /health → ffa-api   /  → ffa-web
localhost:8088 ──▶ ingress-nginx ─────────┼──▶ ├─ ffa-api  Deployment (2–6 réplicas, HPA CPU 65 %) + Service
                                          └────├─ ffa-web  Deployment (2 réplicas, NGINX) + Service
                                               └─ ConfigMap ffa-api-config · Secret ffa-api-secrets · PDB
```

| Archivo | Qué es |
|---|---|
| `kustomization.yaml` | Lista de recursos, namespace e imágenes por digest |
| `configmap.yaml` | Configuración no secreta de la API |
| `deployment.yaml` | API (distroless, nonroot) y frontend (nginx-unprivileged), con sondas y recursos |
| `service.yaml` | ClusterIP de cada uno |
| `ingress.yaml` | Ruteo HTTP (streaming del chat sin buffer) |
| `hpa.yaml` | Escalado de la API: 2–6 réplicas por CPU |
| `pdb.yaml` | Siempre al menos 1 réplica de la API durante mantenciones |
| `cluster/kind.yaml` | Definición del clúster local (no se aplica con `-k`) |
| `tools/publicar-imagenes.ps1` | Build + push a GHCR + digest en `kustomization.yaml` |
| `tools/carga.yaml` | Carga sintética para probar el HPA (no se aplica con `-k`) |

## 0. Prerrequisitos (una vez)

- **Docker Desktop** abierto.
- **Ollama** con `qwen2.5:3b` y `bge-m3`.
- La **base `ffa-db`** del entregable (`docker run ... pgvector/pgvector:pg16`, puerto 5433), ya creada con `npm run db:setup -- --demo`.

Detalle de los tres en `GUIA_PASO_A_PASO.md` del entregable.

```powershell
winget install Kubernetes.kind
winget install Kubernetes.kubectl
winget install Hashicorp.Terraform
# cerrar y abrir PowerShell
kind version; kubectl version --client; terraform version      # Terraform >= 1.6
```

Todos los comandos se corren desde la **raíz del repo**.

## 1. Clúster kind + ingress + métricas

```powershell
kind create cluster --config k8s/cluster/kind.yaml
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file k8s/cluster/metrics-server-patch.json
kubectl wait -n ingress-nginx --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s
```

## 2. Plataforma con Terraform (namespace + cuota + Secret)

```powershell
docker exec ffa-db createdb -U postgres terraform_state          # base para el state remoto (una vez)
$env:PG_CONN_STR = "postgres://postgres:postgres@localhost:5433/terraform_state?sslmode=disable"

# Secretos de la API DENTRO del clúster: la BD se ve como host.docker.internal
$env:TF_VAR_database_url = "postgres://feathersforall_app:clave-app-123@host.docker.internal:5433/feathersforall"
$env:TF_VAR_jwt_secret   = "<el mismo JWT_SECRET de code/backend/.env>"

cd terraform
terraform init
terraform workspace select -or-create dev
terraform validate
terraform plan  -var-file=envs/dev.tfvars
terraform apply -var-file=envs/dev.tfvars        # escribir: yes
cd ..
```

## 3. Imágenes en GHCR por digest

1. Crea un token en GitHub → Settings → Developer settings → Personal access tokens (classic), con el permiso `write:packages`.
2. Inicia sesión, construye y publica:

   ```powershell
   docker login ghcr.io -u Kypp3rv1l          # clave = el token
   Set-ExecutionPolicy -Scope Process Bypass  # permite correr el script solo en esta ventana
   .\k8s\tools\publicar-imagenes.ps1          # sin permiso en la organización:  -Owner kypp3rv1l
   git diff k8s/kustomization.yaml            # deben aparecer los dos sha256 nuevos
   ```

3. La primera vez, en GitHub → tu perfil (u organización) → **Packages** → `feathersforall-api` y `feathersforall-web` → *Package settings* → **Change visibility → Public**. Si no, kind no puede descargarlas.

Revisa que el script imprima un tamaño **< 200 MB** para la API.

## 4. Desplegar la aplicación

```powershell
kubectl apply -k k8s/
kubectl rollout status deployment/ffa-api -n feathersforall
kubectl get all -n feathersforall          # ← screenshot para el README (Documentos/infra/kubectl-get-all.png)
```

Probar:
- Navegador: abre http://localhost:8088 (chat) y http://localhost:8088/portal.html (portal por rol). Funcionan igual que con `npm run dev`.
- PowerShell: `Invoke-RestMethod http://localhost:8088/health` debe responder `llm: up` y `db: up`.

## 5. Probar el HPA con carga sintética

```powershell
kubectl top pods -n feathersforall                          # métricas OK (puede tardar ~1 min tras crear el clúster)
kubectl apply -n feathersforall -f k8s/tools/carga.yaml
kubectl get hpa ffa-api -n feathersforall --watch           # TARGETS sube > 65 % y REPLICAS 2 → 3…6  (Ctrl+C)
kubectl delete -n feathersforall -f k8s/tools/carga.yaml    # en ~2 min vuelve a 2 réplicas
```

Toma una captura del `--watch` cuando suban las réplicas: es la evidencia de "HPA configurado y probado".

## 6. Verificaciones de seguridad

```powershell
kubectl get pod -n feathersforall -l app.kubernetes.io/name=ffa-api -o jsonpath="{.items[0].spec.securityContext}"
kubectl exec -n feathersforall deploy/ffa-api -- sh          # falla: la imagen distroless no tiene shell
kubectl run root-test -n feathersforall --image=busybox:1.36 --restart=Never -- id   # rechazado por Pod Security "restricted"
```

## Actualizar o limpiar

- Cambió el código: vuelve a correr `.\k8s\tools\publicar-imagenes.ps1` y luego `kubectl apply -k k8s/`. Hay un digest nuevo, así que se hace un rolling update sin caída.
- Borrar todo: `kind delete cluster --name feathersforall`. El state de Terraform queda en la base `terraform_state`; si recreas el clúster, borra el workspace dev o vuelve a aplicar.

## Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `ImagePullBackOff` | El paquete GHCR es privado (hazlo público) o el digest todavía es `0000…` (paso 3). |
| Pods de la API `0/1 Running` | `/readyz` falla porque no llega a la BD. Revisa `kubectl logs deploy/ffa-api -n feathersforall` y `TF_VAR_database_url` (debe usar `host.docker.internal:5433`), y que `ffa-db` esté encendida. |
| `/health` dice `llm: down` | Ollama apagado, o el pod no resuelve `host.docker.internal`. Prueba `kubectl run dns -n feathersforall --rm -it --image=busybox:1.36 --restart=Never -- nslookup host.docker.internal`. Si no resuelve, cambia `LLM_ENDPOINT` en `configmap.yaml` por la IP de tu PC (`ipconfig`). |
| HPA con `TARGETS <unknown>` | metrics-server sin el parche del paso 1, o aún no junta datos (espera 1–2 min). |
| `port is already allocated` (kind) | El puerto 8088 está ocupado: cámbialo en `cluster/kind.yaml` y recrea el clúster. |
| `Error acquiring the state lock` | Otro `terraform apply` en curso. Espera; nunca uses `-lock=false`. |
| `forbidden: violates PodSecurity "restricted"` | Es lo esperado para pods que corren como root. Los de la app cumplen la política. |
