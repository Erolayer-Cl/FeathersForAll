# ADR 0001 - Elección de iniciativa AulaViva

## Estado

Aceptado — 2026-08-21

## Contexto

El equipo debía seleccionar una de las tres iniciativas propuestas en el taller de Ingeniería de Software: MediTriage (HealthTech, triage clínico asistido por IA), CrediScore (FinTech, scoring crediticio y detección de fraude) y AulaViva (EdTech, plataforma SaaS multi-tenant con tutor IA).

## Decisión

Se decidió desarrollar AulaViva debido a su complejidad técnica, impacto educativo y desafíos relacionados con arquitectura SaaS, inteligencia artificial y seguridad.

## Razones

- Permite aplicar conceptos de ingeniería de software.
- Incluye arquitectura multi-tenant.
- Requiere gestión de usuarios y permisos.
- Incorpora IA mediante RAG.
- Presenta desafíos de privacidad y escalabilidad.

## Consecuencias positivas

- Permite aplicar buenas prácticas de desarrollo.
- Genera experiencia en tecnologías actuales.
- Facilita trabajo distribuido mediante Scrum y GitHub.

## Consecuencias negativas

- Mayor complejidad técnica.
- Requiere mayor control de seguridad.
- La implementación del tutor IA implica desafíos adicionales.

## Alternativas descartadas

- **MediTriage (HealthTech):** su definición exige explicabilidad de cada decisión IA, auditoría inmutable por 5 años y cumplimiento de normativa chilena de datos sensibles de salud.
- **CrediScore (FinTech):** su definición exige decisión de crédito en menos de 60 s, eventos de fraude en menos de 500 ms, fairness del modelo y trazabilidad para auditoría CMF.

## Fecha

21-08-2026

## Autores

Equipo AulaViva
