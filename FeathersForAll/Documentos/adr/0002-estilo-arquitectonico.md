# ADR 0002 · Elección de estilo arquitectónico para AulaViva

## Estado

Propuesto — pendiente de aceptación por el equipo (Ignacio Ibañez, Juan Castillo, Iván Oliva, Bastián González, Cristofer Jeria, Alex Flores).

## Contexto

AulaViva es una plataforma SaaS multi-tenant que debe permitir a cada colegio gestionar cursos, crear evaluaciones auto-corregidas con retroalimentación inmediata, y ofrecer un tutor IA (RAG) que responda dudas ancladas al currículum de cada curso, aislado por tenant.

El equipo está compuesto por 6 personas y el proyecto está en etapa de MVP para el piloto 2026. El dominio (gestión académica + tutor IA) todavía se está descubriendo, por lo que se prioriza poder iterar rápido sin cargar con complejidad operacional innecesaria desde el día uno.

## Decisión

Se adopta un **modular monolith** como estilo arquitectónico inicial, con fronteras de módulo claras entre: gestión de cursos/matrícula, evaluaciones, y tutor IA (RAG). El módulo de Tutor IA queda diseñado para poder **extraerse como servicio event-driven** más adelante, si el volumen de consultas o su latencia lo justifican.

## Consecuencias

**Gana:**

- Deploy único, más simple de operar y depurar con un equipo de 6 personas.

- Transacciones ACID naturales entre cursos, matrículas y evaluaciones.

- El módulo de Tutor IA queda delimitado desde el día 1, facilitando una futura extracción sin reescribir el dominio completo.

**Pierde / se vuelve más difícil:**

- Requiere disciplina de módulos: si el monolito no se mantiene realmente modular, la futura extracción del Tutor IA será costosa.

- Escalabilidad acoplada: si el tutor IA necesita escalar de forma independiente al resto del sistema, el monolito no lo permite sin refactor.

## Alternativas descartadas

- **Microservicios desde el día 0:** complejidad operacional excesiva para un equipo de 6 personas sin DevOps dedicado; no se justifica en la etapa de MVP/piloto.

- **Serverless puro (FaaS):** los cold starts son incompatibles con una experiencia de tutor IA conversacional y fluida para el estudiante.

## Stack confirmado

- **Frontend:** HTML + CSS + JavaScript (sin framework de SPA), servido por el propio backend.

- **Backend:** Node.js + Express, como monolito único.

- **Base de datos:** PostgreSQL, elegida por su robustez y madurez en la persistencia y validación de datos.

Este stack refuerza la decisión de modular monolith: sin un framework SPA ni microservicios, mantener un único backend Express es la opción más simple de operar para un equipo primerizo de 6 personas.

## Próximos pasos

- Validar esta decisión con el equipo completo antes de marcarla como "Aceptada".

- Confirmar si el módulo de Tutor IA (RAG) también corre dentro del mismo proceso Express o como servicio separado desde el inicio.

