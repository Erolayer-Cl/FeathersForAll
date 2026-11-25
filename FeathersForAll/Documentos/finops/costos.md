# FinOps: costos de FeathersForAll

Cuánto cuesta hoy, cuánto costaría el piloto en la nube y qué se hace para que el costo no se dispare. Precios en USD, consultados el 25-11-2026 ([fuentes](#fuentes)).

## 1. Hoy: laboratorio

| Pieza | Dónde corre | Costo |
|---|---|---|
| Kubernetes (kind), API, portal | PC del equipo, Docker Desktop | 0 |
| PostgreSQL + pgvector | Contenedor `ffa-db` en el PC | 0 |
| LLM y embeddings (Ollama) | PC del equipo | 0 |
| Portal público | Vercel Hobby | 0 (solo uso no comercial) |
| CI/CD, imágenes | GitHub Actions + GHCR (repo y paquetes públicos) | 0 |
| Argo CD, Kyverno, Falco | Dentro de kind | 0 |

El costo real es el PC encendido (electricidad, ~3,4 GB de RAM ocupados por el modelo mientras está cargado) y las horas del equipo. Es el punto de partida correcto para un proyecto de curso. Para un colegio real no sirve: no hay alta disponibilidad, y Vercel Hobby no permite uso comercial.

## 2. Qué consume

Lo que se reserva en el clúster, tomado de los manifiestos:

| Componente | Requests | Límites | Réplicas |
|---|---|---|---|
| `ffa-api` | 100m CPU / 128 Mi | 500m / 256 Mi | 2–6 (HPA al 65 % de CPU) |
| `ffa-web` | 20m / 32 Mi | 200m / 64 Mi | 2 |
| Purga diaria | 20m / 64 Mi | 200m / 128 Mi | 1 job al día |
| **Cuota del namespace** | **2 CPU / 2 Gi** | **6 CPU / 4 Gi** | 30 pods |

Con 6 réplicas, la API pide 600m de CPU. La aplicación cabe holgada en **2 nodos chicos**. Lo caro no es la aplicación: es el **LLM**.

## 3. Piloto en AWS: 1 colegio (~500 estudiantes)

Región São Paulo (`sa-east-1`), la más cercana con precios publicados. La región de Chile está en acceso anticipado para algunos clientes, sin precios públicos todavía. Cuando esté disponible conviene evaluarla: deja los datos de menores en el país ([marco-legal.md](../ia/marco-legal.md)).

| Pieza | Elección | USD/mes |
|---|---|---|
| Plano de control EKS | Soporte estándar, $0,10/h | 73 |
| Nodos | 2 × t3.medium (2 vCPU, 4 GiB), $0,0672/h c/u | 98 |
| PostgreSQL | RDS db.t4g.medium Single-AZ (pgvector incluido) | 100 |
| NAT Gateway | $0,093/h, más $0,093/GB procesado | 68 |
| Load balancer | ALB: $0,0225/h en us-east-1 más LCU; en São Paulo es mayor | ≥ 16 |
| Portal | Vercel Pro, 1 asiento | 20 |
| **LLM**, opción A | API (Claude Haiku 5.5), ~10.000 preguntas/mes ([cálculo](#4-el-llm-api-o-gpu-propia)) | 4 |
| **LLM**, opción B | GPU propia g4dn.xlarge (NVIDIA T4), $0,894/h, solo en horario escolar (242 h) | 216 |

No están en la tabla: almacenamiento (EBS, snapshots de RDS), transferencia de datos y logs. Para el piloto son montos chicos, pero se agregan en la calculadora de AWS antes de pedir presupuesto.

| Escenario | USD/mes | Por estudiante |
|---|---|---|
| A: EKS + RDS + LLM por API | **~379** | ~0,76 |
| B: EKS + RDS + GPU en horario escolar | ~591 | ~1,18 |
| B con la GPU encendida 24/7 | ~1.028 | ~2,06 |
| Mínimo: 1 VM t3.large con k3s + RDS db.t4g.small + LLM por API, sin NAT ni ALB | ~172 | ~0,34 |

**Lectura:**
- El **plano de control y la red** (EKS + NAT + ALB ≈ 157) cuestan más que la aplicación. Para un solo colegio, EKS está sobredimensionado. El escenario mínimo cuesta menos de la mitad, a cambio de perder la alta disponibilidad (un solo nodo, como hoy).
- Recomendación para el piloto: **mínimo** mientras sea un colegio. Pasar a **A** desde el segundo colegio, cuando una caída afecta a más gente y el costo fijo se reparte.
- **B 24/7 no tiene sentido:** la GPU estaría apagada en la práctica 2/3 del tiempo. Si se elige GPU propia, se enciende solo en horario escolar (escalado programado del grupo de nodos): ahorra ~437 al mes.

## 4. El LLM: API o GPU propia

Supuesto por pregunta, a validar con los contadores de tokens que devuelve el modelo:
- **Entrada:** ~2.000 tokens (instrucciones, 4 fragmentos de apuntes de 800 caracteres, historial y pregunta).
- **Salida:** ~300 tokens.

| | Costo por pregunta | 10.000 preguntas | 100.000 preguntas |
|---|---|---|---|
| Claude Haiku 5.5 ($0,10 por millón de tokens de entrada, $0,50 por millón de salida) | 2.000 × 0,10/10⁶ + 300 × 0,50/10⁶ = **$0,00035** | $3,5 | $35 |
| GPU g4dn.xlarge en horario escolar | costo fijo | $216 | $216 |

La API es más barata hasta ~600.000 preguntas al mes (216 / 0,00035): unas 1.200 por estudiante en un colegio de 500. Ningún colegio llega a eso. La GPU propia solo se justifica por **privacidad**, si el colegio o la ley exigen que las preguntas no salgan de nuestra infraestructura. Con API, las preguntas pasan por los guardrails, que quitan datos personales antes de enviarlas ([ADR 0012](../adr/0012-ia-responsable.md)).

### El riesgo: el costo sin techo

Los topes del tutor (10 por minuto, 100 por hora y 2 a la vez por estudiante) frenan el abuso, pero **no ponen techo al mes**. En el peor caso:

> 500 estudiantes × 100 preguntas/h × 10,5 h × 22 días = 11,55 millones de preguntas → **~$4.000/mes** con API.

Por eso, antes de usar un LLM por API hay que agregar:
1. **Tope diario por estudiante:** por ejemplo 50 preguntas al día. El peor caso baja a 550.000 preguntas, ~$190/mes.
2. **Presupuesto por colegio** con alerta al 50 %, 80 % y 100 % (AWS Budgets, o la consola del proveedor del LLM).

## 5. Lo que ya ahorra (implementado)

| Palanca | Efecto | Dónde |
|---|---|---|
| Techo del HPA en 6 réplicas | Limita el costo de cómputo y las conexiones a la BD (6 × 10 = 60) | `k8s/hpa.yaml` |
| Cuota del namespace | Nadie puede pedir más de 2 CPU / 2 Gi reservados | `terraform/main.tf` |
| Requests y límites en todos los pods | El scheduler empaqueta bien; ningún pod se come el nodo | `k8s/deployment.yaml` |
| Modelo de 3B parámetros, local | Corre en CPU, sin GPU ni API | `k8s/configmap.yaml` |
| Contexto acotado (4 fragmentos de 800 caracteres, ventana de 4.096 tokens) | Menos tokens por pregunta: más rápido localmente y más barato con API | `RAG_TOP_K`, `RAG_CHUNK_CHARS`, `LLM_NUM_CTX` |
| Topes del tutor por estudiante | Frenan el abuso del recurso más caro | `src/platform/rate-limiter.js` |
| Respuestas básicas sin LLM (saludos, aritmética) | Esas preguntas no gastan LLM | tutor v1.7 |
| Purga anual de conversaciones | La base no crece sin fin | `k8s/cronjob-purga.yaml` |
| Imágenes distroless (< 200 MB) | Menos almacenamiento y despliegues más rápidos | `code/backend/Dockerfile` |

`LLM_KEEP_ALIVE=30m` es un trade-off consciente: ocupa ~3,4 GB de RAM a cambio de no pagar ~19 s de carga en la primera pregunta.

## 6. Lo que falta (propuesto)

| Palanca | Ahorro esperado | Cuándo |
|---|---|---|
| Tope diario por estudiante y presupuesto por colegio | Pone techo al costo del LLM | Antes de usar un LLM por API |
| GPU solo en horario escolar | ~437 USD/mes frente a 24/7 | Si se elige GPU propia |
| Instancias reservadas (1 año) para RDS | db.t4g.medium en São Paulo: de ~100 a ~57 USD/mes | Con 3 meses de uso estable |
| Prompt caching del proveedor | Hasta 90 % en la parte fija del prompt (instrucciones) | Con LLM por API |
| Etiquetas de costo (`app.kubernetes.io/part-of`, ambiente) en todos los recursos de AWS | Saber qué cuesta cada ambiente | Desde el primer `terraform apply` en AWS |

## 7. Costo por colegio (showback)

La infraestructura es compartida (multi-tenant), así que no se puede etiquetar por colegio. Lo que sí varía por colegio es el uso del tutor, y eso queda en la base. Preguntas por colegio y mes, con el costo estimado a precio de API:

```powershell
docker exec ffa-db psql -U postgres -d feathersforall -c "SELECT c.nombre AS colegio, to_char(date_trunc('month', m.created_at), 'YYYY-MM') AS mes, count(*) AS preguntas, round(count(*) * 0.00035, 2) AS usd_estimado FROM mensajes_tutor m JOIN colegios c ON c.id = m.colegio_id WHERE m.rol = 'user' GROUP BY 1, 2 ORDER BY 2 DESC, 3 DESC;"
```

Corre como `postgres` porque necesita ver todos los colegios; la API no puede (RLS). Solo cuenta el tutor con conversaciones guardadas (portal del estudiante). El chat de desarrollo `/v1/dev/chat` no guarda nada.

## 8. Cómo se opera

| Cada | Qué | Quién |
|---|---|---|
| Semana | Revisar SLOs y uso del tutor ([slos.md](../resiliencia/slos.md)) | Tech Lead |
| Mes | Factura frente a esta estimación; showback por colegio; ajustar topes si hace falta | Tech Lead + DevSecOps |
| Trimestre | Decidir reservas o cambio de escenario (mínimo → A) según el uso real | Equipo |

## Fuentes

Consultadas el 25-11-2026:
- **EKS:** [aws.amazon.com/eks/pricing](https://aws.amazon.com/eks/pricing/). $0,10 por clúster por hora en soporte estándar; $0,60 en soporte extendido. Hay que mantener la versión de Kubernetes al día.
- **EC2 en sa-east-1:** t3.medium $0,0672/h y g4dn.xlarge $0,894/h, de [doit.com](https://www.doit.com/compute/spot/sa-east-1/t3.medium) (precios on-demand de AWS).
- **RDS PostgreSQL en sa-east-1:** db.t4g.medium ~$100/mes on-demand, ~$57 con reserva de 1 año; db.t4g.small ~$50. Fuente: [bytebase.com/dbcost](https://www.bytebase.com/dbcost/rds/instance/db.t4g.medium/).
- **NAT Gateway en sa-east-1:** $0,093/h y $0,093/GB, de [costgoat.com](https://costgoat.com/pricing/aws-nat-gateway).
- **ALB:** $0,0225/h en us-east-1, de [aws.amazon.com/elasticloadbalancing/pricing](https://aws.amazon.com/elasticloadbalancing/pricing/).
- **Vercel:** Pro a $20 por usuario al mes; Hobby solo para uso no comercial. [vercel.com/pricing](https://vercel.com/pricing).
- **Claude Haiku 5.5:** $0,10 / $0,50 por millón de tokens (prompts de hasta 100K). [anthropic.com/claude/haiku](https://anthropic.com/claude/haiku).
- **Región de AWS en Chile:** en acceso anticipado para clientes seleccionados. [aboutamazon.com](https://www.aboutamazon.com/news/aws/aws-south-america-chile-region-launch).

Los precios cambian: antes de presentar un presupuesto formal, se rehace la tabla de la sección 3 en la [calculadora de AWS](https://calculator.aws/).
