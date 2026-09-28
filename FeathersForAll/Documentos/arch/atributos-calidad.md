# Atributos de calidad priorizados — AulaViva

Top 3 atributos de calidad (NFRs) que guían las decisiones arquitectónicas
de AulaViva, en orden de prioridad para el piloto 2026.

Las métricas de esta versión son **propuestas del Tech Lead** (2026-09-28) para
cerrar los valores que estaban pendientes; se ajustan con datos reales del
piloto y se ratifican en la reunión del equipo.

## 1. Seguridad — Aislamiento por tenant (RBAC)
- **Métrica:** 0 casos de fuga de datos entre colegios (tenants) en
  auditoría; control de acceso por rol (docente / estudiante / admin
  colegio) verificado en el 100% de los endpoints; 100% de las tablas con
  `tenant_id` protegidas por política RLS.
- **Cómo se verifica:** suite automatizada de "fuga entre tenants" (QA) que
  intenta leer/escribir datos de otro colegio en cada endpoint y falla el
  build si lo logra; incluye el Tutor IA (ningún apunte de otro tenant en
  las fuentes de una respuesta).
- **Impacto en la arquitectura:** IAM granular por rol, aislamiento de
  datos por colegio con esquema compartido + `tenant_id` + Row-Level
  Security en PostgreSQL (ADR 0002, D1), validación de tenant en cada
  request de la API. Datos de menores: solo datos sintéticos en
  desarrollo y consentimiento parental para datos reales.
- **Responsable sugerido:** equipo backend / Tech Lead.

## 2. Disponibilidad — SLA durante horario escolar
- **Métrica:** 99.5% mensual dentro del horario de clases del colegio
  piloto (propuesta: lunes a viernes, 07:30–18:00, hora de Santiago);
  latencia p95 de la API (sin Tutor IA) < 500 ms; latencia p95 de una
  respuesta del Tutor IA < 8 s.
- **Impacto en la arquitectura:** health checks en la API, timeout y
  circuit breaker hacia el proveedor LLM para que su caída no bloquee el
  resto del sistema (ADR 0002, D2), monitoreo básico de errores y
  degradación controlada ("el tutor no está disponible ahora") en vez de
  error genérico.
- **Responsable sugerido:** Tech Lead + DevSecOps.

## 3. Mantenibilidad — Lead time de cambios
- **Métrica:** el equipo puede entregar un cambio de módulo (cursos,
  evaluaciones o tutor IA) sin depender de soporte técnico externo ni de
  tocar los otros módulos; un cambio típico de un módulo se integra
  (PR revisado y en `main`) en menos de 3 días hábiles.
- **Impacto en la arquitectura:** módulos con fronteras claras dentro del
  monolito Express (ver ADR 0002), documentación viva de cada contenedor
  en `Documentos/c4/`. Al ser un equipo primerizo con HTML/CSS/JS y Express
  sin framework, mantener carpetas/rutas bien organizadas por módulo es
  clave para no acoplar todo en un solo archivo.
- **Responsable sugerido:** todo el equipo.

## Stack confirmado
Frontend HTML + CSS + JavaScript · Backend Node.js + Express (monolito) ·
Base de datos PostgreSQL (RLS + pgvector).

---
*Nota: las cifras son puntos de partida; se recalibran con datos del piloto.
Cualquier cambio de métrica se registra en un ADR o en este archivo con fecha.*
