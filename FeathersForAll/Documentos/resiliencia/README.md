# Resiliencia y recuperación

| Documento | Para qué |
|---|---|
| [slos.md](slos.md) | Objetivos de disponibilidad y latencia, presupuesto de error y cómo se miden |
| [plan-dr.md](plan-dr.md) | Dónde vive el estado, RTO/RPO por escenario, respaldos y cómo restaurar |
| [game-day.md](game-day.md) | Guion para romper el sistema a propósito y comprobar el plan |
| [runbook.md](runbook.md) | Qué hacer ante cada falla conocida |
| [postmortems/](postmortems/) | Incidentes analizados y la plantilla |

Herramientas (en `k8s/tools/` y `code/backend/scripts/`):

| Archivo | Qué hace |
|---|---|
| `respaldo-bd.ps1` | Respaldo de PostgreSQL verificado, con rotación |
| `restaurar-bd.ps1` | Simulacro de restauración (por defecto) o recuperación real |
| `sonda.ps1` | Mide disponibilidad y latencia desde fuera durante el game day |
| `sli.js` | Calcula los SLI desde los logs de la API |

## Qué protege a qué

| Falla | Protección que ya existe | Dónde |
|---|---|---|
| Se cae un pod | Mínimo 2 réplicas (HPA), PDB, readiness/liveness separadas | `k8s/hpa.yaml`, `pdb.yaml`, `deployment.yaml` |
| Despliegue | Rolling update sin bajar capacidad (`maxUnavailable: 0`), cierre ordenado de 10 s, rollback por Git | `deployment.yaml`, `src/server.js`, Argo CD |
| Cae Ollama | El tutor responde 503 y el resto sigue; `/readyz` no depende del LLM; corte por inactividad | `src/app.js`, [ADR 0013](../adr/0013-tutor-sincrono-en-el-monolito.md) |
| Cae PostgreSQL | Los pods salen del balanceo sin reiniciarse y vuelven solos | `/readyz` en `src/app.js` |
| Sobrecarga | HPA 2–6, topes del tutor por estudiante, freno del login | `hpa.yaml`, `src/platform/rate-limiter.js`, `login-limiter.js` |
| Pérdida de datos | Respaldo diario verificado y restauración probada | `k8s/tools/respaldo-bd.ps1`, `restaurar-bd.ps1` |

## Límites conocidos

- **Un solo nodo:** si se cae el PC, se cae todo. Es el principal límite del laboratorio; en la nube se resuelve con nodos en varias zonas ([plan-dr.md](plan-dr.md#en-la-nube-piloto-con-colegios-reales)).
- **Un solo Ollama:** escalar la API no da más capacidad al tutor.
- **Topes en memoria de cada pod:** con varias réplicas, cada una cuenta por separado.
