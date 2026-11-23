# Atributos de calidad priorizados — AulaViva

Top 3 atributos de calidad (NFRs) que guían las decisiones arquitectónicas
de AulaViva, en orden de prioridad para el piloto 2026.

## 1. Seguridad — Aislamiento por tenant (RBAC)
- **Métrica:** 0 casos de fuga de datos entre colegios (tenants) en
  auditoría; control de acceso por rol (docente / estudiante / admin
  colegio) verificado en el 100% de los endpoints.
- **Impacto en la arquitectura:** IAM granular por rol, aislamiento de
  datos por colegio (schema o RLS en PostgreSQL), validación de tenant en
  cada request de la API.
- **Responsable sugerido:** equipo backend / Tech Lead.

## 2. Disponibilidad — SLA durante horario escolar
- **Métrica:** disponibilidad objetivo durante el horario de clases del
  colegio piloto (a definir el % exacto, ej. 99.5%).
- **Impacto en la arquitectura:** health checks en la API, manejo de
  caídas o timeouts del proveedor LLM sin bloquear el resto del sistema,
  monitoreo básico de errores.
- **Responsable sugerido:** Tech Lead + equipo backend.

## 3. Mantenibilidad — Lead time de cambios
- **Métrica:** el equipo puede entregar un cambio de módulo (cursos,
  evaluaciones o tutor IA) sin depender de soporte técnico externo ni de
  tocar los otros módulos.
- **Impacto en la arquitectura:** módulos con fronteras claras dentro del
  monolito Express (ver ADR 0002), documentación viva de cada contenedor
  en `docs/c4/`. Al ser un equipo primerizo con HTML/CSS/JS y Express sin
  framework, mantener carpetas/rutas bien organizadas por módulo es clave
  para no acoplar todo en un solo archivo.
- **Responsable sugerido:** todo el equipo.

## Stack confirmado
Frontend HTML + CSS + JavaScript · Backend Node.js + Express (monolito) ·
Base de datos PostgreSQL.

---
*Nota: las métricas exactas (SLA %, umbrales de latencia, etc.) quedan
pendientes de que el equipo las defina con datos reales del piloto.*
