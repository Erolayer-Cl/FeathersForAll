# Backlog inicial — AulaViva

> S02 · Derivado de [`docs/impact-map.md`](impact-map.md). 5 historias, checklist INVEST aplicado a cada una, priorización MoSCoW. Escenarios Gherkin en [`docs/scenarios/`](scenarios/) (3 por historia, 15 en total).

## Priorización MoSCoW

| Prioridad | Historias | Justificación |
|---|---|---|
| **Must have** | H1, H2, H4 | Forman el loop mínimo funcional: sin curso ni matrícula no hay evaluación, y sin evaluación rendida no hay feedback. Es el MVP mínimo demostrable. |
| **Should have** | H5 | Diferenciador clave de AulaViva (tutor IA con RAG) y parte del alcance mínimo comprometido, pero puede entrar una vez el loop docente-estudiante esté estable. |
| **Could have** | H3 | Aporta valor (visibilidad docente) pero no bloquea el flujo principal; puede iterarse con datos reales una vez existan respuestas registradas. |
| **Won't have (esta iteración)** | Panel de apoderado, importación masiva de estudiantes, múltiples intentos configurables por evaluación | Dependen de que H1–H4 estén validadas primero; quedan para el siguiente ciclo. |

---

## H1 — Crear curso y matricular estudiantes

**Como** Docente, **quiero** crear un curso y matricular a mis estudiantes en él, **para** gestionar mi grupo de forma aislada dentro de mi colegio (tenant).

**Criterios de aceptación**
1. Dado que soy docente autenticado en el tenant de mi colegio, cuando creo un curso con nombre y periodo, entonces el curso queda asociado únicamente a mi colegio.
2. Dado un curso creado, cuando matriculo a un estudiante por su correo institucional, entonces aparece en la lista de matriculados del curso.
3. Dado un estudiante del colegio A, cuando un docente del colegio B intenta matricularlo, entonces el sistema rechaza la operación (aislamiento entre tenants).

**Checklist INVEST**

| Criterio | Cumple | Nota |
|---|---|---|
| Independiente | ✅ | Solo depende de que exista tenant y usuario autenticado (ya provistos por auth). |
| Negociable | ✅ | El mecanismo de matrícula (manual, CSV, link de invitación) se puede acordar con el equipo. |
| Valiosa | ✅ | Sin curso ni matrícula no hay contenedor para evaluaciones ni tutor IA. |
| Estimable | ✅ | Acotada a CRUD de curso + relación curso-estudiante con validación de tenant. |
| Pequeña | ✅ | Cabe en un sprint; no incluye importación masiva ni edición en lote. |
| Testeable | ✅ | Los 3 AC son verificables con los escenarios Gherkin asociados. |

---

## H2 — Crear evaluación auto-corregida

**Como** Docente, **quiero** crear una evaluación de alternativas con retroalimentación por pregunta, **para** ahorrar tiempo de corrección y dar respuesta oportuna a mis estudiantes.

**Criterios de aceptación**
1. Dado un curso existente, cuando creo una evaluación con preguntas de alternativas marcando la respuesta correcta, entonces queda disponible para ese curso.
2. Dado una evaluación publicada, cuando defino un texto de retroalimentación por pregunta, entonces ese texto se muestra al estudiante tras responder.
3. Dado una evaluación con al menos una pregunta sin respuesta correcta definida, cuando intento publicarla, entonces el sistema impide la publicación e indica el motivo.

**Checklist INVEST**

| Criterio | Cumple | Nota |
|---|---|---|
| Independiente | ✅ | Depende solo de que exista un curso (H1), no de H3/H4/H5. |
| Negociable | ✅ | Tipos de pregunta adicionales (desarrollo, verdadero/falso) quedan fuera y son negociables a futuro. |
| Valiosa | ✅ | Es el mecanismo central de ahorro de tiempo docente que motiva el proyecto. |
| Estimable | ✅ | CRUD de evaluación + preguntas + validación de publicación. |
| Pequeña | ✅ | Limitada a alternativas simples; sin banco de preguntas reutilizable. |
| Testeable | ✅ | AC verificables con escenarios Gherkin. |

---

## H3 — Ver dashboard de resultados

**Como** Docente, **quiero** ver un dashboard con los resultados agregados de una evaluación, **para** identificar rápidamente qué contenidos debo reforzar.

**Criterios de aceptación**
1. Dado que una evaluación tiene respuestas registradas, cuando abro el dashboard del curso, entonces veo el puntaje promedio y la distribución de aciertos por pregunta.
2. Dado el dashboard abierto, cuando filtro por estudiante, entonces veo el detalle de sus respuestas y la retroalimentación recibida.
3. Dado que ningún estudiante ha respondido aún, cuando abro el dashboard, entonces el sistema muestra un estado vacío en vez de un error.

**Checklist INVEST**

| Criterio | Cumple | Nota |
|---|---|---|
| Independiente | ✅ | Solo requiere que existan respuestas (depende de H2 y H4 como datos, no como bloqueo de desarrollo: se puede construir con datos sintéticos). |
| Negociable | ✅ | Los gráficos específicos (barras, tabla) son negociables con QA/PO. |
| Valiosa | ✅ | Da visibilidad accionable al docente, aunque no bloquea el loop mínimo. |
| Estimable | ✅ | Agregaciones simples sobre datos ya existentes. |
| Pequeña | ✅ | Sin exportación ni comparación histórica entre periodos. |
| Testeable | ✅ | AC verificables, incluyendo el caso de estado vacío. |

---

## H4 — Rendir evaluación y recibir retroalimentación

**Como** Estudiante, **quiero** rendir una evaluación y ver mi retroalimentación inmediatamente al finalizar, **para** saber en qué debo reforzar sin esperar la corrección del docente.

**Criterios de aceptación**
1. Dado que estoy matriculado en el curso y la evaluación está publicada, cuando respondo todas las preguntas y envío, entonces recibo mi puntaje y retroalimentación por pregunta al instante.
2. Dado que ya envié mis respuestas, cuando intento volver a rendir la misma evaluación, entonces el sistema lo impide (según configuración de intentos) y muestra mi resultado anterior.
3. Dado que no estoy matriculado en el curso, cuando intento acceder a su evaluación, entonces el sistema me deniega el acceso.

**Checklist INVEST**

| Criterio | Cumple | Nota |
|---|---|---|
| Independiente | ✅ | Depende de H1 (matrícula) y H2 (evaluación publicada) como precondición de datos, no de implementación conjunta. |
| Negociable | ✅ | La política de reintentos es configurable y negociable con PO. |
| Valiosa | ✅ | Es el momento donde el estudiante percibe el valor central del producto. |
| Estimable | ✅ | Flujo de rendición + cálculo de puntaje + control de acceso por tenant/matrícula. |
| Pequeña | ✅ | Un intento por defecto; sin temporizador ni guardado parcial en esta iteración. |
| Testeable | ✅ | AC verificables, incluye caso de control de acceso. |

---

## H5 — Consultar al tutor IA

**Como** Estudiante, **quiero** preguntarle al tutor IA dudas sobre el contenido de mi curso, **para** resolverlas fuera del horario de clases con información confiable del currículum.

**Criterios de aceptación**
1. Dado que estoy en un curso con apuntes cargados, cuando le pregunto al tutor IA sobre esa materia, entonces recibo una respuesta basada en el contenido (RAG) de ese curso.
2. Dado que pregunto algo fuera del temario del curso, cuando el tutor IA no encuentra contenido de respaldo, entonces responde indicando que no tiene información suficiente, sin inventar una respuesta.
3. Dado que soy estudiante del colegio A, cuando consulto al tutor IA, entonces solo se usan como fuente los apuntes de mi propio tenant/curso, nunca los de otro colegio.

**Checklist INVEST**

| Criterio | Cumple | Nota |
|---|---|---|
| Independiente | ✅ | Requiere apuntes cargados en un curso (H1), pero no bloquea ni es bloqueada por H2/H3/H4. |
| Negociable | ✅ | El proveedor LLM y el mecanismo de carga de apuntes son negociables con AI/Data Lead. |
| Valiosa | ✅ | Es el diferenciador principal de AulaViva frente a un LMS tradicional. |
| Estimable | ✅ | Acotada a: ingesta de apuntes → RAG → respuesta con corte por tenant. |
| Pequeña | ✅ | Sin historial de conversación persistente ni multi-turno complejo en esta iteración. |
| Testeable | ✅ | AC verificables, incluye caso de "sin información suficiente" y aislamiento entre tenants. |
