# Auditoría · Tiempo de respuesta y base de datos

- **Fecha:** 2026-10-23
- **Alcance:** latencia de la API y del tutor IA, consultas y configuración de PostgreSQL. No cubre seguridad ni calidad de código.
- **Rama:** `Ignacio` (con las conversaciones guardadas del tutor, ADR 0008).
- **Resultado:** 9 hallazgos (2 altos, 4 medios, 3 bajos). Se corrigieron 4 de bajo riesgo; el resto queda como propuesta para el equipo. Dos hipótesis iniciales se descartaron con datos.

## Resumen

La **base de datos no es el problema**. Con un volumen de 22 colegios, 6 000 estudiantes y 96 000 fragmentos de apuntes, casi todos los endpoints responden en menos de 12 ms, y la búsqueda de apuntes del tutor tarda unos 5 ms con recall del 100 %.

**El tiempo de respuesta lo domina el LLM en CPU.** La primera palabra del tutor tarda entre 1 y 9 s con el modelo cargado, y 19 s si Ollama lo había descargado. Ollama atiende una pregunta a la vez: con 4 estudiantes simultáneos, el último espera más de 20 s.

## Dónde está la base de datos

| Qué | Dónde |
|---|---|
| Esquema, permisos, seed y consultas | `code/backend/db/` (`01`–`05`, `permisos_app.sql`, `90_seed_demo.sql`, `queries.js`) |
| Datos | Volumen Docker `feathersforall_pgdata` → `/var/lib/docker/volumes/feathersforall_pgdata/_data` |
| Servidor | Contenedor `feathersforall-db-1` (`pgvector/pgvector:0.8.7-pg16`), solo en `127.0.0.1:5432`, definido en `code/backend/compose.yaml` |

## Cómo se hizo

- **Equipo:** AMD Ryzen (Renoir/Cezanne) de 16 hilos, 15 GiB de RAM y GPU integrada. Ollama 0.40.8 corre al 100 % en CPU (`qwen2.5:3b` + `bge-m3`).
- **PostgreSQL 16.15 + pgvector 0.8.7** con la configuración por defecto del contenedor (`shared_buffers` 128 MB, `work_mem` 4 MB, `maintenance_work_mem` 64 MB).
- **Dos bases:**
  - **demo:** la de desarrollo (2 colegios, 9 usuarios).
  - **volumen:** una base temporal con el esquema `01`–`05`, el seed y datos sintéticos: 22 colegios, 6 005 estudiantes, 303 cursos de 160 estudiantes cada uno, 48 009 matrículas, 288 010 intentos de evaluación, 96 000 fragmentos de apuntes (1,46 GB en total) y 5 000 conversaciones con 30 000 mensajes. Los vectores se generaron por asignatura: un mismo ramo en distintos colegios tiene apuntes parecidos, el peor caso para la búsqueda con filtro. La base se borró al terminar.
- **Herramientas:** una segunda instancia de la API apuntando a la base de volumen; `EXPLAIN (ANALYZE, BUFFERS)` y `auto_explain` ejecutados como el rol de la API, con RLS; `autocannon` para carga concurrente; y los tiempos internos de Ollama.
- Todo se midió con la API real y el JWT de cada rol (estudiante, docente y admin).

## Mediciones

### Endpoints sin LLM (40 peticiones secuenciales, ms)

| Endpoint | demo p50 | demo p95 | volumen p50 | volumen p95 |
|---|---|---|---|---|
| `GET /v1/me` | 5,0 | 5,5 | 4,7 | 5,1 |
| `GET /v1/courses` (estudiante) | 6,4 | 8,3 | 8,9 | 9,9 |
| `GET /v1/courses` (admin, 15 cursos) | 6,4 | 7,8 | 10,3 | 11,7 |
| `GET /v1/me/grades` | 7,5 | 8,7 | 8,6 | 9,5 |
| `GET /v1/me/grades/{evaluación}` | 6,9 | 7,5 | 6,6 | 7,3 |
| `GET .../gradebook` (docente) | 8,7 | 9,6 | 39,6 | 43,7 |
| `GET .../grades/summary` (docente) | 10,7 | 12,0 | 62,5 | 65,0 |
| `GET /v1/assessments/{id}/results` (docente) | 10,5 | 12,7 | 19,0 | 20,5 |
| `GET .../tutor-conversations` | 6,1 | 6,6 | 5,8 | 6,7 |
| `POST /v1/auth/login` | 260,8 | 268,8 | — | — |

### Carga concurrente (base de volumen, 12 s por prueba)

| Endpoint | Conexiones | req/s | p50 | p99 | Errores |
|---|---|---|---|---|---|
| `GET /v1/me/grades` | 10 / 50 | 882 / 1 506 | 11 / 32 ms | 20 / 44 ms | 0 |
| `GET /v1/courses` | 10 / 50 | 1 790 / 1 743 | 5 / 28 ms | 9 / 34 ms | 0 |
| `GET .../tutor-conversations` | 10 / 50 | 3 337 / 3 324 | 2 / 14 ms | 5 / 19 ms | 0 |
| `GET .../gradebook` (160 estudiantes) | 10 / 50 | 233 / 228 | 42 / 219 ms | 61 / 245 ms | 0 |

### Login (scrypt N=2^14, r=8, p=5)

| Simultáneos | `UV_THREADPOOL_SIZE` | logins/s | p50 | p99 |
|---|---|---|---|---|
| 1 | 4 (por defecto) | 3,9 | 257 ms | 285 ms |
| 16 | 4 (por defecto) | 16–25 | 635–1 029 ms | 1 191–1 590 ms |
| 16 | 8 | 33,6 | 518 ms | 696 ms |
| 16 | 16 | 40,1 | 404 ms | 606 ms |

Una ráfaga de 16 logins **no** frena al resto de la API: `GET /v1/me/grades` mantuvo p99 de 5–7 ms durante la ráfaga.

### Tutor IA

| Turno | Primera palabra | Total |
|---|---|---|
| Con apuntes, modelos descargados (frío) | 18,8–19,0 s | 20,5–23,1 s |
| Con apuntes, modelo cargado y prompt en caché | 0,15–0,2 s | 1,8–2,0 s |
| Con apuntes, modelo cargado, otros fragmentos | 2,6–6,9 s | 3,9–8,4 s |
| Charla ("hola") | 0,08–2,3 s | 2,0–8,7 s |
| Fuera de los apuntes (sin LLM) | 42–53 ms | igual |
| Curso sin apuntes (sin LLM) | 6–7 ms | igual |
| 4 estudiantes a la vez (el último) | 21–24 s | 23–26 s |

**Desglose de un turno con apuntes**, según la nueva línea de log `tutor`:

| Fase | Tiempo |
|---|---|
| ¿El curso tiene apuntes? (`has_notes_ms`) | 2–3 ms |
| Embedding de la pregunta con bge-m3 (`embed_ms`) | 44–99 ms (hasta 234 ms con concurrencia) |
| Búsqueda en pgvector (`search_ms`) | 3–8 ms |
| Procesar el prompt (743–1 098 tokens) | **2,8–9,4 s** si no está en caché · ~70 ms si lo está (≈86 tokens/s) |
| Generar la respuesta (18–49 tokens) | 1,3–3,5 s (≈13 tokens/s) |
| Guardar la conversación | pocos ms |

### Búsqueda de apuntes (pgvector)

Consulta exacta de `pg-vector-store.js#search`, ejecutada como la API para 40 cursos al azar:

| Variante | p50 | p95 | Fragmentos | Recall@4 |
|---|---|---|---|---|
| Actual | 5,1 ms | 5,5 ms | 4/4 en los 40 cursos | 100 % |
| `hnsw.ef_search = 200` | 5,1 ms | 5,6 ms | 4/4 | 100 % |
| `hnsw.iterative_scan = relaxed_order` | 5,0 ms | 5,3 ms | 4/4 | 100 % |
| Exacta (sin índices de orden) | 5,5 ms | 6,0 ms | 4/4 | 100 % |
| Curso con 6 300 fragmentos | 20–25 ms | — | 4/4 | 100 % |

El planificador **nunca usa el índice HNSW**: filtra por `idx_embeddings_curso` (las filas de un curso) y ordena exacto. Por eso no hay pérdida de recall.

## Hallazgos

### Alta

| # | Hallazgo | Evidencia | Estado |
|---|---|---|---|
| A1 | **El tutor depende de un LLM en CPU.** La primera palabra tarda 1–9 s con el modelo cargado; procesar el prompt es el 80–90 % de esa espera. Ollama atiende de a una pregunta (`OLLAMA_NUM_PARALLEL=1`): la capacidad es de unas 10–20 respuestas por minuto por servidor. | Tablas del tutor; log de Ollama (`prompt eval` 11,5 ms/token, `eval` 77 ms/token) | **Parcial:** `keep_alive` (D2). El resto requiere decisión (P1–P3) |
| A2 | **Un PostgreSQL nativo del sistema ocupaba el puerto 5432**: el contenedor no arrancaba y la API respondía `db: down`. Además, ese servidor escuchaba en todas las interfaces de red (`0.0.0.0`). | `docker inspect`: *address already in use*; `ss -ltnp` | **Resuelto:** se deshabilitó el servicio nativo y el README del backend explica cómo detectarlo |

### Media

| # | Hallazgo | Evidencia | Estado |
|---|---|---|---|
| M1 | **Modelos descargados tras 5 min sin uso.** La primera pregunta después de una pausa (por ejemplo, entre clases) tardaba ~19 s en cargar el modelo. | `ollama ps`: *4 minutes from now*; frío 18,8 s | **Corregido (D2):** tras 6 min sin uso, 8,4 s en vez de 18,8 s |
| M2 | **Login: ~25 por segundo por proceso.** scrypt usa el threadpool de libuv (4 hilos); con 16 simultáneos el p99 llega a 1,6 s. Un curso entero entrando a la vez lo nota, pero el resto de la API no se ve afectado. | Tabla de login | **Propuesta P4** |
| M3 | **`/dev/shm` de 64 MB en el contenedor.** Construir el índice HNSW en paralelo con más memoria falla con *could not resize shared memory segment*. | Falló con `maintenance_work_mem` de 1 GB | **Corregido (D3):** `shm_size: 256mb`. Con 64 MB tarda 106 s; con 192 MB, 79 s |
| M4 | **El índice HNSW no se usa y pesa 703–750 MB** (más que todo el resto de la base). Hay que construirlo de nuevo en cada carga masiva (52–106 s), encarece cada fragmento que se sube y no cabe en `shared_buffers` (128 MB). | `pg_stat_user_indexes`: 0 usos; planes con `idx_embeddings_curso` | **Propuesta P5** (es un cambio de esquema) |

### Baja

| # | Hallazgo | Evidencia | Estado |
|---|---|---|---|
| B1 | **El RLS triplica el costo de las consultas del docente.** `puede_ver_estudiante()` llama a `puede_gestionar_curso()`, que consulta `cursos` por cada fila: el libro de notas pasa de 9,4 ms (sin RLS) a 13,8 ms (admin) y 28,6 ms (docente). El resumen del curso ejecuta tres consultas así (63 ms con 160 estudiantes; ~¼ con un curso real de 40). Una política alternativa con `IN (SELECT …)` no mejoró. | Comparación sin RLS / admin / docente | **Propuesta P6** (solo si los cursos crecen) |
| B2 | **No había tiempos por fase** del tutor: era imposible saber si la espera venía de la base, del embedding o del LLM. | — | **Corregido (D1)** |
| B3 | **Configuración por defecto de PostgreSQL** (`shared_buffers` 128 MB, `work_mem` 4 MB). Sirve para desarrollo, no para producción. | `pg_settings` | **Propuesta P7** |

### Hipótesis descartadas

- **"El HNSW con filtro por curso y por colegio devuelve menos de 4 fragmentos":** no ocurre. El planificador usa la búsqueda exacta por curso incluso con 6 300 fragmentos en un mismo curso (recall 100 %).
- **"Las 4 transacciones de cada turno del tutor pesan":** juntas suman menos de 15 ms, frente a segundos del LLM. No vale la pena juntarlas.
- **Índices faltantes:** todas las consultas de las rutas usan índices; los escaneos secuenciales son sobre tablas chicas (`cursos`, `colegios`).

## Correcciones aplicadas

| # | Cambio | Archivos |
|---|---|---|
| D1 | **Línea de log `tutor` con tiempos por fase** al final de cada turno: `has_notes_ms`, `embed_ms`, `search_ms`, `prepare_ms`, `first_token_ms`, `save_ms`, `total_ms` y las métricas de Ollama (`load_ms`, `prompt_tokens`, `prompt_ms`, `eval_tokens`, `eval_ms`). Solo números; una prueba verifica que nunca incluya la pregunta ni la respuesta. | `src/modules/tutor/turn.js`, `llm-client.js` (`onStats`), `rag/rag-service.js`, `rag/rag-prompt.js`; pruebas en `test/turn.test.js` y `test/chat.test.js` |
| D2 | **`LLM_KEEP_ALIVE`** (por defecto `30m`) para el LLM y los embeddings. Mantiene ~3,4 GB de RAM ocupados mientras tanto. | `llm-client.js`, `embeddings-client.js`, `server.js`, `rag/create-rag.js`, `.env.example`, `k8s/configmap.yaml`; pruebas en `test/chat.test.js` y `test/rag.test.js` |
| D3 | **`shm_size: 256mb`** en el contenedor de PostgreSQL. | `code/backend/compose.yaml` |
| D4 | **Nota en el README** sobre el puerto 5432 ocupado y `--force-recreate`. | `code/backend/README.md` |

Verificación después de los cambios: backend 129 pruebas sin base y 227 con PostgreSQL, frontend 84, Postman 58 requests y 102 aserciones, y recorrido del tutor en Brave (pregunta con fuente, historial, retomar tras recargar y borrar).

## Propuestas para el equipo

| # | Propuesta | Ganancia esperada | Costo o riesgo |
|---|---|---|---|
| P1 | **LLM con GPU o proveedor externo** para la demo pública y producción (ya investigado: Cloudflare Workers AI) | Primera palabra < 1 s; varias preguntas en paralelo | Costo; adaptador compatible con OpenAI (ya en la lista de la demo) |
| P2 | **Reordenar el prompt del tutor:** poner las reglas fijas antes de los fragmentos, para que Ollama las reutilice en caché | ~150–200 tokens menos por turno ≈ **2 s menos** de primera palabra (estimado a 11,5 ms/token) | Un modelo chico puede seguir peor las reglas si van lejos de la pregunta: hay que validarlo con preguntas de prueba (Bastián) |
| P3 | **Bajar `RAG_TOP_K` de 4 a 3** o achicar los fragmentos | ~25 % menos de prompt | Puede bajar la calidad de las respuestas |
| P4 | **`UV_THREADPOOL_SIZE`** acorde a los núcleos del servidor (8 → 34 logins/s en este equipo) | ×1,3–2,5 logins/s | En k8s el pod tiene 0,5 CPU: ahí conviene escalar pods (HPA), no hilos |
| P5 | **Quitar `idx_embeddings_hnsw`** (ADR corto) y volver a crearlo solo si un curso supera ~50 000 fragmentos | −750 MB, carga de apuntes más rápida | Cambio de esquema; ninguno en la búsqueda (no se usa) |
| P6 | **RLS del docente sin consulta por fila** (por ejemplo, la lista de cursos del docente calculada una vez por sesión) | ×2–3 en libro de notas y resumen | Toca la seguridad multi-tenant: requiere ADR y la suite SQL |
| P7 | **Ajustar PostgreSQL en producción** (`shared_buffers` ~25 % de la RAM, `effective_cache_size`, `work_mem`) | Más caché para la base | Depende del proveedor (Neon/Render) |
| P8 | **Quality gate de rendimiento en S08:** guardar los scripts de esta auditoría (generador de volumen + benchmarks) y correrlos en CI | Detectar regresiones | Tiempo de CI (la carga de 96 000 vectores tarda ~3 min) |
