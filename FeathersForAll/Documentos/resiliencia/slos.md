# SLOs de FeathersForAll

Bajan a números medibles el atributo de disponibilidad de [`arch/atributos-calidad.md`](../arch/atributos-calidad.md) (99,5 % en horario escolar, p95 < 500 ms sin tutor, p95 < 8 s con tutor).

**Ventana:** 30 días corridos, solo en horario escolar: lunes a viernes de 07:30 a 18:00 (hora de Santiago). Fuera de ese horario no hay clases y una caída no se cuenta contra el presupuesto.

## Qué se mide

La API escribe una línea JSON por request (`src/platform/request-context.js`) con `route`, `status`, `duration_ms` y `completed`. Con eso alcanza para medir: no hace falta Prometheus para el piloto.

| SLI | Cómo se calcula | Fuente |
|---|---|---|
| Disponibilidad | requests sin 5xx / requests totales | logs de la API |
| Latencia | p95 de `duration_ms` de las respuestas completas (sin 5xx) | logs de la API |
| Disponibilidad sintética | respuestas 2xx/3xx / mediciones de la sonda, una por segundo, desde fuera del clúster | `k8s/tools/sonda.ps1` |

No cuentan:
- **Las sondas de Kubernetes** (`/livez`, `/readyz`, `/health`): no son tráfico de usuarios.
- **Los 429**: son el tope del tutor o el freno del login funcionando bien. Se informan aparte.
- **Los requests que el cliente cortó** (`completed: false`): no entran en la latencia.

## Objetivos

| # | Servicio | SLO | Por qué este número |
|---|---|---|---|
| S1 | API (cursos, evaluaciones, notas, perfil) | 99,5 % sin 5xx · p95 < 500 ms | Lo que pide el colegio piloto. Una caída en plena evaluación es lo más grave que puede pasar |
| S2 | Login | 99,5 % sin 5xx · p95 < 1 s | Sin login no se usa nada. scrypt cuesta ~100 ms a propósito, así que el umbral es más alto que S1 |
| S3 | Tutor IA | 99 % sin 5xx · p95 < 8 s (respuesta completa) | Depende de Ollama en el PC del equipo, el punto más frágil. Si se cae, el resto sigue: el objetivo es más bajo a propósito |
| S4 | Datos | RPO ≤ 24 h · RTO ≤ 30 min | Respaldo diario y restauración probada ([plan-dr.md](plan-dr.md)) |

## Presupuesto de error

Un mes escolar tiene unos 22 días × 10,5 h = **231 h**. Entonces:

| SLO | Presupuesto mensual |
|---|---|
| 99,5 % (S1, S2) | 0,5 % → **~69 min** de caída total, o el equivalente en requests fallidos |
| 99 % (S3) | 1 % → **~2 h 19 min** |

Política:

| Presupuesto gastado en la ventana | Qué hace el equipo |
|---|---|
| < 50 % | Normal: features y fiabilidad según el backlog |
| 50–100 % | Se revisa qué lo gastó. Lo siguiente del backlog es arreglar esa causa |
| > 100 % | Congelamiento: solo correcciones y mejoras de fiabilidad hasta que la ventana vuelva a estar bajo el 100 %. Se escribe un post-mortem ([postmortems/](postmortems/)) |

## Cómo se revisa

Una vez por semana, el Tech Lead:

```powershell
# SLI de los últimos 7 días (todas las réplicas de la API)
kubectl logs -n feathersforall -l app.kubernetes.io/name=ffa-api --since=168h --tail=-1 | node code/backend/scripts/sli.js
```

Muestra, por clase (`api`, `login`, `tutor`): requests, 5xx, 429, disponibilidad, p95, cuánto presupuesto se gastó y si cumple.

**Límite conocido:** `kubectl logs` solo ve los logs de los pods vivos. Si un pod se reinició, se pierde lo anterior. Para el piloto en la nube los logs van a un almacén central (CloudWatch u otro, ver [managed-services.md](../cloud/managed-services.md)) y el mismo script corre sobre la exportación.

## Alertas (cuando exista el almacén de logs)

Se alerta por **tasa de consumo del presupuesto**, no por cada error:

| Alerta | Condición | Severidad |
|---|---|---|
| Consumo rápido | 5xx > 5 % durante 10 min (a ese ritmo el presupuesto del mes se acaba en ~2 días de clases) | Aviso inmediato al de turno |
| Consumo lento | 5xx > 1 % durante 1 h (se acaba en ~11 días de clases) | Ticket para el día siguiente |
| Datos | El respaldo del día no existe a las 19:00 | Ticket |

Mientras tanto, en el laboratorio la señal es la sonda del [game day](game-day.md) y `/health`.
