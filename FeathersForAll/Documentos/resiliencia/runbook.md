# Runbook de operación

Qué hacer ante cada falla conocida. Todos los comandos se corren en PowerShell desde la raíz del repo. Cada entrada sigue el mismo orden: **confirmar → mitigar → después**.

Primero, siempre:

```powershell
kubectl get pods -n feathersforall
Invoke-RestMethod http://localhost:8088/health        # status, db, llm
```

| Síntoma | Ir a |
|---|---|
| `localhost:8088` no responde nada | [R1](#r1--el-sitio-no-responde) |
| Todo responde 503, `db: down` | [R2](#r2--la-api-responde-503-en-todo) |
| Solo el tutor falla, `llm: down` | [R3](#r3--el-tutor-responde-503) |
| El tutor responde, pero muy lento | [R4](#r4--el-tutor-está-lento) |
| Muchos 429 en el tutor o en el login | [R5](#r5--muchos-429) |
| Pods en `CrashLoopBackOff` | [R6](#r6--crashloopbackoff) |
| Pods que no se crean (`ImagePullBackOff`, rechazo de Kyverno) | [R7](#r7--pods-que-no-se-crean) |
| CI en rojo por Trivy | [R8](#r8--el-ci-falla-por-un-cve-en-la-imagen-base) |
| Datos borrados o incorrectos | [R9](#r9--datos-perdidos-o-dañados) |
| Se filtró un secreto | [R10](#r10--se-filtró-un-secreto) |
| Docker sin espacio | [R11](#r11--docker-sin-espacio) |

---

### R1 · El sitio no responde

**Confirmar:** `docker ps` debe mostrar `feathersforall-control-plane` (el nodo de kind) y `ffa-db`. Si `docker ps` falla, Docker Desktop está cerrado.

**Mitigar:**
1. Abrir Docker Desktop y esperar a que diga *Engine running*.
2. Si el nodo de kind está detenido: `docker start feathersforall-control-plane`
3. Si los pods están `Running` pero el sitio no responde, revisar el Ingress:
   `kubectl get pods -n ingress-nginx` y `kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=50`

**Después:** si el clúster no vuelve, se recrea ([plan-dr D7](plan-dr.md)). Los datos no se pierden: la BD está fuera del clúster.

### R2 · La API responde 503 en todo

La base no responde: `/readyz` falla y los pods salen del balanceo. Es lo esperado. No se reinician solos y no hace falta reiniciarlos.

**Confirmar:** `docker ps -a --filter name=ffa-db` y `kubectl logs deploy/ffa-api -n feathersforall --tail=20` (buscar `No se pudo conectar con la base de datos`).

**Mitigar:**
1. `docker start ffa-db`
2. Esperar ~30 s: `kubectl get pods -n feathersforall` debe volver a `1/1`.
3. Si el contenedor arranca y se vuelve a detener: `docker logs ffa-db --tail=50`. Si el volumen está dañado, ir a [R9](#r9--datos-perdidos-o-dañados).

**Después:** si se cayó sola, revisar por qué (memoria de Docker Desktop, disco lleno → [R11](#r11--docker-sin-espacio)).

### R3 · El tutor responde 503

Ollama no responde. El resto del sistema funciona: avisar a los docentes que el tutor está fuera por unos minutos.

**Confirmar:** `Invoke-RestMethod http://localhost:11434/api/tags` debe listar `qwen2.5:3b` y `bge-m3`.

**Mitigar:**
1. Si no responde: abrir la app de Ollama, o `Start-Process ollama -ArgumentList serve -WindowStyle Hidden`.
2. Si responde pero faltan modelos: `ollama pull qwen2.5:3b` y `ollama pull bge-m3`.
3. Si Ollama responde en el PC pero la API dice `llm: down`, el pod no llega a `host.docker.internal`. Ver la tabla de problemas de [k8s/README.md](../../../k8s/README.md).

### R4 · El tutor está lento

**Confirmar:** `ollama ps`. Si el modelo no aparece cargado, la primera pregunta paga ~19 s de carga. Revisar también la CPU y la RAM del PC en el Administrador de tareas.

**Mitigar:**
- Que `LLM_KEEP_ALIVE` siga en `30m` (`k8s/configmap.yaml`): mantiene el modelo en memoria entre preguntas.
- Escalar la API **no ayuda**: el cuello de botella es Ollama, que es uno solo. Si hay muchos estudiantes a la vez, bajar `TUTOR_MAX_CONCURRENT` reparte mejor el LLM.

**Después:** si pasa seguido en horario de clases, el SLO S3 se está gastando. El arreglo de fondo es una GPU o un LLM por API ([finops/costos.md](../finops/costos.md)).

### R5 · Muchos 429

Son los topes funcionando:
- **Tutor:** 10 preguntas por minuto, 100 por hora y 2 a la vez por estudiante.
- **Login:** freno por IP + correo, por IP y por correo.

**Confirmar:** que sea un uso real (por ejemplo, un curso entero detrás de la misma IP del colegio) y no un ataque. En los logs, ver qué ruta y desde cuándo:
`kubectl logs -n feathersforall -l app.kubernetes.io/name=ffa-api --since=15m | Select-String '"status":429'`

**Mitigar:**
- Ataque: no tocar nada; el freno está haciendo su trabajo.
- Uso legítimo bloqueado en clases: los contadores viven en la memoria de cada pod. Reiniciar los pods los limpia (`kubectl rollout restart deployment/ffa-api -n feathersforall`, sin caída). Si se repite, subir el límite por variable de entorno en el configmap.

### R6 · CrashLoopBackOff

**Confirmar:** `kubectl logs deploy/ffa-api -n feathersforall --previous --tail=30`
- `DATABASE_URL requiere JWT_SECRET de al menos 32 caracteres` → falta el Secret o está mal.
- Error de sintaxis o de módulo → la imagen es mala.

**Mitigar:**
- Secret: volver a cargar `$env:TF_VAR_*` y correr `terraform apply` ([k8s/README.md](../../../k8s/README.md) paso 2), luego `kubectl rollout restart deployment/ffa-api -n feathersforall`.
- Imagen mala: revertir el último PR `deploy(dev)` en el repo gitops. Argo CD vuelve al digest anterior.

### R7 · Pods que no se crean

**Confirmar:** `kubectl describe pod <pod> -n feathersforall` (la sección *Events*).
- `ImagePullBackOff`: el digest no existe o el paquete de GHCR es privado.
- `admission webhook ... require-signature`: la imagen no viene firmada por el CI.

**Mitigar:** usar solo digests del resumen de `ci.yml` o del PR `deploy(dev)`. Nunca desactivar la policy de Kyverno para salir del paso.

### R8 · El CI falla por un CVE en la imagen base

Caso real: [post-mortem 2026-11-25](postmortems/2026-11-25-trivy-libzstd1.md).

**Confirmar:** en el log de Trivy, el paquete y la imagen. Si el paquete es de la imagen base (Debian de distroless), **no se puede parchar desde el Dockerfile**: distroless no tiene `apt`.

**Mitigar, en este orden:**
1. ¿Hay una imagen base nueva con el arreglo? Actualizar el digest de la base en el Dockerfile.
2. Si no hay: analizar si el código vulnerable se ejecuta en nuestra imagen. Solo si **no** se ejecuta, crear la excepción VEX con fecha de vencimiento ([.vex/README.md](../../../.vex/README.md)) y registrarla en [vulnerabilidades.md](../seguridad/vulnerabilidades.md).
3. Si nos afecta: no se despliega hasta corregirlo. Se evalúa otra imagen base.

### R9 · Datos perdidos o dañados

Seguir [plan-dr.md → Restaurar](plan-dr.md#restaurar). Lo primero es sacar la API de servicio y respaldar la base dañada antes de restaurar encima.

### R10 · Se filtró un secreto

**`JWT_SECRET`:**
1. Generar uno nuevo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Cargarlo en `$env:TF_VAR_jwt_secret`, luego `terraform apply -var-file=envs/dev.tfvars` en `terraform/`.
3. Reiniciar la API: `kubectl rollout restart deployment/ffa-api -n feathersforall`

Todos los tokens anteriores dejan de valer: los usuarios vuelven a iniciar sesión.

**Clave de `feathersforall_app`:**
1. Cambiarla en la base: `docker exec ffa-db psql -U postgres -c "ALTER ROLE feathersforall_app PASSWORD '<nueva>'"`
2. Actualizar `TF_VAR_database_url`, correr `terraform apply` y reiniciar la API como arriba.

**Después:** revisar los logs del periodo expuesto y escribir el post-mortem. Si el secreto llegó a Git, gitleaks debió detectarlo: revisar por qué no lo hizo.

### R11 · Docker sin espacio

**Confirmar:** `docker system df`

**Mitigar:** `docker image prune` (imágenes sin usar) y `docker builder prune`.

**Nunca** `docker volume prune` ni `docker system prune --volumes`: borran el volumen de PostgreSQL. Si el disco del PC está lleno, mover `$HOME\ffa-respaldos` antiguos a la copia externa.
