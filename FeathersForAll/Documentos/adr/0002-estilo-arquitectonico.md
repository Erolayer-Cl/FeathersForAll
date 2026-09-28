# ADR 0002 · Elección de estilo arquitectónico para AulaViva

## Estado

Aceptado — 2026-09-28. Decisión del Tech Lead (Iván Oliva); pendiente de ratificar en la reunión del equipo (Ignacio Ibañez, Juan Castillo, Bastián González, Cristofer Jeria, Alex Flores). Si el equipo objeta algún punto, se crea un ADR nuevo que lo reemplace (los ADR no se editan).

## Contexto

AulaViva es una plataforma SaaS multi-tenant que debe permitir a cada colegio gestionar cursos, crear evaluaciones auto-corregidas con retroalimentación inmediata, y ofrecer un tutor IA (RAG) que responda dudas ancladas al currículum de cada curso, aislado por tenant.

El equipo está compuesto por 6 personas y el proyecto está en etapa de MVP para el piloto 2026. El dominio (gestión académica + tutor IA) todavía se está descubriendo, por lo que se prioriza poder iterar rápido sin cargar con complejidad operacional innecesaria desde el día uno.

## Decisión

Se adopta un **modular monolith** como estilo arquitectónico inicial, con fronteras de módulo claras entre: gestión de cursos/matrícula, evaluaciones, y tutor IA (RAG). El módulo de Tutor IA queda diseñado para poder **extraerse como servicio event-driven** más adelante, si el volumen de consultas o su latencia lo justifican.

### Decisiones complementarias (cierran los puntos abiertos de la versión anterior)

**D1. Aislamiento multi-tenant: esquema compartido + `tenant_id` + Row-Level Security (RLS) de PostgreSQL.**
- Todas las tablas de negocio llevan `tenant_id` (1 colegio = 1 tenant).
- Cada request autenticado fija el tenant de la transacción (`SET LOCAL app.tenant_id = ...`) y las políticas RLS filtran por ese valor; el rol de conexión de la app no es superusuario ni `BYPASSRLS`.
- Los embeddings del Tutor IA (pgvector) también llevan `tenant_id` y `course_id`, y la búsqueda siempre filtra por ambos.
- Por qué no `schema_per_tenant`: multiplica migraciones y conexiones por colegio, complica pgvector y el pooling, y es más costoso de operar para un equipo primerizo de 6 personas. Se reevalúa si un colegio exige aislamiento físico.
- Consecuencia: el aislamiento depende de que ninguna consulta evite RLS; se cubre con tests automatizados de fuga entre tenants (QA) y con el atributo de calidad "0 fugas".
- En configuración (12-Factor): `TENANT_STRATEGY="shared_schema_rls"`.

**D2. Ubicación del Tutor IA: módulo dentro del mismo proceso Express en el MVP.**
- Vive en su propia carpeta/módulo con una interfaz explícita (`tutorService.ask(tenantId, courseId, question)`); ningún otro módulo toca sus tablas ni sus prompts.
- Llama al proveedor LLM por HTTPS con timeout y circuit breaker, de modo que la caída del LLM no bloquee cursos ni evaluaciones (atributo de disponibilidad).
- Se extrae a servicio aparte solo si se cumple alguna condición: latencia p95 del tutor degrada al resto de la API, o el costo/uso de LLM exige escalarlo de forma independiente.

**D3. Worker / cola asíncrona: diferido, fuera del MVP.**
- Las notificaciones y consultas largas se resuelven de forma asíncrona dentro del proceso (promesas/timeouts) mientras el volumen del piloto sea bajo.
- Si aparece la necesidad, el primer paso es una tabla de jobs en PostgreSQL (patrón outbox), antes de introducir un broker. La elección de broker se revisa en el ADR 0004 (datos y eventos).

## Consecuencias

**Gana:**

- Deploy único, más simple de operar y depurar con un equipo de 6 personas.
- Transacciones ACID naturales entre cursos, matrículas y evaluaciones.
- El módulo de Tutor IA queda delimitado desde el día 1, facilitando una futura extracción sin reescribir el dominio completo.
- Un solo esquema y un solo conjunto de migraciones para todos los colegios.

**Pierde / se vuelve más difícil:**

- Requiere disciplina de módulos: si el monolito no se mantiene realmente modular, la futura extracción del Tutor IA será costosa.
- Escalabilidad acoplada: si el tutor IA necesita escalar de forma independiente al resto del sistema, el monolito no lo permite sin refactor.
- El aislamiento entre colegios descansa en RLS y en `tenant_id` bien aplicado: un error de política es una fuga de datos entre tenants (dato de menores). Requiere pruebas específicas.
- Sin cola en el MVP, un pico de consultas al tutor compite con la API por recursos del mismo proceso.

## Alternativas descartadas

- **Microservicios desde el día 0:** complejidad operacional excesiva para un equipo de 6 personas sin DevOps dedicado; no se justifica en la etapa de MVP/piloto.
- **Serverless puro (FaaS):** los cold starts son incompatibles con una experiencia de tutor IA conversacional y fluida para el estudiante.
- **Esquema por tenant (`schema_per_tenant`):** mejor aislamiento lógico, pero costo de migraciones, pooling y pgvector demasiado alto para el equipo actual.
- **Tutor IA como servicio separado desde el inicio:** añade red, despliegue y observabilidad distribuida sin evidencia de que se necesite.
- **Worker con broker (Kafka/RabbitMQ) desde el inicio:** sobredimensionado para el volumen del piloto.

## Stack confirmado

- **Frontend:** HTML + CSS + JavaScript (sin framework de SPA), servido por el propio backend.

- **Backend:** Node.js + Express, como monolito único.

- **Base de datos:** PostgreSQL (con RLS y extensión pgvector para el RAG), elegida por su robustez y madurez en la persistencia y validación de datos.

Este stack refuerza la decisión de modular monolith: sin un framework SPA ni microservicios, mantener un único backend Express es la opción más simple de operar para un equipo primerizo de 6 personas.

## Fecha

2026-09-28

## Autores

Equipo AulaViva (redacción: Tech Lead)

## Próximos pasos

- Ratificar este ADR en la reunión del equipo (lunes o miércoles) y dejar constancia en el PR.
- Reflejar D1–D3 en el C4 L2 (ya actualizado en `c4/l2-container.puml`) y en el checklist 12-Factor de la S04.
- Escribir el ADR 0003 (estilo cloud) y el ADR 0004 (datos y eventos), que heredan estas decisiones.
