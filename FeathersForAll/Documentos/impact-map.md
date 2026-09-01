# Impact Map — AulaViva

> S02 · Insumo para derivar el backlog inicial (`docs/backlog.md`).

## Objetivo de negocio (Goal)

**Reducir el tiempo que el docente dedica a administrar y corregir evaluaciones, y aumentar el aprendizaje efectivo del estudiante, para incrementar la adopción de AulaViva en los colegios del piloto 2026.**

## Actores clave elegidos

Del conjunto de actores del sistema (Estudiante, Docente, Coordinador académico, Apoderado, Sostenedor) se seleccionan **Docente** y **Estudiante** como actores clave para esta iteración: son quienes ejecutan el loop central del producto (gestionar curso → evaluar → recibir apoyo IA) y de quienes depende validar el MVP más rápido.

---

## Rama: Docente

```
Goal
 └─ Actor: Docente
     ├─ Impacto: Reduce el tiempo que dedica a corregir evaluaciones
     │    └─ Deliverable: Evaluaciones de alternativas auto-corregidas con retroalimentación por pregunta
     ├─ Impacto: Gana visibilidad temprana de qué contenidos debe reforzar
     │    └─ Deliverable: Dashboard de resultados agregados por curso/evaluación
     └─ Impacto: Puede organizar su curso sin depender de soporte técnico
          └─ Deliverable: Gestión de curso y matrícula de estudiantes con RBAC, aislada por tenant (colegio)
```

## Rama: Estudiante

```
Goal
 └─ Actor: Estudiante
     ├─ Impacto: Recibe retroalimentación inmediata al terminar una evaluación
     │    └─ Deliverable: Flujo de rendición de evaluación con resultado y feedback al instante
     └─ Impacto: Resuelve dudas de contenido curricular fuera del horario de clases
          └─ Deliverable: Tutor IA con RAG anclado a los apuntes de su propio curso/tenant
```

## Fuera de alcance de este mapa (queda para próxima iteración)

- **Apoderado** → Panel de seguimiento (MVP ítem 5): no se mapea aún porque depende de que existan resultados de evaluación (rama Docente/Estudiante) primero.
- **Sostenedor / Coordinador académico**: impactos de administración multi-colegio, se abordan al formalizar el modelo de aislamiento multi-tenant (ADR 0002, S03).

---

## De este mapa a las 5 historias del backlog

| Deliverable del mapa | Historia derivada |
|---|---|
| Gestión de curso y matrícula (RBAC + tenant) | H1 |
| Evaluaciones auto-corregidas con retroalimentación | H2 |
| Dashboard de resultados | H3 |
| Flujo de rendición con feedback inmediato | H4 |
| Tutor IA con RAG por tenant | H5 |

Ver detalle, formato INVEST y priorización MoSCoW en [`docs/backlog.md`](backlog.md).
