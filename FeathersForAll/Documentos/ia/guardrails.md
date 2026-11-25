# Guardrails del tutor Pluma

Las barreras están en capas, de modo que si una falla queda la siguiente. Cada fila indica dónde vive el control y qué prueba lo verifica.

| Capa | Guardrail | Qué evita | Dónde | Prueba |
|---|---|---|---|---|
| Acceso | JWT y RLS por colegio, curso y usuario | Que un estudiante lea apuntes o conversaciones ajenas | `platform/auth.js`, `db/05_conversaciones_tutor.sql` | `privacidad.pg.test.js`, `conversaciones.pg.test.js` |
| Entrada | Tope de preguntas: 10/min, 100/h y 2 a la vez | Saturar el LLM (D-1, D-4) | `tutor/tutor-limit.js`, `platform/rate-limiter.js` | `rate-limiter.test.js`, `tutor-limite.test.js` |
| Entrada | Límite de tamaño: 50 mensajes × 4 000 caracteres | Prompts gigantes | `tutor/conversaciones.routes.js` | `conversaciones.test.js` |
| Entrada | **Datos personales fuera del prompt**: RUT, correo y teléfono se cambian por `[RUT]`, `[correo]` y `[teléfono]` | Que datos de menores lleguen al modelo o a un proveedor externo (I-4) | `tutor/guardrails.js` (`redactMessages`) | `guardrails.test.js` |
| Entrada (apuntes) | Revisión al subir: órdenes a la IA, etiquetas del prompt y cambios de rol → `422` | *Prompt injection* indirecta (T-4) | `rag/injection-scan.js` | `injection-scan.test.js`, `apuntes-sospechosos.test.js` |
| Decisión | Respuestas fijas **sin LLM** cuando no hay apuntes o información | Que el modelo invente (alucinación) | `rag/rag-prompt.js` (`prepareTurn`) | `turn.test.js`, examen (categorías «fuera de los apuntes» y «curso sin apuntes») |
| Decisión | Búsqueda solo en el curso pedido y visible para el usuario | Fuga entre cursos o colegios (I-5) | `rag/pg-vector-store.js` + RLS | `rag.pg.test.js` |
| Decisión | Glosario básico solo de la asignatura del curso | Respuestas fuera de tema (átomos en Lenguaje) | `rag/basics.js` | `basics-asignatura.test.js`, examen («glosario por asignatura») |
| Decisión | Calculadora exacta para las operaciones: el LLM explica, no calcula | Errores aritméticos del modelo | `rag/arithmetic.js` | `rag-quality.test.js`, examen («cálculo») |
| Prompt | Apuntes delimitados como datos, con la orden de no obedecer lo que digan; temperatura 0,2 con apuntes | Que se obedezcan instrucciones escritas en el material | `rag/rag-prompt.js` | examen («preguntas tramposas») |
| Prompt | Reglas comunes: español claro, no inventar, no pedir ni repetir datos personales; no dar la respuesta final de una tarea | Respuestas inadecuadas o que hagan la tarea | `tutor/system-prompt.js` | `chat.test.js` |
| Salida | **Etiquetas internas** (`<apuntes>`, `<nociones>`, `<calculo>`…) se quitan, también si llegan partidas en el streaming | Mostrar la estructura del prompt (caso real: `<nociones>` en una respuesta) | `tutor/guardrails.js` (`createOutputFilter`) | `guardrails.test.js` |
| Datos | Logs sin el texto de las preguntas ni de las respuestas, solo números y el tipo de turno | Fuga por logs (I-3) | `tutor/turn.js`, regla Semgrep `ffa-log-con-datos-del-estudiante` | `logger.test.js` |
| Datos | Conversaciones visibles solo para el estudiante; purga al terminar el año | Acumular datos de menores (I-8) | ADR 0008, CronJob `ffa-purga-conversaciones` | `conversaciones.pg.test.js` |
| Humano | Solo el docente del curso sube apuntes; las evaluaciones con IA **solo se proponen** y las guarda el docente | Decisiones automáticas sobre el estudiante | `apuntes.routes.js`, `evaluaciones/generar-ia.js` | `apuntes.pg.test.js`, `generar-ia.test.js` |

## Qué NO cubren (riesgo aceptado o pendiente)

- **Datos personales escritos de forma rara** ("mi rut es doce millones…") o nombres propios: los patrones no los detectan.
- **Contenido dañino generado por el modelo** sin relación con los apuntes: no hay un moderador de salida con LLM (ADR 0012). Lo mitigan el anclaje a los apuntes, la temperatura baja y que el modelo no tiene herramientas.
- **Jailbreak** en el modo «Practicar» para obtener la prueba completa (E-3): es un riesgo académico aceptado.
- **Apuntes subidos antes de la v1.7:** no se revisaron al subirlos.
