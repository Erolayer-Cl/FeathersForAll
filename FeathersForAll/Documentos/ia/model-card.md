# Model card · Pluma, tutor IA de FeathersForAll

Formato basado en *Model Cards for Model Reporting* (Mitchell et al., 2019). Describe el **sistema** completo (modelo + RAG + reglas), no solo el LLM. Versión del sistema: API v1.7.

## 1. Detalles

| Campo | Valor |
|---|---|
| Qué es | Tutor conversacional que explica la materia de un curso usando los apuntes que sube su docente (RAG) |
| LLM | `qwen2.5:3b` vía Ollama, ejecutado localmente (`LLM_MODEL`). Temperatura 0,6 en la charla y 0,2 cuando responde con apuntes |
| Embeddings | `bge-m3` (1024 dimensiones) en pgvector, con búsqueda híbrida (vector + texto con índice GIN) |
| Recuperación | Top-4 fragmentos del curso, con similitud mínima de 0,5 (`RAG_TOP_K`, `RAG_MIN_SCORE`) |
| Componentes sin LLM | Calculadora exacta, glosario básico por asignatura (63 nociones) y respuestas fijas cuando no hay información |
| Responsables | Equipo FeathersForAll (taller AulaViva). Contacto: el docente del curso o el admin del colegio |
| Fecha | 25-11-2026 |

## 2. Uso previsto

- **Usuarios:** estudiantes de enseñanza básica y media de un colegio chileno, dentro de sus cursos.
- **Para qué:** repasar y entender los contenidos que subió el docente; resolver dudas puntuales; practicar con preguntas.
- **Fuera de alcance:**
  - Calificar o evaluar a un estudiante.
  - Decidir su acceso, nivel o promoción.
  - Dar orientación psicológica o médica.
  - Responder sobre temas fuera de los apuntes, salvo las nociones básicas del glosario.

  La IA de evaluaciones **solo propone** borradores; el docente revisa y guarda.

## 3. Factores y limitaciones conocidas

- **Modelo chico (3B), elegido para correr en CPU y sin enviar datos fuera:**
  - Explica peor que un modelo grande y puede equivocarse al parafrasear.
  - Se acota anclándolo a los apuntes y usando una temperatura baja.
- **Calidad del apunte:** si el apunte está mal, la respuesta también. Un PDF escaneado (sin texto) se rechaza.
- **Idioma:** solo español de Chile. Preguntas con faltas graves o en otro idioma recuperan peor.
- **Charla mezclada con materia** («hola, ¿en qué me puedes ayudar?»): se trata como pregunta de materia. Es una falla conocida del examen (`charla-09`).
- **Sin memoria entre cursos.** Cada conversación vive en su curso y se borra al terminar el año.

## 4. Evaluación

El golden set está en `code/backend/eval/tutor-examen.json`: 50 preguntas en 8 categorías (charla, con apuntes, fuera de los apuntes, cálculo, glosario por asignatura, curso sin apuntes, seguimiento y preguntas tramposas). Los apuntes de prueba son sintéticos.

| Corrida | Resultado | Búsqueda (estilo RAGAS) | Fidelidad |
|---|---|---|---|
| Determinista (`npm run eval`, en CI con `npm test`) — 25-11-2026 | 47/48 pasan (2 solo live; 1 falla conocida) | acierto@k 1,00 · MRR 1,00 · precisión de contexto 1,00 (17 casos) | — |
| Live (`npm run eval:live`, Ollama + `qwen2.5:3b` + `bge-m3`) | **Pendiente**: correr y guardar con `--guardar` | — | — |

El modo determinista usa un embedder falso que compara palabras, así que **no mide la calidad semántica**: mide que las reglas no se rompan. Las métricas de búsqueda salen en 1,00 porque los apuntes de prueba son pocos y distintos entre sí. El modo live es el que mide la calidad real. Detalle de las métricas: `eval/metricas.js` y `eval/README.md`.

## 5. Datos

- **Entrenamiento:** no se entrena ni se ajusta ningún modelo. Se usan los pesos públicos de Qwen2.5 y bge-m3.
- **Datos del proceso:**
  - Los apuntes del docente y las Bases Curriculares del Mineduc.
  - Las preguntas del estudiante. Se guardan solo en su conversación, que solo él ve, y nunca en los logs.
- **En desarrollo y en la demo solo se usan datos sintéticos.** Nunca datos reales de estudiantes con un proveedor de IA externo.

## 6. Consideraciones éticas y riesgos

| Riesgo | Mitigación | Riesgo residual |
|---|---|---|
| Inventar datos (alucinación) | Respuestas fijas sin LLM cuando no hay información; anclaje a los apuntes; calculadora exacta | Paráfrasis imprecisa dentro de un tema cubierto |
| Datos personales de menores | Se quitan RUT, correo y teléfono antes del modelo; logs sin contenido; RLS; purga anual | Datos escritos de forma no estándar |
| *Prompt injection* desde un apunte | Revisión al subir y apuntes delimitados como datos en el prompt | Formulaciones nuevas que no calzan con los patrones |
| Que haga la tarea por el estudiante | El prompt pide pistas y pasos, no la respuesta final | Un modelo chico no siempre lo respeta |
| Dependencia o uso excesivo | Tope de 10 preguntas por minuto y 100 por hora | — |
| Sesgo del modelo base | Respuestas acotadas a los apuntes del docente | El estilo y los ejemplos del modelo |
| Transparencia | La interfaz dice «Pluma responde solo con los apuntes que subió tu docente» y aclara cuando algo es una idea general | — |

Controles: [guardrails.md](guardrails.md). Marco legal: [marco-legal.md](marco-legal.md). Decisión: [ADR 0012](../adr/0012-ia-responsable.md).

## 7. Antes de cambiar el modelo o el prompt

1. Correr `npm run eval:live` con el modelo actual y guardar `--guardar`, si no hay punto de comparación.
2. Hacer el cambio y volver a correrlo: no debe empeorar ningún caso y la fidelidad no debe bajar.
3. Actualizar la tabla de la sección 4 y la versión.
