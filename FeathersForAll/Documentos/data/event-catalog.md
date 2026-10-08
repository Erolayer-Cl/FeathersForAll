# Catálogo de eventos de dominio — AulaViva (S06)

> Eventos del ciclo de vida principal (curso → evaluación → intento, y consulta al tutor IA). Decisión de broker y patrones: [ADR 0004](../adr/0004-datos-y-eventos.md). Contextos: [bounded-contexts.md](bounded-contexts.md).

## Reglas

- Nombre en pasado con el formato `recurso.acción_en_pasado` (algo que **ya ocurrió**, no un comando).
- Cada evento lleva versión (`event_version`), `trace_id` y `colegio_id`. Es inmutable: un cambio incompatible crea una versión nueva (`2.0`), no se edita la anterior.
- Se guarda en `outbox_eventos` en la **misma transacción** que el cambio de estado (patrón Outbox). Un relay en el worker, conectado con el rol `feathersforall_plataforma` (lee la outbox de todos los colegios), lo publica en AWS SQS.
- Entrega **at-least-once**: todo consumidor debe ser idempotente por `event_id` (si ya lo procesó, lo ignora).
- Sin datos personales sensibles en el payload: solo IDs (el proyecto trata datos de menores). Quien necesite más datos los lee de la BD con su propio permiso.

## Sobre (envelope) común

```json
{
  "event_id": "0b6c2f4e-6a7d-4d1e-9a51-3c2f7e9b8a10",
  "event_type": "consulta_tutor.encolada",
  "event_version": "1.0",
  "occurred_at": "2026-10-07T14:22:31Z",
  "colegio_id": "00000000-0000-0000-0000-00000000000b",
  "aggregate_id": "b49ab1c6-e7a0-4558-a30d-01dc6207493d",
  "trace_id": "c8f2b1d4e7",
  "data": { "curso_id": "8d4e4351-0d3e-4271-bfb3-f9ae914ba6f6", "estudiante_id": "10000000-0000-0000-0000-000000000002" }
}
```

En la BD (`outbox_eventos`, `code/backend/db/02_s06_ajustes.sql`): `id` = `event_id`, `tipo` = `event_type` (CHECK `recurso.accion`), `version` = `event_version`, `agregado_id` = `aggregate_id`, `payload` = `data`, `creado_at` = `occurred_at`.

## Catálogo (14 eventos)

Leyenda de la columna **SQS (MVP)**: **Sí** = se publica en la cola en el piloto porque alguien lo procesa de forma asíncrona; **Outbox** = queda registrado en la outbox (trazabilidad y consumidores futuros) pero no tiene consumidor activo aún.

| # | Evento | v | Productor (contexto) | Disparado por | `data` | Consumidores | SQS (MVP) |
|---|---|---|---|---|---|---|---|
| 1 | `colegio.creado` | 1.0 | Identidad y tenancy | master crea un colegio | `colegio_id`, `rbd` | (futuro) onboarding del tenant, FinOps por tenant | Outbox |
| 2 | `usuario.creado` | 1.0 | Identidad y tenancy | admin crea docente o estudiante | `usuario_id`, `rol` | Notificaciones (correo de bienvenida) | Sí |
| 3 | `curso.creado` | 1.0 | Gestión académica | `POST /courses` (H1) | `curso_id`, `docente_id`, `periodo` | Tutor IA (crea su espacio de apuntes) | Outbox |
| 4 | `estudiante.matriculado` | 1.0 | Gestión académica | `POST /courses/{id}/enrollments` (H1) | `curso_id`, `estudiante_id` | Tutor IA (habilita consultas), Notificaciones | Sí |
| 5 | `evaluacion.creada` | 1.0 | Evaluaciones | `POST /courses/{id}/assessments` (H2) | `evaluacion_id`, `curso_id`, `preguntas` (cantidad) | (futuro) analítica docente | Outbox |
| 6 | `evaluacion.publicada` | 1.0 | Evaluaciones | `PATCH /assessments/{id}` → published (H2) | `evaluacion_id`, `curso_id`, `fecha_publicacion` | Notificaciones (avisa a estudiantes matriculados) | Sí |
| 7 | `evaluacion.cerrada` | 1.0 | Evaluaciones | `PATCH /assessments/{id}` → closed | `evaluacion_id`, `curso_id` | Resultados (cierre del dashboard), Notificaciones | Outbox |
| 8 | `intento.enviado` | 1.0 | Evaluaciones | `POST /assessments/{id}/submissions` (H4) | `intento_id`, `evaluacion_id`, `estudiante_id` | Corrección automática | Outbox (en el MVP se corrige en la misma transacción) |
| 9 | `intento.corregido` | 1.0 | Evaluaciones | corrección automática terminada (H4) | `intento_id`, `evaluacion_id`, `correctas`, `total_preguntas` | Resultados (dashboard H3), (futuro) panel del apoderado | Outbox |
| 10 | `apunte.cargado` | 1.0 | Tutor IA | docente sube un apunte al curso | `apunte_id`, `curso_id` | Worker de indexación (chunks + embeddings) | Sí |
| 11 | `apunte.indexado` | 1.0 | Tutor IA | worker terminó los embeddings | `apunte_id`, `curso_id`, `chunks` | (futuro) aviso al docente | Outbox |
| 12 | `consulta_tutor.encolada` | 1.0 | Tutor IA | `POST /courses/{id}/tutor-questions` (H5) | `consulta_id`, `curso_id`, `estudiante_id` | Worker del tutor (RAG + LLM) | Sí |
| 13 | `consulta_tutor.respondida` | 1.0 | Tutor IA | worker obtuvo respuesta del LLM | `consulta_id`, `con_respaldo`, `fuentes` (IDs), `tokens` | FinOps (uso de LLM por tenant), (futuro) aviso en tiempo real | Outbox |
| 14 | `consulta_tutor.fallida` | 1.0 | Tutor IA | LLM caído o timeout | `consulta_id`, `motivo` | Observabilidad (alarma en CloudWatch si sube la tasa) | Outbox |

## Ejemplo de flujo (H5)

1. API: `INSERT consultas_tutor_ia (en_cola)` + `INSERT outbox_eventos (consulta_tutor.encolada)` en una sola transacción → responde `202`.
2. Relay (worker, rol plataforma): lee la outbox con `FOR UPDATE SKIP LOCKED`, publica en SQS, marca `publicado_at` (si falla, suma `intentos`).
3. Worker del tutor: consume el mensaje; si `event_id` ya fue procesado, lo descarta. Abre una transacción con `SET LOCAL app.colegio_id` = `colegio_id` del evento, busca en los apuntes del curso (pgvector), llama al LLM, actualiza la consulta a `respondida` o `fallida`, registra las fuentes en `consultas_fuentes` y guarda el evento correspondiente en la outbox.
4. Frontend: `GET /tutor-questions/{id}` hasta ver `answered` o `failed`.
