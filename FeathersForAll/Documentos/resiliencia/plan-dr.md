# Plan de recuperación ante desastres (DR)

Alcance: el ambiente del laboratorio, que es donde corre hoy el sistema: clúster **kind** de un nodo, **PostgreSQL** en el contenedor `ffa-db` y **Ollama**, todo en el PC del equipo ([ADR 0014](../adr/0014-despliegue-real.md)). Al final está qué cambia en la nube.

## Dónde vive el estado

Lo único que no se puede reconstruir desde el repo son los datos de PostgreSQL. El resto se vuelve a crear.

| Pieza | ¿Tiene estado? | Cómo se recupera |
|---|---|---|
| Pods de la API y del portal | No | Los recrea Kubernetes (Deployment, HPA con mínimo 2, PDB) |
| Manifiestos | En Git | Repo `feathersforall-gitops`; Argo CD los vuelve a aplicar |
| Imágenes | En GHCR, por digest y firmadas | Se descargan de nuevo; si GHCR no responde, el nodo ya las tiene en caché |
| Namespace, cuota y Secrets de Kubernetes | Los crea Terraform | `terraform apply` ([k8s/README.md](../../../k8s/README.md), paso 2) |
| **Base `feathersforall`** | **Sí: cursos, notas, intentos, conversaciones, apuntes y embeddings** | **Respaldo diario ([abajo](#respaldos))** |
| Base `terraform_state` | Sí: el state de Terraform | Va en el mismo respaldo |
| `JWT_SECRET` y claves de la BD | Sí, fuera de Git (`.env` y `TF_VAR_*`) | Si se pierden, se generan nuevos: los usuarios solo vuelven a iniciar sesión |
| Modelos de Ollama | No | `ollama pull qwen2.5:3b` y `ollama pull bge-m3` (~3 GB) |

## Objetivos por escenario

RTO: tiempo hasta volver a dar servicio. RPO: datos que se pueden perder.

| # | Escenario | Qué pasa | Recuperación | RTO | RPO |
|---|---|---|---|---|---|
| D1 | Se cae un pod de la API | La otra réplica sigue atendiendo | Automática: Kubernetes crea otro pod | < 1 min | 0 |
| D2 | Despliegue con un error | La versión nueva falla | `git revert` en el repo gitops; Argo CD vuelve al digest anterior | 15 min | 0 |
| D3 | Ollama caído | El tutor responde 503 con un mensaje claro; el resto de la API sigue (`/readyz` no depende del LLM) | Levantar Ollama ([runbook R3](runbook.md#r3--el-tutor-responde-503)) | 5 min | 0 |
| D4 | PostgreSQL detenido | `/readyz` falla, los pods salen del balanceo y todo responde 503. No se reinician (la liveness no mira la BD) | `docker start ffa-db`; los pods vuelven solos ([R2](runbook.md#r2--la-api-responde-503-en-todo)) | 5 min | 0 |
| D5 | Datos borrados o dañados (error humano, bug, migración mala) | La API funciona pero con datos malos | Restaurar el último respaldo ([procedimiento](#restaurar)) | 30 min | 24 h |
| D6 | Se pierde el volumen de PostgreSQL (Docker Desktop reinstalado, `docker volume rm`) | No hay base | Contenedor nuevo + restaurar con `-Roles` | 1 h | 24 h |
| D7 | Se pierde el clúster kind | No hay pods, Ingress ni Argo CD | Recrear con [k8s/README.md](../../../k8s/README.md) pasos 1–2 y sincronizar Argo CD. Los datos no se tocan: la BD está fuera del clúster | 45 min | 0 |
| D8 | Se pierde el PC (disco, robo) | Se pierde todo lo local, **incluidos los respaldos si están en el mismo disco** | Otro PC: instalar, restaurar desde la copia fuera del PC, recrear el clúster | 1 día | 24 h |
| D9 | Se filtra `JWT_SECRET` | Cualquiera puede firmar tokens | Secreto nuevo, `terraform apply`, `kubectl rollout restart` ([R10](runbook.md#r10--se-filtró-un-secreto)) | 15 min | 0 |

D1, D3, D4 y D5 se prueban en el [game day](game-day.md).

## Respaldos

| | |
|---|---|
| Qué | `feathersforall` y `terraform_state` (formato custom de `pg_dump`) y los roles (`pg_dumpall --roles-only`) |
| Herramienta | [`k8s/tools/respaldo-bd.ps1`](../../../k8s/tools/respaldo-bd.ps1) |
| Cuándo | Todos los días a las 18:30, al terminar la jornada escolar (Tarea programada de Windows) |
| Dónde | Carpeta con fecha en `$HOME\ffa-respaldos`, **más una copia fuera del PC** (regla 3-2-1: 3 copias, 2 medios, 1 fuera) |
| Retención | 14 respaldos |
| Verificación | Cada respaldo pasa por `pg_restore --list` antes de darse por bueno. Una vez al mes, simulacro completo con `restaurar-bd.ps1` |

Los respaldos tienen datos de estudiantes y los hash de las claves de los roles: **nunca van al repo**. Para la copia fuera del PC sirve una carpeta sincronizada de OneDrive o un disco USB: `-Destino` acepta cualquier ruta. Con datos reales de menores, esa copia tiene que estar cifrada ([marco-legal.md](../ia/marco-legal.md)).

Programar el respaldo diario (una vez, en PowerShell, desde la raíz del repo):

```powershell
$script = (Resolve-Path .\k8s\tools\respaldo-bd.ps1).Path
schtasks /Create /TN "FeathersForAll respaldo BD" /SC DAILY /ST 18:30 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$script`""
schtasks /Run /TN "FeathersForAll respaldo BD"          # probarla ahora
dir $HOME\ffa-respaldos                                  # debe aparecer una carpeta con la fecha
```

## Restaurar

**Simulacro** (no toca la base real; se hace una vez al mes y en el game day):

```powershell
.\k8s\tools\restaurar-bd.ps1
```

Restaura el último respaldo en `feathersforall_simulacro` y compara filas con la base real. También revisa que el RLS siga forzado y que `feathersforall_app` tenga sus permisos. Imprime cuánto tardó, que es el RTO medido de la parte de datos.

**Recuperación real (D5):**

1. Avisar al equipo y al colegio: el sistema queda fuera de servicio unos minutos.
2. Sacar la API de servicio para que nadie escriba durante la restauración:
   `kubectl scale deployment/ffa-api -n feathersforall --replicas=0`
3. Hacer un respaldo de la base dañada, por si después hay que sacar algo de ahí: `.\k8s\tools\respaldo-bd.ps1`
4. Elegir el respaldo bueno: `dir $HOME\ffa-respaldos` (el último **antes** del problema, no el del paso 3).
5. Restaurar: `.\k8s\tools\restaurar-bd.ps1 -Respaldo $HOME\ffa-respaldos\<fecha> -Base feathersforall -Reemplazar`
6. Volver a levantar la API: `kubectl scale deployment/ffa-api -n feathersforall --replicas=2`
   Check: `Invoke-RestMethod http://localhost:8088/health` responde `db: up`.
7. Contar qué se perdió (lo escrito entre el respaldo y el incidente) y avisar a los docentes afectados.
8. Escribir el post-mortem.

**Volumen perdido (D6):** levantar un contenedor nuevo con el mismo nombre y puerto ([k8s/README.md](../../../k8s/README.md), prerrequisitos). Luego restaurar con `-Base feathersforall -Reemplazar -Roles`: el contenedor nuevo trae su base demo, y `-Roles` recupera `feathersforall_app` con su clave.

## En la nube (piloto con colegios reales)

El plan de arriba sirve para el laboratorio. Con datos reales, el respaldo manual en el PC no alcanza:

| Hoy (laboratorio) | En la nube |
|---|---|
| `pg_dump` diario: RPO 24 h | PostgreSQL gestionado con recuperación a un punto en el tiempo (PITR): RPO de minutos |
| Un contenedor: si se cae, se cae | Multi-AZ con failover automático cuando haya más de un colegio |
| Un nodo kind | 2 nodos o más, en zonas distintas |
| Copia fuera del PC a mano | Copia de los snapshots a otra región |
| Ollama en el PC | Ollama en un nodo con GPU, o un LLM por API (ver [costos](../finops/costos.md)) |

El costo de cada opción está en [finops/costos.md](../finops/costos.md).
