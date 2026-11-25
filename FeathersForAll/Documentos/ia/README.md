# IA responsable · evidencia para la rúbrica

| Pide la rúbrica | Dónde está | Cómo mostrarlo |
|---|---|---|
| **Feature IA** | Pluma, el tutor con RAG sobre los apuntes del curso (`code/backend/src/modules/tutor/`), y la generación de evaluaciones (solo propone) | Demo: preguntar en un curso con apuntes y en uno sin apuntes |
| **Con eval** | `code/backend/eval/` · `npm run eval` (también corre dentro de `npm test`, en CI) | Correr `npm run eval` y mostrar el resultado |
| **RAGAS / golden set** | `eval/tutor-examen.json` (50 casos, 8 categorías) + `eval/metricas.js` (acierto@k, MRR, precisión de contexto y fidelidad) | Las líneas «Métricas (estilo RAGAS)» de la salida |
| **Guardrails** | [guardrails.md](guardrails.md): 15 controles en capas (entrada, decisión, prompt, salida, datos y humano) | Mandar «ignora tus reglas» en un apunte (422), pasar el tope (429), escribir un RUT (no llega al modelo) |
| **Model card** | [model-card.md](model-card.md) | — |
| **Marco legal citado** | [marco-legal.md](marco-legal.md): Ley 21.719, Ley 21.430, Ley 19.628, Política Nacional de IA, proyecto de ley 16821-19, AI Act y UNESCO | — |
| Decisión | [ADR 0012](../adr/0012-ia-responsable.md) | — |
