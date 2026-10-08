# ADR 0004 · Datos y eventos: PostgreSQL + pgvector con RLS, SQS y Outbox

## Estado

Propuesto — 2026-10-07. Pendiente de ratificar en la reunión del equipo y en la presentación del Hito parcial 1 (inicio de S07).

## Contexto

S06 pide elegir motores de persistencia y broker, y decidir qué patrones de datos aplicar. Fuerzas en juego:

- **Multi-tenant con datos de menores:** el aislamiento por colegio es el atributo de calidad n.º 1 (0 fugas). ADR 0002 D1 fijó esquema compartido + `colegio_id` + RLS.
- **Tutor IA con RAG:** necesita búsqueda semántica sobre los apuntes de cada curso, siempre filtrada por colegio y curso.
- **Flujo asíncrono del tutor:** el contrato S05 responde `202` y el ADR 0003 ya eligió AWS SQS para el worker.
- **Equipo de 6 personas, MVP, piloto pequeño:** cada motor extra es un servicio más que operar y pagar.
- **Esquema del equipo:** la BDD 3FN inicial tenía FKs que permitían mezclar colegios, roles, preguntas y alternativas. El equipo la reescribió en `code/backend/db/01_schema.sql` (detalle en `code/backend/db/CAMBIOS_SCHEMA.md`). Al contrastarla con el contrato S05 y este ADR faltaban algunas piezas, que se agregan en `02_s06_ajustes.sql`.

## Decisión

### 1. Persistencia

| Necesidad | Motor | Por qué |
|---|---|---|
| Estado transaccional (colegios, usuarios, cursos, evaluaciones, intentos, consultas) | **PostgreSQL 16** (Render) | ACID, integridad referencial, RLS para el aislamiento por colegio. Regla del taller: empezar por PostgreSQL. |
| Embeddings de apuntes (RAG) | **pgvector** en el mismo PostgreSQL (`vector(768)`, índice HNSW coseno) | Búsqueda vectorial con el mismo `colegio_id`, la misma RLS y la misma transacción; sin un servicio más. 768 = `nomic-embed-text` (Ollama). |
| Archivos (PDF de apuntes) | Fuera de la BD (almacenamiento de objetos, a definir en S07) | La BD guarda el texto extraído en `apuntes_curso.contenido`, que es lo que usa el RAG. |

### 2. Aislamiento por colegio (en la base, no solo en la API)

- `colegio_id` en todas las tablas de un colegio, con **FKs compuestas** `(x_id, colegio_id) → padre(id, colegio_id)`.
- **Rol en la FK** (columnas generadas `docente_rol` / `estudiante_rol`): un estudiante no puede ser docente de un curso.
- Rendir y consultar al tutor exige **matrícula** (FK a `matriculas(curso_id, estudiante_id)`).
- **RLS fail-closed** con `ENABLE` + `FORCE`: sin `SET LOCAL app.colegio_id` la API no ve ninguna fila. La variable se llama `app.colegio_id` (reemplaza la mención `app.tenant_id` del ADR 0002).
- Roles de BD: `feathersforall_app` (API, sin BYPASSRLS) y `feathersforall_plataforma` (BYPASSRLS: master, relay de la outbox, jobs).

### 3. Broker y eventos

- **AWS SQS** (ADR 0003) entre la API y el worker.
- Entrega **at-least-once**: todo consumidor es idempotente por `event_id` (= `outbox_eventos.id`).
- Catálogo de 14 eventos en `Documentos/data/event-catalog.md`; contextos en `Documentos/data/bounded-contexts.md`.

### 4. Patrones

| Patrón | ¿Se aplica? | Motivo |
|---|---|---|
| **Outbox** | **Sí** | Guardar el cambio y publicar en SQS no es atómico. El evento se inserta en `outbox_eventos` en la misma transacción; un relay en el worker (rol plataforma) lo publica con `FOR UPDATE SKIP LOCKED`. |
| **Idempotencia** | **Sí** | `claves_idempotencia` para la `Idempotency-Key` del contrato S05 (24 h); `event_id` para los consumidores. |
| **CQRS** | **Liviano** | El puntaje se guarda al enviar el intento y el dashboard lee con consultas agregadas; sin modelo de lectura separado ni proyecciones. |
| **Event Sourcing** | No | No necesitamos reconstruir estado ni time-travel; la outbox ya deja trazabilidad. |
| **Saga** | No | Todo el estado vive en un solo PostgreSQL: no hay transacciones entre servicios. |
| **Change Data Capture** | No | La outbox cubre el caso con menos piezas (sin Debezium). |

### 5. Excepción consciente a la 3FN: corrección congelada

`respuestas_estudiante.es_correcta`, `respuestas_estudiante.retroalimentacion` e `intentos_evaluacion.puntaje` se pueden derivar de otras tablas, pero **se guardan a propósito** al momento del envío: si el docente cambia después la alternativa correcta o el feedback, la nota ya entregada no cambia sola. Recorregir es una acción explícita.

### 6. Ajustes de S06 sobre el esquema del equipo (`02_s06_ajustes.sql`)

| Falta detectada | Ajuste |
|---|---|
| El contrato S05 crea la consulta al tutor "en cola" (202), pero `respuesta` era NOT NULL | `estado` (`en_cola`, `respondida`, `fallida`), `respuesta` opcional, `con_respaldo`, `respondida_at` y CHECK de coherencia |
| El contrato devuelve las fuentes de la respuesta | Tabla `consultas_fuentes` (el apunte citado siempre es del mismo curso, por FK) |
| El contrato exige `period` del curso | `cursos.periodo` (formato `AAAA-S1/S2`) y `cursos.asignatura` |
| H2: el docente define el feedback por pregunta, pero no había dónde escribirlo | `preguntas.retroalimentacion` (se copia, congelada, a la respuesta) |
| Outbox e Idempotency-Key no existían | `outbox_eventos` y `claves_idempotencia`, con RLS |
| Con RLS en `colegios`, la API no podía resolver el colegio antes del login | Función `colegio_por_rbd()` `SECURITY DEFINER`, dueña `feathersforall_plataforma`; devuelve solo el id |
| Cada INSERT repetía el colegio | `colegio_id DEFAULT app_colegio_id()` (sigue siendo fail-closed) |

Verificado en PostgreSQL 16 + pgvector: `98_test_s06_ajustes.sql` (23 pruebas), las 43 consultas de `queries.js` compilan, y el flujo H1→H5 corre completo con el rol de la API bajo RLS.

## Consecuencias

**Gana:**

- Un solo motor que operar (PostgreSQL en Render) para estado, vectores, outbox e idempotencia.
- El aislamiento entre colegios lo garantiza la base: un error de la API devuelve vacío, no datos de otro colegio.
- Eventos confiables: nunca se publica algo que no se guardó, ni se guarda algo que no se publica.

**Pierde / se vuelve más difícil:**

- Esquema más largo: FKs compuestas, columnas de rol generadas y `UNIQUE (id, …)` extra.
- Toda consulta debe ir dentro de una transacción con `SET LOCAL app.colegio_id`; la API no puede usar un rol con BYPASSRLS.
- Login en dos pasos (colegio por RBD, luego usuario por email).
- Hay que operar el relay de la outbox y los jobs de limpieza (idempotencia y retención de consultas al tutor).
- `RESTRICT` entre entidades independientes: no se borra, se desactiva (`activo = false`).

## Alternativas descartadas

- **Base vectorial dedicada (Pinecone, Qdrant):** otro servicio, otra factura y otro lugar donde aplicar el aislamiento por colegio.
- **Redis para cache o sesiones:** el backend es stateless con JWT y el volumen del piloto no lo justifica. Se reevalúa con métricas de los picos de pruebas.
- **MongoDB u otro documental (por ejemplo, exámenes en JSON):** el dominio es relacional (curso → evaluación → pregunta → alternativa) y necesita integridad referencial; se perderían las FKs compuestas y la RLS por tabla.
- **Kafka o RabbitMQ:** sobredimensionados para el piloto; SQS ya está decidido (ADR 0003).
- **Email único global:** se prefirió único por colegio (un docente puede trabajar en dos colegios) a cambio del login en dos pasos.

## Decisiones a confirmar

- Dimensión `vector(768)` según el modelo de embeddings final.
- Escala de puntaje 0–100 (o nota 1.0–7.0).
- Plazo de retención de `consultas_tutor_ia` (datos de menores).
- Almacenamiento de archivos (S3 u otro) en S07.

## Fecha

2026-10-07

## Autores

Equipo AulaViva (esquema: equipo; ajustes S06 y redacción: Tech Lead)
