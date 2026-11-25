# Marco legal y normativo de la IA en FeathersForAll

Estado revisado al 25-11-2026. Este documento no es asesoría legal: mapea cada norma a los controles del sistema para la defensa del proyecto. Antes de usar el sistema con datos reales, debe revisarlo un abogado.

## Resumen

| Norma | Estado | Qué exige, en lo que nos toca | Cómo responde el sistema |
|---|---|---|---|
| **Constitución, art. 19 N° 4** (protección de datos como garantía, Ley 21.096 de 2018) | Vigente | Respetar la vida privada y los datos personales | Todo lo de abajo |
| **Ley 19.628**, sobre protección de la vida privada (1999) | Vigente hasta que rija la reforma | Tratar los datos solo para la finalidad para la que se recogieron | Las conversaciones solo sirven al estudiante (ADR 0008); los logs no guardan contenido |
| **Ley 21.719**, que regula la protección y el tratamiento de los datos personales y crea la Agencia de Protección de Datos Personales | Publicada el 13-12-2024; **entra en vigencia el 1-12-2026**. Hay un proyecto en trámite que la posterga al 15-10-2027 | Reescribe la Ley 19.628. Los datos de **niños, niñas y adolescentes** solo se tratan según su **interés superior** y su autonomía progresiva (art. 16 quáter); los de menores de 16 años, con el consentimiento de sus representantes legales. También exige minimización, finalidad, seguridad y transparencia | Ver «Ley 21.719 en detalle» |
| **Ley 21.430**, sobre garantías y protección integral de los derechos de la niñez y adolescencia (15-03-2022) | Vigente | Reconoce a niños y adolescentes el derecho a la vida privada y a la protección de sus datos personales, con el interés superior como principio | Datos mínimos, RLS por estudiante, purga anual, nada de perfilamiento |
| **Política Nacional de IA**, actualización 2024 (Decreto 12 del Ministerio de Ciencia, 11-04-2024) | Vigente (política, no ley) | Principios de ética, inclusión, transparencia y una IA al servicio de las personas | Model card, guardrails y respuestas que avisan cuando algo es una idea general |
| **Proyecto de ley que regula los sistemas de IA** (boletines 16821-19 y 15869-19) | En **segundo trámite** en el Senado (no es ley) | Clasifica los sistemas por riesgo, pide transparencia y crea un protocolo para reportar fallas o daños | Preparado: model card, inventario de guardrails, eval en CI y logs con `trace_id` para investigar incidentes |
| **Reglamento (UE) 2024/1689** (AI Act), Anexo III punto 3 | Vigente en la UE (no aplica en Chile; se usa como referencia) | Son de **alto riesgo** los sistemas que evalúan resultados de aprendizaje, deciden el acceso o el nivel, o vigilan exámenes | Pluma **no califica ni decide**. Las evaluaciones con IA solo se proponen y el docente decide; las notas las pone el docente. Así se queda fuera de esa categoría por diseño |
| **UNESCO**, Recomendación sobre la Ética de la IA (2021) | Marco internacional (Chile la adoptó) | Proporcionalidad, privacidad, supervisión humana, transparencia y explicabilidad | Humano en el ciclo (el docente), model card y límites de uso |

## Ley 21.719 en detalle (la que más pesa)

| Principio u obligación | Control en FeathersForAll | Evidencia |
|---|---|---|
| **Interés superior del NNA** (art. 16 quáter) | El tutor solo enseña la materia del curso: no perfila, no publicita y no evalúa. Hay un tope de uso por estudiante | `guardrails.md`, `tutor-limit.js` |
| **Minimización** | Las preguntas no se guardan en los logs. RUT, correo y teléfono no llegan al modelo. Las conversaciones se borran a fin de año | `guardrails.js`, `turn.js`, CronJob de purga |
| **Finalidad** | Las conversaciones solo las ve el estudiante: ni el docente ni el admin (RLS) | ADR 0008, `05_conversaciones_tutor.sql` |
| **Seguridad** | RLS por colegio, JWT, cifrado en tránsito vía Ingress y gates DevSecOps en CI | ADR 0007, ADR 0010, `threat-model.md` |
| **Transparencia** | La interfaz explica qué hace Pluma y cuánto tiempo se guardan las conversaciones; existe la model card | `TutorPage.jsx`, `model-card.md` |
| **Encargados de tratamiento** | El LLM corre local (Ollama): los datos no salen. Si se usa un proveedor externo, solo con datos sintéticos (regla del proyecto) hasta tener un contrato de encargado | `AGENTS.md`, `threat-model.md` I-4 |
| **Consentimiento de representantes (menores de 16)** | **Pendiente:** el sistema no lo gestiona. Debe resolverlo el colegio en la matrícula antes de usarlo con datos reales | — |

## Pendiente para usarlo con datos reales

1. Conseguir y registrar el consentimiento de los apoderados (Ley 21.719) y dar acceso a sus derechos (acceso, rectificación, supresión). La supresión ya existe para las conversaciones.
2. Hacer una evaluación de impacto en protección de datos antes de producción, por tratarse de datos de menores.
3. Firmar un contrato de encargado si el LLM o los embeddings pasan a un proveedor externo.
4. Seguir la tramitación de la ley de IA (16821-19) y de la postergación de la Ley 21.719.

## Fuentes

- Ley 21.719: [BCN Ley Chile](https://www.bcn.cl/leychile/navegar?idNorma=1209272) · [ficha del balance legislativo](https://www.bcn.cl/balance-legislativo/detalle/ficha_LEY_21719_2024-12-13) · [Cámara: comisión aprueba postergación (05-11-2026)](https://www.camara.cl/cms/2026/11/05/proteccion-de-datos-comision-aprobo-postergar-entrada-en-vigencia-de-la-ley/)
- Ley 21.430: [BCN Ley Chile](https://www.bcn.cl/leychile/navegar?idLey=21430)
- Política Nacional de IA, actualización 2024: [Decreto 12 en BCN](https://www.bcn.cl/leychile/navegar?idNorma=1210664)
- Proyecto de ley de IA: [tramitación, boletín 16821-19](https://www.camara.cl/legislacion/proyectosdeley/tramitacion.aspx?prmID=17429)
- AI Act, Anexo III: [AI Act Service Desk (Comisión Europea)](https://ai-act-service-desk.ec.europa.eu/es/ai-act/annex-3)
- UNESCO, Recomendación sobre la Ética de la IA (2021)
