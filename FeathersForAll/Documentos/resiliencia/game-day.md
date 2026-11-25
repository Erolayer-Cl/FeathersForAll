# Game day: guion

Se rompe el sistema a propósito, de a una pieza, para comprobar que se comporta como dicen el [plan de DR](plan-dr.md) y los [SLOs](slos.md). Cada experimento tiene una hipótesis escrita **antes** de correrlo: si no se cumple, es un hallazgo y lleva post-mortem.

**Dónde:** el clúster kind del laboratorio, con la app desplegada ([k8s/README.md](../../../k8s/README.md) pasos 1–4), `ffa-db` y Ollama encendidos.
**Duración:** ~1 h 30 min. **Roles:** quien provoca la falla, quien mira la sonda y anota, y quien observa el clúster.

## Antes de empezar

1. Verificar que todo está sano:
   ```powershell
   kubectl get pods -n feathersforall                  # todo Running, ffa-api 2/2
   Invoke-RestMethod http://localhost:8088/health      # db: up, llm: up
   ```
2. Hacer un respaldo (si algo sale mal, se vuelve aquí): `.\k8s\tools\respaldo-bd.ps1`
3. Abrir **tres ventanas de PowerShell** en la raíz del repo:
   - **A (sonda):** `.\k8s\tools\sonda.ps1 -Experimento <nombre>`. Una medición por segundo a `/`, `/v1/me` y `/health`; al final imprime disponibilidad, p95 y la caída más larga.
   - **B (falla):** los comandos de cada experimento.
   - **C (clúster):** `kubectl get pods -n feathersforall -w`
4. Dejar la sonda corriendo 30 s antes de provocar cada falla, para tener una línea base.

## Experimentos

### E1 · Se cae un pod de la API (D1)

**Hipótesis:** la otra réplica atiende. La sonda ve como mucho 1–2 errores (requests que iban a ese pod) y Kubernetes crea un pod nuevo en menos de 30 s.

```powershell
# A
.\k8s\tools\sonda.ps1 -Experimento E1-pod-caido -Segundos 120
# B (a los 30 s): borra un pod sin darle tiempo de cerrar, como si el proceso muriera
$pod = kubectl get pod -n feathersforall -l app.kubernetes.io/name=ffa-api -o name | Select-Object -First 1
kubectl delete $pod -n feathersforall --grace-period=0 --force
```

Anotar: errores en `api`, segundos hasta que el pod nuevo queda `1/1` (ventana C).

### E2 · Despliegue sin caída (rolling update)

**Hipótesis:** 0 errores. El Deployment usa `maxUnavailable: 0` y la API cierra ordenadamente con SIGTERM (hasta 10 s).

```powershell
# A
.\k8s\tools\sonda.ps1 -Experimento E2-rollout -Segundos 150
# B (a los 30 s)
kubectl rollout restart deployment/ffa-api -n feathersforall
kubectl rollout status deployment/ffa-api -n feathersforall
```

**Si aparecen 502 o 503 sueltos:** es la carrera conocida entre el SIGTERM y el momento en que el Ingress deja de mandar tráfico a ese pod. La API deja de aceptar conexiones de inmediato, pero ingress-nginx tarda un par de segundos en enterarse. La corrección es una pausa antes de cerrar: `lifecycle.preStop.sleep.seconds: 5` y `terminationGracePeriodSeconds: 20`. La imagen distroless no tiene `sleep`, así que hace falta la pausa nativa de Kubernetes (1.30 o superior). El cambio va en el repo gitops, y E2 se repite para confirmar.

### E3 · Se cae Ollama (D3)

**Hipótesis:** el tutor responde 503 (RFC 7807) en pocos segundos, sin quedarse colgado. `/v1/me` y el portal siguen con 100 %. Ningún pod se reinicia (la columna RESTARTS no cambia). `/health` muestra `llm=down`.

```powershell
# A
.\k8s\tools\sonda.ps1 -Experimento E3-ollama -Segundos 180
# B (a los 30 s)
Get-Process | Where-Object { $_.ProcessName -like "ollama*" } | Stop-Process -Force
# B: con Ollama abajo, preguntar al tutor como estudiante
$t = (Invoke-RestMethod -Method Post http://localhost:8088/v1/auth/login -ContentType "application/json" -Body '{"email":"camila@demo-a.cl","password":"demo1234"}').access_token
try {
  Invoke-RestMethod -Method Post http://localhost:8088/v1/dev/chat -Headers @{ Authorization = "Bearer $t" } -ContentType "application/json" -Body '{"messages":[{"role":"user","content":"Que es una fraccion equivalente?"}]}'
} catch { $_.ErrorDetails.Message }      # debe ser un problem+json con status 503
# B (a los 120 s): volver a levantarlo
Start-Process ollama -ArgumentList serve -WindowStyle Hidden    # o abrir la app de Ollama
```

### E4 · Se cae PostgreSQL (D4)

**Hipótesis:** a los ~30 s (3 sondas de readiness × 10 s) los pods salen del balanceo y `api` responde 503. Los pods **no** se reinician. Al volver la base, `api` se recupera sola en menos de 30 s, sin tocar nada en Kubernetes. El portal (`web`) sigue con 100 %, porque es estático.

```powershell
# A
.\k8s\tools\sonda.ps1 -Experimento E4-bd -Segundos 240
# B (a los 30 s)
docker stop ffa-db
# B (a los 120 s)
docker start ffa-db
```

Anotar: segundos sin servicio en `api` (la caída más larga de la sonda), segundos desde `docker start` hasta el primer 200, RESTARTS de los pods.

### E5 · Restaurar un respaldo (D5)

**Hipótesis:** el simulacro restaura todas las tablas con las mismas filas que la base real (no hubo cambios desde el respaldo del inicio), con RLS forzado y permisos intactos, en menos de 5 minutos. Eso deja holgura dentro del RTO de 30 min.

```powershell
.\k8s\tools\restaurar-bd.ps1
docker exec ffa-db dropdb -U postgres feathersforall_simulacro      # limpiar
```

### E6 (opcional) · Carga y escalado

Ya se probó en la S07 ([k8s/README.md](../../../k8s/README.md), paso 5). Para repetirlo con la sonda corriendo:

**Hipótesis:** el HPA escala de 2 hacia 6 réplicas y el p95 de `api` se mantiene bajo 500 ms.

```powershell
kubectl apply -n default -f k8s/tools/carga.yaml
kubectl get hpa ffa-api -n feathersforall -w
kubectl delete -n default -f k8s/tools/carga.yaml
```

## Resultados

Completar durante el game day. Los CSV de la sonda quedan en `$HOME\ffa-gameday`.

Fecha: ____________ Participantes: ______________________________

| Exp. | Hipótesis | Disponibilidad `api` | Disponibilidad `web` | Caída más larga | Recuperación | ¿Se cumplió? | Hallazgo |
|---|---|---|---|---|---|---|---|
| E1 | ≤ 2 errores, pod nuevo < 30 s | | | | | | |
| E2 | 0 errores | | | | | | |
| E3 | Tutor 503, resto 100 %, sin reinicios | | | | | | |
| E4 | Recupera sola < 30 s, sin reinicios | | | | | | |
| E5 | Restaura < 5 min, filas iguales | — | — | — | | | |
| E6 | Escala, p95 < 500 ms | | | | | | |

Si una hipótesis no se cumplió:
1. Escribir el post-mortem con la [plantilla](postmortems/plantilla.md).
2. Pasar las acciones al backlog.
3. Repetir el experimento cuando estén hechas.

## Al terminar

```powershell
kubectl get pods -n feathersforall                  # todo Running
Invoke-RestMethod http://localhost:8088/health      # db: up, llm: up
```
