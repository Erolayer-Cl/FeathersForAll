# Falco: detección en runtime (S10)

Kyverno decide qué entra al clúster (`k8s/policies/`). Falco mira lo que pasa después, con el contenedor ya corriendo. Decisión: [ADR 0011](../FeathersForAll/Documentos/adr/0011-supply-chain.md).

| Archivo | Qué es |
|---|---|
| `rules-custom.yaml` | Las 3 reglas propias de FeathersForAll |
| `values.yaml` | Valores del chart de Helm para el clúster kind |

## Las 3 reglas

| # | Regla | Qué detecta | Por qué importa aquí |
|---|---|---|---|
| 1 | FFA proceso inesperado en un contenedor de la app | Algo distinto de `node` en la API, o una shell con terminal en el frontend | La API es distroless: no existe un uso legítimo. Es la señal más clara de compromiso |
| 2 | FFA conexión saliente inesperada desde la API | Conexión a un puerto que no es DNS, PostgreSQL ni Ollama | La base tiene notas y conversaciones de menores. Es el camino de salida de esos datos |
| 3 | FFA lectura del entorno de un proceso en la API | Apertura de `/proc/<pid>/environ` | Ahí están `JWT_SECRET` y `DATABASE_URL`. Con el primero se firma un token de cualquier colegio y rol |

Las tres son `CRITICAL`. La 2 usa la misma lista de puertos que `k8s/networkpolicy.yaml`: la NetworkPolicy bloquea, Falco avisa que alguien lo intentó.

## Ruta de alerta

Regla del taller: una alerta High no es un log más, es un incidente.

```text
Falco (DaemonSet) ──▶ Falcosidekick ──▶ canal de alertas del equipo (webhook)
                                          │  prioridad error o superior
                                          ▼
                              DevSecOps la toma (respaldo: Tech Lead)
                                          ▼
                 issue con etiqueta "incidente" + registro en Documentos/seguridad/vulnerabilidades.md
```

| Prioridad | Qué se hace | Plazo |
|---|---|---|
| Critical (las 3 reglas propias) | Se abre un incidente y se contiene: `kubectl scale deploy/ffa-api --replicas=0` o borrar el pod afectado. Si fue la regla 3, se rotan `JWT_SECRET` y la clave de `feathersforall_app` (Terraform) | Aviso inmediato, primera respuesta en 1 hora |
| Error / Warning de las reglas por defecto | Se revisa en el día. Si es real, sube a incidente; si es ruido, se ajusta la regla por PR | 1 día hábil |
| Notice o menor | Queda en los logs de Falco | Sin aviso |

Falta que el equipo defina el canal (el `values.yaml` asume un webhook de Discord; Falcosidekick también habla con Slack y Teams) y quién cubre cuando DevSecOps no está.

## Instalar en el clúster kind

```powershell
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update
helm install falco falcosecurity/falco --namespace falco --create-namespace `
  -f falco/values.yaml `
  --set-file "customRules.rules-custom\.yaml=falco/rules-custom.yaml" `
  --set falcosidekick.config.discord.webhookurl=$env:FALCO_WEBHOOK_URL
kubectl rollout status daemonset/falco -n falco
```

Si cambian las reglas: el mismo comando con `helm upgrade` en vez de `helm install`.

## Probar cada regla

En una terminal, las alertas:

```powershell
kubectl logs -n falco daemonset/falco -c falco -f | Select-String "FeathersForAll"
```

En otra, los disparadores:

```powershell
# Regla 1: shell interactiva en el frontend
kubectl exec -it -n feathersforall deploy/ffa-web -- sh

# Regla 2: la API intenta salir a internet (la NetworkPolicy lo corta, Falco igual lo ve)
kubectl exec -n feathersforall deploy/ffa-api -- /nodejs/bin/node -e "fetch('https://example.com').catch(()=>{})"

# Regla 3: lectura de las variables de entorno
kubectl exec -n feathersforall deploy/ffa-api -- /nodejs/bin/node -e "require('fs').readFileSync('/proc/self/environ')"
```

Cada comando debe producir una línea `Critical` con el pod y el proceso. Esa salida es la evidencia del entregable.

## Validar las reglas sin clúster

Es lo que hace el job `iac-scan` de `ci.yml`:

```bash
docker run --rm -v "$PWD/falco:/reglas:ro" --entrypoint /usr/bin/falco falcosecurity/falco:0.45.1 -V /reglas/rules-custom.yaml
```
