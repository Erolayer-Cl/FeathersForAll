# ADR 0013 · Tutor IA síncrono dentro del monolito, sin worker ni cola

## Estado

Aceptado — 2026-11-25. Reemplaza D2 y D3 del [ADR 0002](0002-estilo-arquitectonico.md) y la parte de broker y outbox del [ADR 0004](0004-datos-y-eventos.md). Documenta lo que está en el código desde la S07.

## Contexto

El ADR 0002 dibujó el Tutor IA como un contenedor aparte, consultado por HTTP, con un worker que atendía las consultas desde AWS SQS (D2 y D3). El ADR 0004 agregó la outbox y un tutor asíncrono: la API respondía `202` y el worker contestaba después.

Al construirlo pasó otra cosa:

- El tutor se implementó como módulo de la misma API (`code/backend/src/modules/tutor/`) y responde en streaming: el estudiante ve la respuesta mientras el modelo la escribe.
- El LLM (Ollama, `qwen2.5:3b`) y los embeddings (`bge-m3`) corren en el PC del equipo. No hay cuenta de AWS ni de Render (ADR 0014).
- Con conversaciones guardadas (ADR 0008), el servidor ya arma el historial en cada turno. Una cola no aportaba nada a ese flujo.
- Las tablas `outbox_eventos` y `consultas_tutor_ia` y sus consultas en `queries.js` quedaron en el esquema, pero ninguna ruta las usa.

## Decisión

El Tutor IA es un **módulo del monolito** que responde de forma **síncrona en streaming**, sin worker, cola ni outbox.

- Rutas: `POST /v1/courses/{courseId}/tutor-conversations/{id}/messages` (portal) y `POST /v1/dev/chat` (desarrollo y docente). Responden `text/plain` en streaming y las fuentes van en `X-Rag-Sources`.
- RAG híbrido en el mismo PostgreSQL: pgvector (HNSW, coseno) más búsqueda por palabras con `tsvector` e índice GIN (`07_rag_indices.sql`), siempre filtrado por colegio y curso.
- Si el LLM no responde: corte por inactividad (`timeoutMs`) y `503` RFC 7807. `/readyz` no depende del LLM, así que una caída de Ollama no saca los pods del balanceo.
- Tope de preguntas por estudiante (10 por minuto, 100 por hora, 2 a la vez) antes de tocar la base o el LLM. Los guardrails de entrada y salida están en el [ADR 0012](0012-ia-responsable.md).
- El módulo mantiene su frontera: ningún otro módulo toca sus tablas ni sus prompts. Extraerlo como servicio sigue siendo posible si el costo o la latencia lo piden.

## Consecuencias

**Gana:**

- Una pieza menos que operar: sin worker, sin cola, sin relay.
- Mejor experiencia: la respuesta empieza a aparecer en uno o dos segundos, en vez de esperar a que termine y consultar el estado.
- Todo el flujo se prueba de punta a punta con un LLM simulado en CI.

**Pierde / se vuelve más difícil:**

- Cada turno ocupa una conexión HTTP mientras el modelo escribe. Con muchos estudiantes a la vez, el cuello de botella es el LLM, no la API.
- No hay circuit breaker: si Ollama está lento, cada turno espera hasta el corte por inactividad.
- Generar evaluaciones con IA tiene límite por usuario (10 cada 10 min). Los topes del tutor viven en la memoria de cada pod: con varias réplicas, cada una cuenta lo suyo.
- `outbox_eventos`, `consultas_tutor_ia` y sus consultas quedan sin uso: hay que borrarlas o retomarlas.

## Alternativas descartadas

- **Worker con SQS (ADR 0002 D3 y ADR 0004):** sin cuenta de AWS, y la respuesta asíncrona obliga a consultar el estado o a usar websockets para mostrarla. Se pierde el streaming.
- **Tutor como servicio aparte (ADR 0002 D2):** un despliegue, una red y una observabilidad más, sin carga que lo justifique en el piloto.
- **Cola en PostgreSQL (`SKIP LOCKED`) sin SQS:** evita AWS, pero mantiene el worker y la espera. No resuelve un problema que tengamos hoy.
- **Proveedor LLM administrado (OpenAI, Anthropic, Bedrock):** costo por token y datos de menores fuera del país. Se evalúa si el piloto crece.

## Fecha

2026-11-25

## Autores

Iván (Tech Lead)
