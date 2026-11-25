# ADR 0012 · IA responsable en el tutor: golden set con métricas, guardrails en capas, model card y marco legal

## Estado

Propuesto — 2026-11-25

## Contexto

Pluma, el tutor IA, responde a estudiantes de enseñanza básica y media, que son menores de edad. Hasta la v1.6, lo único que lo hacía "responsable" eran las reglas del prompt. Faltaban cuatro cosas:

- **No se medía la calidad.** Cada cambio en el RAG o en el prompt se probaba a mano, con un par de preguntas. No había forma de saber si un cambio mejoraba o empeoraba al tutor.
- **Los controles estaban sueltos.** Había reglas en el prompt, respuestas fijas sin LLM y RLS por colegio, pero nada impedía que el modelo recibiera datos personales ni que repitiera etiquetas internas del prompt. Esto último pasó en una prueba manual: apareció `<nociones>` en una respuesta.
- **Nadie había escrito qué es el sistema.** No estaba documentado qué modelo usa, para qué sirve, para qué no y qué riesgos tiene.
- **No estaba claro qué leyes aplican.** Los datos de menores son una categoría especial en la Ley 21.719, y en la UE la IA educativa puede ser de alto riesgo.

## Decisión

Tratar la IA responsable como **código que se prueba en CI y documentos versionados junto al código**:

1. **Golden set con métricas al estilo RAGAS** (`code/backend/eval/`): son 50 preguntas con el comportamiento esperado. Para la búsqueda se miden acierto@k, MRR y precisión de contexto; para la generación, la fidelidad (solo en modo `--live`). El modo determinista corre en `npm test`, así que una regresión bloquea el PR.
2. **Guardrails en capas** (`Documentos/ia/guardrails.md`):
   - **Entrada:** tope de preguntas, revisión de apuntes al subirlos y quitar RUT, correo y teléfono antes de llamar al modelo.
   - **Decisión:** respuestas fijas sin LLM cuando no hay información, y búsqueda limitada al curso.
   - **Salida:** quitar las etiquetas internas, también cuando llegan en streaming.
   - **Datos:** sin contenido en los logs, y purga de las conversaciones a fin de año.
3. **Model card** (`Documentos/ia/model-card.md`) con el uso previsto, los límites, los resultados del examen y los riesgos.
4. **Marco legal citado** (`Documentos/ia/marco-legal.md`): para cada norma, qué exige y qué control del sistema responde a eso.

## Consecuencias

**Gana:**

- Un cambio que rompe el glosario, la búsqueda o una protección hace fallar `npm test`. Se probó: con el filtro por asignatura apagado, 4 casos quedan en rojo.
- El modelo no recibe datos personales evidentes, aunque más adelante se cambie a un proveedor externo (hoy es Ollama local).
- Hay un documento que explica el sistema para la defensa, para los apoderados y para una futura evaluación de impacto.

**Pierde / se vuelve más difícil:**

- Las métricas son aproximaciones léxicas, sin un LLM juez. Detectan regresiones, pero no reemplazan una evaluación humana ni RAGAS con un modelo grande.
- El modo `--live` depende de Ollama y no corre en CI: hay que correrlo a mano antes de cambiar de modelo.
- La detección de datos personales usa patrones. Se escapa un dato escrito de forma rara ("mi rut es doce millones…") y, al revés, un número con formato de RUT dentro de una resta ("12345678-9") se reemplaza.

## Alternativas descartadas

- **RAGAS (la librería de Python) con un LLM juez en CI:** suma Python al pipeline, necesita un modelo grande (con costo, o de un proveedor externo) y da resultados distintos en cada corrida. Se deja como paso manual opcional.
- **Un clasificador de PII con NER (Presidio o spaCy):** detecta mejor, pero suma un servicio y un modelo más. Para los formatos chilenos que importan (RUT, teléfono y correo), los patrones bastan por ahora.
- **Un moderador de contenido con LLM (Llama Guard):** duplica el tiempo de cada respuesta en CPU. Las respuestas fijas sin LLM y el anclaje a los apuntes ya cubren el riesgo principal, que es inventar.

## Fecha

2026-11-25
