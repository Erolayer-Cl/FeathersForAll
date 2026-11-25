# Examen del tutor

50 preguntas con lo que se espera de cada una, para saber si un cambio mejoró o empeoró al tutor.

## Cómo correrlo

| Comando | Qué hace |
|---|---|
| `npm run eval` | Modo **determinista**: sin Ollama ni base. Usa un embedder falso (compara palabras exactas). |
| `npm run eval -- --guardar` | Guarda el resultado como punto de comparación (`baseline.json`). |
| `npm run eval -- --solo="cálculo"` | Una sola categoría. `--json` imprime el resultado en JSON. |
| `npm run eval:live` | Modo **live**: con Ollama (embeddings y modelo reales). Compara con `baseline-live.json`. |

Sale con código 1 si hay una pregunta que falla (y no está marcada como conocida) o si alguna que antes pasaba ahora falla.
El modo determinista también corre dentro de `npm test` (`test/examen.test.js`).

## Qué revisa

Por cada pregunta: el tipo de turno (`chat`, `grounded`, `basic`, `no-info`, `no-notes`), la fuente citada, lo que debe (o no) llevar el prompt del sistema y, en modo live, lo que dice la respuesta.
Los apuntes de prueba están en `apuntes/` y son sintéticos.

## Métricas al estilo RAGAS (`metricas.js`)

| Métrica | Mide | Modo |
|---|---|---|
| acierto@k | ¿El apunte esperado está entre los fragmentos que ve el modelo? | determinista y live |
| MRR | 1 / posición del apunte esperado | determinista y live |
| precisión de contexto | Qué parte de los fragmentos viene del apunte esperado | determinista y live |
| fidelidad | Qué parte de las oraciones de la respuesta se apoya en el contexto (palabras de contenido) | solo live |

Son aproximaciones sin LLM juez, para que den el mismo número en CI. `--guardar` también guarda las métricas en el baseline. En modo determinista salen altas porque los apuntes de prueba son pocos; el número que importa para la calidad es el del modo live.

## Límites (importante)

- El modo determinista **no mide la calidad de las respuestas ni la búsqueda semántica**: detecta que las reglas (turnos, glosario, apuntes, protecciones del prompt) no se rompan.
- Los casos con `solo_live` (paráfrasis, relleno que baja la similitud) se omiten en modo determinista y se avisa cuál.
- Un caso con `conocido` es una falla reconocida y explicada: no cuenta como error, pero si empieza a pasar el informe avisa para quitar la marca.
- El modo live no se pudo probar al construirlo (no había Ollama): córrelo una vez y guarda su baseline con `--guardar`.

## Agregar una pregunta

Añade un objeto en `tutor-examen.json` (`id` único, `categoria`, `curso`, `pregunta`, `esperado`). El validador rechaza casos mal escritos. Mantén el total entre 40 y 50.
