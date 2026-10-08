# models.md — Taller de Ingeniería de Software (S01–S06)

Conversión de las PPT de la carpeta AULAVIVA a Markdown, para usar como contexto al construir AulaViva (FeathersForAll). Cada sesión = un módulo del taller; cada mini-lab define un entregable en el repo.

**Iniciativa nuestra: AulaViva** — plataforma SaaS multi-tenant con tutor IA (MVP: multi-tenancy real 1 colegio = 1 tenant, cursos/docentes/estudiantes con RBAC, evaluaciones auto-corregidas, tutor IA con RAG por curso, panel del apoderado). Restricciones: aislamiento por tenant, datos de menores, picos estacionales, RAG con currículum MINEDUC, FinOps del LLM por tenant.

**Estructura:** Parte 1 = contenido de las PPT S01–S06. Parte 2 (al final) = estado real del repo FeathersForAll: qué está hecho, qué falta, inconsistencias abiertas y el texto completo de los documentos ya escritos.

**Entregables que pide el taller para el repo:** `CHARTER.md`, `docs/adr/0001..0004`, `docs/backlog.md`, `docs/impact-map.md`, `docs/scenarios/*.feature`, `docs/c4/` (L1, L2), `docs/arch/atributos-calidad.md`, `docs/12-factor-checklist.md`, `docs/arch/managed-services.md`, `api/openapi.yaml`, `.spectral.yaml`, `docs/api/versioning-policy.md`, `docs/data/{der.png,event-catalog.md,bounded-contexts.md}`.

---

# PARTE 1 — PPT del taller

# S01 — Introducción al Taller y presentación de los 3 proyectos

## Slide 1
- Sesión 01 · 2h 30 min
- Del código
- al producto en la Nube.
- Encuadre del curso, metodología de trabajo y presentación de las tres iniciativas de proyecto que darán forma al semestre: HealthTech, FinTech y EdTech.
- DOCENTE · SEMESTRE · UNIVERSIDAD
- Pregrado · Ingeniería de Software Avanzada
- MÓDULO
- 01
- de 18 sesiones
- BLOQUE
- Fundamentos

## Slide 2
- Agenda
- Qué haremos hoy
- 01
- Encuadre del curso
- Objetivos, resultados de aprendizaje y filosofía del taller. · 20 min
- 02
- Malla de 18 sesiones
- Bloques temáticos y cómo se conectan al proyecto final. · 20 min
- 03
- Metodología y ritmo semanal
- Estructura de cada sesión: teoría, caso, mini-lab, retro. · 15 min
- 04
- Las 3 iniciativas de proyecto
- HealthTech · FinTech · EdTech. Cada equipo elige una. · 45 min
- 05
- Formación de equipos y evaluación
- Roles, entregables, rúbrica y política de IA. · 20 min
- 06
- Mini-lab: Charter del equipo
- Primer artefacto: acta del equipo + elección de iniciativa. · 30 min
- DURACIÓN TOTAL DE LA SESIÓN · 2 h 30 min · incluye 10 min de descanso y 10 min de retrospectiva

## Slide 3
- Encuadre
- Este no es un curso de código. Es un curso de decisiones.
- En 18 sesiones vamos a llevar una idea desde una hoja en blanco hasta un producto desplegado en la nube, con IA integrada y protegido bajo prácticas DevSecOps.
- Cada semana ustedes tomarán decisiones que un ingeniero de software real toma: qué arquitectura elegir, qué probar, qué automatizar, qué NO construir y cómo defender lo construido.
- PROMESA DEL CURSO
- Al finalizar podrás
- Diseñar la arquitectura de un sistema en la nube y justificarla frente a stakeholders.
- Integrar componentes de IA (LLM, RAG, ML) de forma responsable y observable.
- Operar un pipeline CI/CD con controles de seguridad automatizados.
- Presentar tu producto ante un panel evaluador simulando un comité técnico.

## Slide 4
- Resultados de aprendizaje
- Cinco competencias que serás capaz de demostrar

| RA | COMPETENCIA | EVIDENCIA DE LOGRO | SESIONES ASOCIADAS |
|---|---|---|---|
| 01 | Diseñar arquitectura en la Nube aplicando patrones y ADRs. | Diagrama C4 (contexto, contenedor, componente) + registro de decisiones arquitectónicas. | S03, S04, S06, S16 |
| 02 | Integrar componentes de IA en un producto de software. | Feature con LLM/RAG evaluada con métricas y guardrails documentados. | S13, S14 |
| 03 | Automatizar la entrega con CI/CD y GitOps. | Pipeline funcional con quality gates y despliegue a ambiente productivo simulado. | S07, S08 |
| 04 | Aplicar DevSecOps con controles automatizados de seguridad. | SAST, SCA, secretos, DAST y firma de artefactos integrados y evidenciados. | S09, S10 |
| 05 | Operar con calidad y resiliencia: pruebas, observabilidad, FinOps. | Dashboards + SLOs + reporte de costo del ambiente. | S11, S12, S15, S16 |

## Slide 5
- Roadmap del semestre
- 18 sesiones · 6 bloques · 1 proyecto
- Bloque A · Fundamentos
- Bloque B · Diseño y datos
- Bloque C · Nube y automatización
- Bloque D · DevSecOps
- Bloque E · Calidad e IA
- HILO CONDUCTOR
- Cada sesión aporta 1 artefacto al proyecto
- El proyecto no se construye en la S17: se construye desde la S02 con entregas incrementales verificables.
- Bloque F · Operación y cierre

## Slide 6
- Metodología
- Cómo se estructura cada sesión de 2h 30 min

| TIEMPO | MOMENTO | PROPÓSITO | ENTREGABLE / EVIDENCIA |
|---|---|---|---|
| 20 min | Warm-up | Repaso corto del bloque anterior + conexión con la sesión de hoy. | Preguntas de checkpoint respondidas en pizarra. |
| 50 min | Contenido teórico | Marcos, patrones y decisiones. Multi-stack: Python · Node · Java. | Apuntes del equipo (notas Markdown en el repo). |
| 15 min | Descanso | Pausa activa. | — |
| 30 min | Caso de uso demo | El docente resuelve un caso guía sobre una de las 3 iniciativas. | Repositorio de ejemplos actualizado. |
| 25 min | Mini-lab del equipo | Cada equipo aplica lo aprendido a SU proyecto. | Artefacto entregable del día (PR o documento). |
| 10 min | Retrospectiva | ¿Qué aprendimos? ¿Qué bloquea al equipo? Próximos pasos. | Checkbox de logros en el board del equipo. |

- Regla del taller · Todo lo que se enseña se aplica al proyecto la misma semana. No hay teoría sin evidencia.

## Slide 7
- Iniciativa 1 de 3
- MediTriage — Triage clínico asistido por IA
- Contexto del negocio
- Red de centros de atención primaria necesita reducir tiempos de espera en urgencias. Se busca una plataforma que priorice pacientes en la sala de espera usando IA sobre síntomas reportados, historia clínica y signos vitales, respetando la normativa chilena de datos sensibles (Ley 19.628 y Ley 21.719).
- Alcance mínimo del producto (MVP)
- Registro de paciente con validación de RUT y consentimiento informado.
- Formulario de síntomas + captura de signos vitales.
- Motor IA que sugiere categoría ESI (1–5) y explica el porqué.
- Tablero para personal médico con priorización dinámica.
- Trazabilidad y audit log de cada recomendación IA.
- RESTRICCIONES DE INGENIERÍA
- Lo que hace especial a este proyecto
- Datos sensibles: cifrado en reposo y tránsito obligatorio; PII enmascarada en logs.
- Explicabilidad: el modelo debe justificar cada priorización.
- Alta disponibilidad: 99.5% mensual; sin caídas críticas en horario diurno.
- Auditoría: cada decisión IA queda registrada e inmutable por 5 años.
- Latencia: respuesta de triage < 3 s desde el envío del formulario.
- USUARIOS OBJETIVO
- Paciente · Enfermera de triage · Médico jefe de turno · Auditor clínico.

## Slide 8
- Iniciativa 2 de 3
- CrediScore — Scoring crediticio y detección de fraude
- Contexto del negocio
- Una fintech chilena de microcréditos quiere automatizar la evaluación de solicitudes en menos de 60 segundos, combinando scoring por ML con detección de fraude en tiempo real. Debe cumplir con la normativa de la CMF y considerar los principios del sistema de Finanzas Abiertas.
- Alcance mínimo del producto (MVP)
- Onboarding digital con validación de identidad (KYC).
- Motor de scoring crediticio basado en ML supervisado.
- Detección de fraude en tiempo real por reglas + modelo.
- Backoffice para analistas con re-evaluación humana.
- API pública versionada para partners comerciales.
- RESTRICCIONES DE INGENIERÍA
- Lo que hace especial a este proyecto
- Latencia extrema: decisión de crédito < 60 s p95.
- Event-driven: eventos de fraude propagados en < 500 ms.
- Fairness: el modelo no puede discriminar por género o comuna.
- Idempotencia: pagos y solicitudes deben ser reintenables sin duplicar.
- Cumplimiento: trazabilidad para auditoría CMF.
- USUARIOS OBJETIVO
- Solicitante · Analista de riesgo · Oficial de fraude · Partner API · Compliance.

## Slide 9
- Iniciativa 3 de 3
- AulaViva — Plataforma SaaS multi-tenant con tutor IA
- Contexto del negocio
- Un grupo de colegios de la Región Metropolitana busca modernizar su experiencia de aprendizaje ofreciendo a docentes y estudiantes una plataforma SaaS multi-tenant con contenidos, evaluaciones automáticas y un tutor IA que responde en el contexto del curriculum vigente del MINEDUC.
- Alcance mínimo del producto (MVP)
- Multi-tenancy real: 1 colegio = 1 tenant aislado lógicamente.
- Gestión de cursos, docentes y estudiantes con RBAC.
- Evaluaciones auto-corregidas con feedback.
- Tutor IA con RAG sobre los apuntes de cada curso.
- Panel del apoderado con seguimiento de avance.
- RESTRICCIONES DE INGENIERÍA
- Lo que hace especial a este proyecto
- Multi-tenant: aislamiento de datos y personalización por tenant.
- Datos de menores: política especial de privacidad y consentimiento parental.
- Estacionalidad: picos brutales en periodo de pruebas — escalabilidad horizontal.
- RAG con contexto curricular: respuestas dentro del programa MINEDUC.
- Costos: optimización FinOps del uso de LLM por tenant.
- USUARIOS OBJETIVO
- Estudiante · Docente · Coordinador académico · Apoderado · Sostenedor.

## Slide 10
- Evaluación y equipos
- Cómo se evalúa y cómo se organizan
- Estructura de calificación

| COMPONENTE | PESO |
|---|---|
| Mini-labs semanales (14 entregables) | 30% |
| Hitos parciales (S06, S12, S17) | 25% |
| Defensa final del proyecto (S18) | 30% |
| Coevaluación y participación | 10% |
| Documentación y ADRs | 5% |

- Nota mínima de aprobación: 4.0 · Se exige entrega funcional del proyecto para aprobar.
- EQUIPOS DE TRABAJO
- 4 a 5 personas · roles rotativos
- Product Owner: prioriza backlog y valida el valor.
- Tech Lead: custodio de la arquitectura y ADRs.
- DevSecOps Lead: pipelines, seguridad, observabilidad.
- AI/Data Lead: features de IA/ML y sus métricas.
- QA Lead: estrategia de pruebas y calidad.
- POLÍTICA DE USO DE IA
- El uso de IA generativa está permitido y esperado. Toda contribución IA debe estar declarada en el commit message y auditada por el equipo. Copiar sin comprender penaliza.

## Slide 11
- Mini-lab de la sesión · 30 min
- Charter del equipo + elección de iniciativa
- Equipo formado (4–5 personas).
- Cuenta GitHub organización del taller.
- Haber leído las 3 fichas de iniciativa.
- Discutir los 3 proyectos y elegir uno por consenso.
- Asignar roles iniciales (PO, Tech Lead, DevSecOps, AI/Data, QA).
- Redactar el Charter: misión del equipo, valores, reglas de trabajo, canal de comunicación, cadencia de reuniones.
- Definir Definition of Done preliminar del equipo.
- Crear repositorio equipo-XX-<iniciativa> con README.md, CHARTER.md y docs/adr/.
- Levantar el board (Issues + Project) con las 6 columnas Kanban.
- Prerrequisitos
- Pasos
- Un Pull Request al repo del taller con:
- CHARTER.md con secciones: propósito, integrantes, roles, DoD, política de IA, canal Slack.
- docs/adr/0001-eleccion-iniciativa.md — decisión arquitectónica de por qué eligieron esa iniciativa.
- Board Kanban configurado y con al menos 3 issues iniciales.
- Formato ADR: Título · Contexto · Decisión · Consecuencias · Fecha · Autores.
- Entregable
- RÚBRICA · 100 PUNTOS

| Charter claro y completo | 30 |
|---|---|
| Roles asignados y justificados | 15 |
| ADR 0001 bien argumentada | 25 |
| Board Kanban operativo | 15 |
| Política de IA declarada | 10 |
| Puntualidad de la entrega | 5 |

- Deadline: antes del inicio de la S02.

## Slide 12
- Cierre y próximos pasos
- Nos vemos
- en la S02.
- Compromisos hasta la próxima clase
- Entregar el Charter del equipo vía PR.
- Leer 1 caso real de la iniciativa elegida (paper, post, whitepaper).
- Preparar 2 preguntas o dudas para el arranque de la S02.
- Instalar el toolkit base: Git, Docker Desktop, VS Code, Node/Python/Java.
- Ingeniería de requisitos
- y user stories
- Del problema a la primera user story. Product Discovery, Impact Mapping y criterios INVEST aplicados a tu iniciativa.

---

# S02 — Ingeniería de requisitos y user stories

## Slide 1
- Sesión 02 · 2h 30 min
- Del problema a
- la primera historia.
- Ingeniería de requisitos, Product Discovery, Impact Mapping y user stories con criterios INVEST y Gherkin. Cada equipo entrega hoy su primer backlog.
- BLOQUE A · FUNDAMENTOS
- Requisitos → Backlog → Criterios de aceptación
- MÓDULO
- 02
- de 18 sesiones
- BLOQUE
- Fundamentos

## Slide 2
- Agenda
- Cómo se distribuyen las 2h 30 min
- 01
- Warm-up y check-in
- Revisión del Charter entregado + dudas. · 20 min
- 02
- Product Discovery
- Dual-track agile: descubrimiento vs. entrega. · 25 min
- 03
- Impact Mapping
- Del objetivo de negocio al deliverable. · 25 min
- 04
- User stories INVEST + Gherkin
- Escribir historias que se puedan entregar. · 30 min
- 05
- Caso demo: MediTriage
- Ingreso del paciente y su primera user story. · 20 min
- 06
- Mini-lab del equipo + retro
- Backlog inicial con 5 historias. · 30 min
- INCLUYE 15 MIN DE DESCANSO Y 5 MIN DE RETROSPECTIVA · TOTAL 150 MIN

## Slide 3
- Objetivos de la sesión
- Al terminar esta clase serás capaz de…
- OBJETIVO 01
- Diagnosticar el problema
- Diferenciar necesidad, síntoma y solución. Aplicar Discovery para entender el "por qué" antes del "qué".
- OBJETIVO 02
- Modelar impactos
- Construir un Impact Map que conecte el objetivo de negocio con entregables concretos del equipo.
- OBJETIVO 03
- Escribir historias INVEST
- Redactar user stories independientes, negociables, valiosas, estimables, pequeñas y testeables.
- OBJETIVO 04
- Especificar con Gherkin
- Escribir criterios de aceptación Given–When–Then que sirvan como base de pruebas automatizadas.
- OBJETIVO 05
- Construir un backlog inicial
- Priorizar historias en un backlog de tu iniciativa, listo para la S03.
- ENTREGABLE DEL DÍA
- docs/backlog.md con 5 historias INVEST + criterios Gherkin. PR aprobado antes de la S03.

## Slide 4
- Product discovery
- Descubrir antes de construir
- Dual-Track Agile
- Dos flujos que corren en paralelo dentro del equipo:
- Entrevistas, prototipos, validación de hipótesis. Se responde ¿qué construir?
- Sprints, código, deploy. Se responde ¿cómo construirlo bien?
- Los 4 riesgos que Discovery mitiga
- Valor: ¿el usuario lo comprará o adoptará?
- Usabilidad: ¿podrá usarlo sin ayuda?
- Factibilidad: ¿podemos construirlo con nuestro stack?
- Viabilidad: ¿es sostenible para el negocio?
- Discovery Track
- Delivery Track
- TÉCNICAS DE DESCUBRIMIENTO
- Herramientas del equipo

| Entrevistas problema | 5-8 usuarios, sin proponer solución. |
|---|---|
| Journey Map | Recorrido del usuario, emociones y dolores. |
| Jobs to be Done | Qué "trabajo" el usuario contrata al producto. |
| Prototipos low-fi | Wireframes o Figma en 1 día. |
| Assumption Mapping | Riesgo × evidencia. Priorizar qué validar. |

- Regla: ninguna user story entra al backlog sin haber pasado por al menos 1 técnica de Discovery.

## Slide 5
- Impact mapping
- Del objetivo de negocio al entregable
- Una técnica visual de Gojko Adzic para responder 4 preguntas encadenadas que conectan la estrategia con el software que construimos.
- Goal (Objetivo)
- ¿POR QUÉ?
- CrediScore: reducir tiempo de aprobación de crédito de 3 días a < 60 s.
- ¿QUIÉN?
- Actors
- Solicitante, Analista de riesgo, Oficial de fraude, Partner API.
- ¿CÓMO?
- Impacts
- El analista deja de revisar solicitudes de bajo riesgo. El solicitante recibe respuesta inmediata.
- ¿QUÉ?
- Deliverables
- Motor de scoring ML, dashboard de re-evaluación, API pública versionada.
- Regla de oro del Impact Map
- Todo entregable (Deliverable) debe apuntar a un impacto medible en un actor concreto que a su vez contribuya al goal. Si no puedes trazar esa línea, borra el entregable.

## Slide 6
- User stories
- INVEST: seis pruebas para una historia sana
- Formato base
- Como [rol / persona]
- quiero [capacidad concreta]
- para [beneficio medible].
- Ejemplo bueno · AulaViva
- Como docente de un curso,
- quiero generar una evaluación auto-corregida desde mis apuntes,
- para reducir el tiempo de corrección en 80%.

| LETRA | ATRIBUTO | PREGUNTA GUÍA |
|---|---|---|
| I | Independent | ¿Se puede entregar sin depender de otra historia? |
| N | Negotiable | ¿Es una conversación, no un contrato cerrado? |
| V | Valuable | ¿Entrega valor a un usuario o al negocio? |
| E | Estimable | ¿El equipo puede estimar el esfuerzo? |
| S | Small | ¿Cabe en un sprint (idealmente 2-3 días)? |
| T | Testable | ¿Se puede verificar objetivamente con criterios? |

- Anti-patrón: historias tipo "implementar login". Sin rol, sin valor, no testeable. Rechazadas en refinamiento.

## Slide 7
- Criterios de aceptación
- Gherkin: Given · When · Then
- Anatomía de un escenario

| Given | Precondición o estado inicial del sistema. |
|---|---|
| When | Acción que dispara el usuario o sistema. |
| Then | Resultado observable y verificable. |
| And / But | Encadenar condiciones o resultados adicionales. |

- Buenas prácticas
- Un escenario = una regla de negocio.
- Lenguaje del dominio, no técnico.
- Escenarios cortos: 3-7 líneas.
- Evita escenarios felices sin bordes ni errores.
- 3 escenarios por historia como mínimo: feliz, borde, error.
- Ejemplo · MediTriage
```gherkin
# Historia: priorización ESI del paciente
Feature: Triage clínico asistido

  Scenario: Paciente con dolor torácico intenso
    Given un paciente ingresado con dolor torácico
    And presión arterial mayor a 180/110
    When el motor IA evalúa el caso
    Then se asigna categoría ESI "1"
    And se notifica al médico jefe en menos de 5s
    And queda registrado en el audit log

  Scenario: Consulta de rutina sin síntomas graves
    Given un paciente con dolor de garganta leve
    When el motor IA evalúa el caso
    Then se asigna categoría ESI "4"
    And se muestra tiempo estimado de espera

  Scenario: Fallo del modelo IA
    Given un paciente ingresado
    When el motor IA no responde en 3s
    Then el caso se enruta a triage manual
    And se genera alerta al equipo de plataforma
```

## Slide 8
- Caso de uso · MediTriage
- Del contexto a la primera user story
- Goal: reducir el tiempo de priorización del triage de 25 min a < 3 min.
- Actor: enfermera de triage.
- Impacto: la enfermera obtiene una sugerencia ESI que valida en 30 s.
- Deliverable: pantalla de sugerencia IA con justificación.
- Como enfermera de triage,
- quiero ver una sugerencia ESI justificada al ingresar los signos vitales,
- para priorizar al paciente en menos de 3 minutos.
- Story points: 5 · Sprint: 1 · Riesgo: modelo IA aún no entrenado (Discovery en paralelo).
- Paso 1 · Impact Map (extracto)
- Paso 2 · User story INVEST
- Paso 3 · Estimación
- CRITERIOS DE ACEPTACIÓN
- 3 escenarios Gherkin
```gherkin
Scenario: Sugerencia con datos completos
  Given signos vitales ingresados
  And síntomas registrados
  When se solicita evaluación IA
  Then se muestra ESI y justificación
  And el tiempo total es < 3 s

Scenario: Datos incompletos
  Given signos vitales faltantes
  When se solicita evaluación IA
  Then se solicita completar campos
  And no se emite sugerencia

Scenario: Modelo no disponible
  Given el motor IA está caído
  When se solicita evaluación
  Then se enruta a triage manual
  And se registra el fallo en logs
```

## Slide 9
- Mini-lab de la sesión · 30 min
- Backlog inicial · 5 historias INVEST
- Charter del equipo aprobado (S01).
- Iniciativa elegida (HealthTech / FinTech / EdTech).
- Repositorio del equipo con carpeta docs/.
- Identificar 2 actores clave y 1 objetivo de negocio.
- Construir un Impact Map (goal → actor → impact → deliverable).
- Extraer 5 user stories priorizadas del map.
- Aplicar checklist INVEST a cada historia.
- Escribir 3 escenarios Gherkin por historia (feliz, borde, error).
- Priorizar el backlog con MoSCoW.
- Crear PR con docs/backlog.md.
- Prerrequisitos
- Pasos
- PR al repo del equipo con:
- docs/impact-map.md — mapa con goal, actores, impactos, entregables.
- docs/backlog.md — 5 historias en formato INVEST.
- docs/scenarios/*.feature — 15 escenarios Gherkin (3 × 5).
- Priorización MoSCoW en backlog.md.
- Formato Gherkin: archivo .feature por historia.
- Entregable
- RÚBRICA · 100 PUNTOS

| Impact Map coherente | 20 |
|---|---|
| 5 historias cumplen INVEST | 25 |
| Escenarios Gherkin claros y completos | 25 |
| Priorización MoSCoW justificada | 15 |
| Trazabilidad Goal → Historia | 10 |
| Puntualidad y calidad del PR | 5 |

- Deadline: antes del inicio de la S03.

## Slide 10
- Cierre y próximos pasos
- Con backlog
- llegamos a la S03.
- Compromisos hasta la próxima clase
- Entregar el backlog inicial con 5 historias INVEST + Gherkin.
- Priorizar con MoSCoW y publicar el board del sprint 0.
- Traer 3 preguntas sobre arquitectura para la S03.
- Leer sobre el modelo C4 (c4model.com) antes de la clase.
- Arquitectura de software
- y modelo C4
- Del backlog al diagrama. Estilos arquitectónicos, C4 (contexto y contenedor), atributos de calidad y ADRs aplicados a CrediScore.

---

# S03 — Arquitectura de software y modelo C4

## Slide 1
- Sesión 03 · 2h 30 min
- Arquitectura:
- decisiones dibujadas.
- Estilos arquitectónicos, modelo C4 de Simon Brown, atributos de calidad y ADRs. Del backlog al primer diagrama de sistema.
- BLOQUE B · DISEÑO Y DATOS
- Del backlog al diagrama · Decisiones justificadas
- MÓDULO
- 03
- de 18 sesiones
- BLOQUE
- Diseño

## Slide 2
- Agenda
- Cómo se distribuyen las 2h 30 min
- 01
- Warm-up: revisión de backlogs
- Feedback cruzado entre equipos. · 20 min
- 02
- Estilos arquitectónicos
- Monolito modular, micros, serverless, event-driven. · 30 min
- 03
- Modelo C4
- Los 4 niveles y cómo se comunican con stakeholders. · 30 min
- 04
- Atributos de calidad
- Performance, seguridad, mantenibilidad, escalabilidad. · 20 min
- 05
- ADRs y caso CrediScore
- Del atributo a la decisión documentada. · 20 min
- 06
- Mini-lab: C4 nivel 1 y 2
- Cada equipo dibuja su arquitectura. · 30 min
- INCLUYE 15 MIN DE DESCANSO Y 5 MIN DE RETROSPECTIVA · TOTAL 150 MIN

## Slide 3
- Objetivos de la sesión
- Al terminar esta clase serás capaz de…
- OBJETIVO 01
- Elegir un estilo
- Comparar monolito modular, microservicios, serverless y event-driven; elegir con criterios.
- OBJETIVO 02
- Dibujar con C4
- Producir diagramas nivel 1 (Contexto) y nivel 2 (Contenedor) de un sistema.
- OBJETIVO 03
- Priorizar atributos
- Traducir requisitos no funcionales (performance, seguridad, escalabilidad) en decisiones concretas.
- OBJETIVO 04
- Documentar con ADRs
- Escribir Architecture Decision Records que sobreviven al equipo original.
- OBJETIVO 05
- Defender tu arquitectura
- Explicar y justificar tu diseño ante un panel técnico.
- ENTREGABLE DEL DÍA
- docs/c4/ con diagramas nivel 1 y 2 + docs/adr/0002-estilo-arquitectonico.md.

## Slide 4
- Estilos arquitectónicos
- No hay "mejor". Hay "adecuado".

| ESTILO | CUÁNDO LO ELIGES | FORTALEZA | COSTO REAL |
|---|---|---|---|
| Monolito modular | Equipo < 15 personas, dominio no del todo maduro, MVP. | Simple de operar, transacciones ACID naturales, deploy único. | Escalabilidad acoplada, deploys grandes, riesgo de "big ball of mud". |
| Microservicios | Dominio maduro con bounded contexts claros, múltiples equipos. | Escalado independiente, ownership por equipo, resiliencia por bulkhead. | Complejidad operacional alta, red como single point of failure, consistencia eventual. |
| Serverless (FaaS) | Cargas puntuales, cron jobs, integraciones ligeras. | Costo por uso, escalado automático, cero servidores que operar. | Vendor lock-in, cold starts, límites de tiempo/tamaño, debugging complejo. |
| Event-driven | Sistemas asíncronos, workflows largos, integración entre dominios. | Desacoplamiento máximo, procesamiento asíncrono, replay de eventos. | Difícil rastrear el flujo, exige idempotencia, orden y at-least-once delivery. |
| Modular monolith → μsvc | Ruta pragmática: empezar simple, extraer módulos cuando duele. | Descubrimiento de bounded contexts sin premature distribution. | Disciplina de módulos: si el monolito no es realmente modular, la extracción es dolorosa. |

- Ley de Conway · "Los sistemas reflejan la estructura de comunicación de la organización que los diseña." Elige el estilo que tu equipo pueda operar.

## Slide 5
- Modelo C4 · Simon Brown
- Zoom progresivo: 4 niveles, 1 sistema
- C4 es un lenguaje de diagramas que hace zoom progresivo: cada nivel expande una caja del anterior. Igual que Google Maps: país → ciudad → barrio → calle.
- L1
- Contexto
- El sistema como una caja, sus usuarios y sistemas externos con los que dialoga.
- Audiencia: todos (negocio, técnico).
- L2
- Contenedor
- Aplicaciones y almacenes de datos que componen el sistema (SPA, API, DB, worker, broker).
- Audiencia: equipo técnico y devops.
- L3
- Componente
- Dentro de un contenedor, los módulos / packages / servicios internos y cómo se conectan.
- Audiencia: desarrolladores del contenedor.
- L4
- Código
- Diagrama de clases / entidades del componente. Se genera automáticamente y suele omitirse.
- Audiencia: devs del componente.
- Regla del taller: entregar SIEMPRE L1 y L2. L3 solo para componentes críticos. L4 rara vez es útil.

## Slide 6
- Atributos de calidad
- La arquitectura sirve a los NFRs
- Los requisitos funcionales dicen qué hace el sistema. Los atributos de calidad dicen cómo bien lo hace. La arquitectura se elige para servir a estos, no para lucirse.

| ATRIBUTO | MÉTRICA TÍPICA | IMPACTO EN LA ARQUITECTURA |
|---|---|---|
| Performance | Latencia p95, throughput RPS | Caching, colas asíncronas, sharding, lecturas replicadas. |
| Escalabilidad | Usuarios concurrentes, elasticidad | Stateless, autoscaling horizontal, particionamiento de datos. |
| Disponibilidad | SLA/SLO (99.5%, 99.95%) | Redundancia, multi-AZ, health checks, circuit breakers. |
| Seguridad | OWASP Top 10, CVEs, tiempo de respuesta a incidente | Zero-trust, cifrado end-to-end, IAM granular, segmentación de red. |
| Mantenibilidad | Lead time, MTTR, cambio de contexto | Módulos con fronteras claras, testabilidad, documentación viva. |
| Observabilidad | Cobertura de logs/métricas/traces | Structured logging, OpenTelemetry, correlation IDs. |
| Costo | USD por transacción, USD/mes | Serverless para tráfico irregular, rightsizing, spot instances. |

## Slide 7
- Architecture Decision Records
- ADRs: memoria arquitectónica del equipo
- Estructura mínima de un ADR

| Título | Frase corta descriptiva (ej. "0002-Elección de estilo arquitectónico"). |
|---|---|
| Estado | Propuesto · Aceptado · Reemplazado · Deprecado. |
| Contexto | Qué problema estamos resolviendo, qué fuerzas están en juego. |
| Decisión | Qué elegimos, en una oración. |
| Consecuencias | Qué gana, qué pierde y qué se vuelve más difícil. |
| Alternativas | Qué otras opciones evaluamos y por qué se descartaron. |

- Reglas del taller: 1 archivo Markdown por ADR en docs/adr/, numerados. Un ADR nunca se edita: se marca como reemplazado y se crea uno nuevo.
- Ejemplo · CrediScore
```markdown
# ADR 0002 · Elección de estilo arquitectónico

## Estado
Aceptado — 2026-03-15

## Contexto
CrediScore requiere decisión de crédito < 60s p95 y fraud detection < 500ms. El equipo tiene 8 personas, 3 con experiencia previa en microservicios.

## Decisión
Modular monolith con extracción event-driven del módulo de fraude a partir del sprint 6.

## Consecuencias
+ Operacional simple para el MVP.
+ Deploy único hasta que el módulo de fraude requiera escalar solo.
- Requiere disciplina de módulos.
- Extracción posterior tiene costo.

## Alternativas descartadas
- Microservicios desde día 0: costo operacional excesivo para 8 devs.
- Serverless puro: latencia p95 incompatible con cold starts.
```

## Slide 8
- Caso de uso · CrediScore
- C4 Nivel 1 — Diagrama de Contexto
- Vista simplificada del sistema y quién lo rodea. Sin detalles internos.
- PERSONA
- Solicitante
- Cliente que pide microcrédito vía web/app.
- PERSONA
- Analista riesgo
- Re-evalúa casos límite en backoffice.
- PERSONA
- Partner comercial
- Consume la API pública para integrar scoring.
- CrediScore
- SISTEMA
- Motor de scoring y detección de fraude en tiempo real. Cumplimiento CMF.
- EXTERNO
- Registro Civil
- Validación de identidad y RUT.
- EXTERNO
- CMF (SBIF)
- Reporte regulatorio de créditos otorgados.
- EXTERNO
- Bureau crédito
- Consulta de historial y morosidad.
- LECTURA DEL DIAGRAMA
- 3 personas usan el sistema. 3 sistemas externos lo alimentan o consumen. En L2 abriremos la caja naranja: SPA, API Gateway, servicios de scoring y fraude, DB, event bus.
- Ver diagrama L2 en docs/c4/l2-container.puml.

## Slide 9
- Mini-lab de la sesión · 30 min
- Diagrama C4 L1 + L2 + ADR 0002
- Backlog inicial de la S02 aprobado.
- Herramienta de diagramas: PlantUML, Structurizr o draw.io.
- Convenciones C4 leídas (c4model.com).
- Identificar 3 atributos de calidad prioritarios.
- Discutir 2 estilos arquitectónicos candidatos.
- Elegir y justificar en ADR 0002.
- Dibujar C4 nivel 1 (contexto): personas + sistema + externos.
- Dibujar C4 nivel 2 (contenedor): apps + DB + broker + externos.
- Documentar tecnologías tentativas por contenedor.
- Crear PR con docs/c4/ y docs/adr/0002-*.md.
- Prerrequisitos
- Pasos
- PR al repo del equipo con:
- docs/c4/l1-context.png + fuente .puml o .dsl.
- docs/c4/l2-container.png + fuente.
- docs/adr/0002-estilo-arquitectonico.md.
- docs/arch/atributos-calidad.md con top 3 NFRs.
- Tip: Structurizr permite generar L1, L2 y L3 desde un único DSL. Recomendado.
- Entregable
- RÚBRICA · 100 PUNTOS

| C4 L1 completo y correcto | 20 |
|---|---|
| C4 L2 con tecnologías identificadas | 25 |
| ADR 0002 argumenta la decisión | 25 |
| Atributos de calidad priorizados | 15 |
| Trazabilidad backlog → contenedor | 10 |
| Puntualidad y calidad del PR | 5 |

- Deadline: antes del inicio de la S04.

## Slide 10
- Cierre y próximos pasos
- Con diagrama
- vamos a la Nube.
- Compromisos hasta la próxima clase
- Entregar C4 L1 + L2 + ADR 0002.
- Leer el manifiesto 12factor.net.
- Revisar los servicios gestionados del cloud provider elegido.
- Preparar 2 preguntas para la S04.
- Diseño para la Nube:
- 12-Factor y microservicios
- Los 12 factores aplicados a tu iniciativa, patrones cloud native y decisión monolito vs microservicios con evidencia.

---

# S04 — Diseño para la Nube: 12-Factor y microservicios

## Slide 1
- Sesión 04 · 2h 30 min
- Nacido
- en la Nube.
- Los 12 factores de Heroku, patrones cloud-native, decisión monolito vs microservicios con evidencia y servicios gestionados aplicados a AulaViva.
- BLOQUE C · NUBE Y AUTOMATIZACIÓN
- Cloud-native · 12-Factor · Servicios gestionados
- MÓDULO
- 04
- de 18 sesiones
- BLOQUE
- Nube

## Slide 2
- Agenda
- Cómo se distribuyen las 2h 30 min
- 01
- Warm-up: review C4 entre equipos
- Feedback cruzado de diagramas. · 15 min
- 02
- Los 12 factores
- Explicados con snippets multi-stack. · 35 min
- 03
- Monolito vs Microservicios
- Cuándo cada uno. Decisiones basadas en evidencia. · 25 min
- 04
- Patrones cloud-native
- API Gateway, Circuit Breaker, Saga, CQRS. · 25 min
- 05
- Servicios gestionados
- Managed vs. self-hosted: cuándo delegar. · 20 min
- 06
- Caso AulaViva + Mini-lab
- 12-Factor checklist aplicado. · 30 min
- INCLUYE 15 MIN DE DESCANSO Y 5 MIN DE RETROSPECTIVA · TOTAL 150 MIN

## Slide 3
- Objetivos de la sesión
- Al terminar esta clase serás capaz de…
- OBJETIVO 01
- Aplicar los 12 factores
- Auditar cada factor contra tu servicio y proponer acciones concretas para cumplir.
- OBJETIVO 02
- Decidir el estilo
- Elegir monolito modular, microservicios o serverless con criterios objetivos.
- OBJETIVO 03
- Usar patrones cloud
- Aplicar API Gateway, Circuit Breaker, Saga y CQRS donde corresponda.
- OBJETIVO 04
- Elegir servicios gestionados
- Decidir qué operar vs. qué delegar al proveedor cloud.
- OBJETIVO 05
- Justificar con ADR
- Documentar la decisión cloud en ADR 0003 con alternativas y trade-offs.
- ENTREGABLE DEL DÍA
- docs/12-factor-checklist.md + docs/adr/0003-cloud-style.md.

## Slide 4
- The Twelve-Factor App · Heroku 2011
- Los 12 factores que definen cloud-native

| # | FACTOR | IDEA CENTRAL | ANTI-PATRÓN QUE EVITA |
|---|---|---|---|
| 01 | Codebase | Una base de código en Git por app, muchos deploys. | Compartir código copiado entre servicios. |
| 02 | Dependencies | Declaradas y aisladas (Poetry, npm, Maven). | Depender de librerías del sistema operativo. |
| 03 | Config | Configuración en variables de entorno. | config.dev.json, config.prod.json en el repo. |
| 04 | Backing services | DBs, colas y APIs tratadas como recursos adjuntos. | Cambiar de DB requiere recompilar el código. |
| 05 | Build, release, run | Tres etapas estrictamente separadas. | Editar código directamente en producción. |
| 06 | Processes | Procesos stateless que comparten nada. | Sesión de usuario en memoria del proceso. |
| 07 | Port binding | La app publica su propio puerto. | Depender de un servidor externo (Apache). |
| 08 | Concurrency | Escalar por múltiples procesos, no threads. | "Vertical scaling" indefinido. |
| 09 | Disposability | Arranque rápido y shutdown graceful. | Procesos que tardan minutos en levantar. |
| 10 | Dev/prod parity | Ambientes lo más parecidos posible. | SQLite en dev, PostgreSQL en prod. |
| 11 | Logs | Logs como event streams a stdout. | Escribir app.log en el disco del contenedor. |
| 12 | Admin processes | Tareas one-off en el mismo entorno. | Migrations manuales por SSH. |

## Slide 5
- Decisión con evidencia
- Monolito modular vs microservicios
- La regla de Sam Newman: "Si no puedes construir bien un monolito modular, no vas a poder con microservicios." La complejidad no desaparece — se muda a la red.
- MONOLITO MODULAR
- Elige esto cuando…
- Equipo < 15 personas.
- Dominio aún se descubre (bounded contexts inestables).
- Presupuesto operacional limitado.
- Necesitas transacciones ACID naturales.
- Time-to-market corto (MVP en semanas).
- Costo: disciplina de módulos (namespaces, dependencias explícitas, no shortcuts).
- MICROSERVICIOS
- Elige esto cuando…
- Múltiples equipos (2+ pizza teams).
- Bounded contexts probados y estables.
- Necesitas escalar partes por separado.
- Cadencias de release muy distintas por dominio.
- Alta resiliencia por bulkhead.
- Costo: observabilidad distribuida, orquestación, eventual consistency, red como SPOF.

## Slide 6
- Patrones cloud-native
- Cinco patrones que verás en cada arquitectura

| PATRÓN | PROBLEMA QUE RESUELVE | CÓMO SE IMPLEMENTA |
|---|---|---|
| API Gateway | Muchos clientes distintos consumen muchos servicios. Autenticación duplicada. | Kong, Envoy, Amazon API Gateway. Centraliza auth, rate limiting, versionado, throttling. |
| Circuit Breaker | Un servicio caído tumba al resto por reintentos en cascada. | Resilience4j (Java), Polly (.NET), tenacity (Python). Estados: closed / open / half-open. |
| Saga | Transacciones distribuidas sin 2PC. Consistencia eventual. | Coreografía (eventos) u orquestación (Temporal, Camunda). Compensaciones definidas. |
| CQRS | El modelo de lectura y escritura tienen requisitos muy distintos. | Modelos separados. Read side puede ser un proyector desde eventos. |
| Bulkhead | Un pool saturado consume todos los recursos del proceso. | Pools separados por dependencia. Aislamiento por thread pool o proceso. |
| Outbox | Publicar eventos y guardar en DB no es atómico. | Tabla outbox en la misma transacción. Un relay publica al broker. |
| Sidecar | Cross-cutting concerns (mTLS, logging) sin duplicar código. | Contenedor auxiliar al lado de la app. Service mesh (Istio, Linkerd). |

## Slide 7
- Managed vs self-hosted
- Qué operar y qué delegar al cloud
- La regla del "3 PM del sábado"
- Si a las 3 PM del sábado necesitas escalar un cluster de Kafka manualmente, estás en el negocio equivocado. Solo autoconstruye lo que sea núcleo del producto.
- Framework de decisión
- ¿Es diferenciador del producto? → constrúyelo.
- ¿Existe un servicio managed maduro? → úsalo.
- ¿El costo managed es > 3x el self-hosted? → recién ahí evaluar operar.
- ¿Tienes un SRE senior a tiempo completo? → recién ahí considerar self-hosted.
- Documenta la decisión con ADR.

| COMPONENTE | AWS | AZURE | GCP |
|---|---|---|---|
| DB relacional | RDS / Aurora | Azure SQL | Cloud SQL |
| DB NoSQL doc | DocumentDB | Cosmos DB | Firestore |
| KV store | DynamoDB | Table Storage | Bigtable |
| Cache | ElastiCache | Cache for Redis | Memorystore |
| Colas | SQS | Service Bus | Pub/Sub |
| Streaming | Kinesis / MSK | Event Hubs | Pub/Sub, Dataflow |
| Compute FaaS | Lambda | Functions | Cloud Functions |
| Contenedores | ECS / EKS | ACI / AKS | Cloud Run / GKE |
| Object storage | S3 | Blob Storage | Cloud Storage |
| Secretos | Secrets Manager | Key Vault | Secret Manager |

- Regla: pega tu arquitectura a interfaces (Ports & Adapters). Cambiar cloud es doloroso, pero no imposible.

## Slide 8
- Caso de uso · AulaViva
- 12-Factor aplicado a un SaaS multi-tenant
- Config (Factor 03) — multi-tenant
- Logs (Factor 11) — stream a stdout
```bash
# .env por ambiente (nunca en repo)
DATABASE_URL="postgres://..."
LLM_API_KEY="sk-..."
TENANT_STRATEGY="schema_per_tenant"
RATE_LIMIT_PER_TENANT="100/min"
```

```python
# Python — pydantic-settings
class Settings(BaseSettings):
    database_url: str
    llm_api_key: str
    tenant_strategy: TenantStrategy
    rate_limit_per_tenant: str

    class Config:
        env_file = ".env"
```
```javascript
// Node — pino, logs JSON estructurados
import pino from 'pino'
const log = pino({ level: 'info' })
log.info({ tenant_id: ctx.tenantId, user_id: ctx.userId,
           event: 'lesson.viewed', lesson_id: id })
```
- Backing services (Factor 04)
- Cada dependencia debe poder cambiar por variable de entorno sin recompilar:

| Postgres | DATABASE_URL |
|---|---|
| Redis | REDIS_URL |
| Vector DB | VECTOR_DB_URL |
| LLM API | LLM_ENDPOINT, LLM_API_KEY |
| S3 / Blob | OBJECT_STORE_URL |

- Disposability (Factor 09)
- Verificable: el pod recibe SIGTERM y termina limpio en < 30s.
```java
// Java Spring — shutdown graceful
@PreDestroy
public void shutdown() {
    log.info("draining connections");
    webSocketManager.disconnectAll();
    taskExecutor.shutdown();
    taskExecutor.awaitTermination(30, TimeUnit.SECONDS);
    log.info("shutdown complete");
}
```

## Slide 9
- Mini-lab de la sesión · 30 min
- Checklist 12-Factor + ADR de estilo cloud
- C4 L1 y L2 aprobados (S03).
- Cloud provider tentativo elegido (AWS/Azure/GCP).
- Lectura del manifiesto 12factor.net.
- Auditar cada uno de los 12 factores contra tu diseño.
- Marcar cumple / no cumple / no aplica.
- Para cada "no cumple" proponer acción concreta.
- Elegir estilo cloud (monolito modular / micros / serverless / híbrido).
- Elegir 3-5 servicios gestionados por contenedor del L2.
- Redactar ADR 0003 con contexto, decisión, consecuencias, alternativas.
- Crear PR con checklist + ADR.
- Prerrequisitos
- Pasos
- PR al repo del equipo con:
- docs/12-factor-checklist.md con tabla de los 12 factores.
- docs/adr/0003-cloud-style.md justificando el estilo.
- docs/arch/managed-services.md con selección por contenedor.
- Actualizar C4 L2 con las tecnologías managed decididas.
- Formato checklist: tabla con columnas Factor · Estado · Acción · Responsable.
- Entregable
- RÚBRICA · 100 PUNTOS

| Checklist 12-Factor completo | 25 |
|---|---|
| Acciones concretas por gap | 20 |
| ADR 0003 justifica trade-offs | 25 |
| Servicios managed elegidos con criterio | 15 |
| C4 L2 actualizado con tecnologías | 10 |
| Puntualidad y calidad del PR | 5 |

- Deadline: antes del inicio de la S05.

## Slide 10
- Cierre y próximos pasos
- Del estilo,
- al contrato.
- Compromisos hasta la próxima clase
- Entregar checklist 12-Factor + ADR 0003.
- Leer la especificación OpenAPI 3.1 (secciones info, paths, components).
- Explorar el editor Swagger o Stoplight Studio.
- Instalar Spectral CLI para linting de contratos.
- APIs, contratos
- y diseño OpenAPI
- REST vs GraphQL vs gRPC vs Async. Diseño RESTful, versionado, RFC 7807 y OpenAPI 3.1 aplicados a CrediScore.

---

# S05 — APIs, contratos y diseño OpenAPI

## Slide 1
- Sesión 05 · 2h 30 min
- La API es
- el producto.
- Estilos de API (REST/GraphQL/gRPC/Async), diseño RESTful, RFC 7807, versionado, idempotencia y OpenAPI 3.1 con contract-first aplicados a CrediScore.
- BLOQUE B · DISEÑO Y DATOS
- Contratos · Consumidores · Versionado
- MÓDULO
- 05
- de 18 sesiones
- BLOQUE
- Diseño

## Slide 2
- Agenda
- Cómo se distribuyen las 2h 30 min
- 01
- Warm-up: review 12-Factor
- Checklists cruzados entre equipos. · 15 min
- 02
- Estilos de API
- REST, GraphQL, gRPC, Async. Decisión. · 25 min
- 03
- Diseño RESTful maduro
- Recursos, verbos, versionado, RFC 7807. · 30 min
- 04
- OpenAPI 3.1
- Estructura de un contrato ejecutable. · 25 min
- 05
- Contract-first
- Contract vs. code first. Generación de código. · 20 min
- 06
- Caso CrediScore + Mini-lab
- OpenAPI del endpoint de scoring. · 30 min
- INCLUYE 15 MIN DE DESCANSO Y 5 MIN DE RETROSPECTIVA · TOTAL 150 MIN

## Slide 3
- Objetivos de la sesión
- Al terminar esta clase serás capaz de…
- OBJETIVO 01
- Elegir el estilo correcto
- Decidir entre REST, GraphQL, gRPC y async con base en el problema, no la moda.
- OBJETIVO 02
- Diseñar APIs RESTful maduras
- Aplicar recursos, verbos, versionado, paginación, RFC 7807 e idempotencia.
- OBJETIVO 03
- Escribir OpenAPI 3.1
- Crear contratos ejecutables con paths, components, security y ejemplos.
- OBJETIVO 04
- Aplicar contract-first
- Generar código servidor y cliente desde el contrato con herramientas maduras.
- OBJETIVO 05
- Validar tu contrato
- Linter con Spectral y ejemplos que sirven como pruebas ejecutables.
- ENTREGABLE DEL DÍA
- api/openapi.yaml con ≥ 5 endpoints y ≥ 3 schemas, pasando lint Spectral.

## Slide 4
- Estilos de API
- REST · GraphQL · gRPC · Async

| ESTILO | NATURALEZA | CUÁNDO LO ELIGES | TRADE-OFF PRINCIPAL |
|---|---|---|---|
| REST / HTTP JSON | Recursos y verbos HTTP. | APIs públicas, integraciones amplias, cacheable, ecosystem gigante. | Sobre-fetching o under-fetching en clientes móviles. |
| GraphQL | Queries sobre un grafo tipado. | Frontends con muchos consumidores heterogéneos que necesitan campos distintos. | Caching complejo, N+1 en resolvers, difícil rate-limit. |
| gRPC | RPC binario sobre HTTP/2 con protobuf. | Comunicación interna entre microservicios, alto rendimiento, streaming bidireccional. | Menos amigable para navegadores, tooling menos maduro. |
| Async (events) | Publicación/suscripción sobre broker. | Procesos largos, desacoplamiento total, integración event-driven. | Trazabilidad difícil, orden y at-least-once delivery. |
| WebSocket / SSE | Canal persistente cliente-servidor. | Notificaciones en tiempo real, chats, dashboards en vivo. | Manejo de reconexión, escalado con sticky sessions o pubsub externo. |

- Regla del taller · Una API pública casi siempre es REST. Entre microservicios internos, gRPC. Para eventos, async. GraphQL solo si tienes muchos consumidores con necesidades divergentes.

## Slide 5
- Diseño RESTful maduro
- Seis reglas que separan una API buena de una regular
- 01 · Recursos, no verbos
- Sí: POST /credit-applications
- No: POST /createCreditApplication
- 02 · Verbos HTTP con semántica
- GET (safe, idempotent) · POST (crear) · PUT (reemplazar, idempotent) · PATCH (parcial) · DELETE (idempotent).
- 03 · Versionado explícito
- Prefijo: /v1/credit-applications. Nunca romper contratos: agrega campos opcionales, nunca eliminar.
- 04 · Errores RFC 7807
```json
{
  "type": "https://api.crediscore.cl/errors/insufficient-funds",
  "title": "Insufficient credit history",
  "status": 422,
  "detail": "Applicant has < 6 months of records",
  "instance": "/v1/credit-applications/abc123",
  "trace_id": "c8f2b1..."
}
```
- 05 · Idempotencia con clave
- Header Idempotency-Key en POST. El servidor cachea la respuesta por clave por 24h. Crítico en pagos y micro-créditos.
- 06 · Paginación y filtros consistentes
- Cursor-based es preferible a offset. Filtros en query string con operadores explícitos.
- Bonus: HATEOAS solo si tus clientes son controlables. En APIs públicas, casi siempre es sobrediseño.
```http
POST /v1/credit-applications
Idempotency-Key: "9c4a-...-abc"
Content-Type: application/json

{ "rut": "12345678-9", "amount": 250000 }
```
```http
GET /v1/credit-applications?cursor=eyJpZCI6MTIzfQ&limit=50&status=approved&created_at.gte=2026-01-01
```

## Slide 6
- OpenAPI 3.1
- Anatomía de un contrato ejecutable
- Secciones principales

| info | Título, versión, contacto, licencia. |
|---|---|
| servers | URLs por ambiente (prod, staging, dev). |
| paths | Endpoints, verbos, parámetros, responses. |
| components | Schemas, parámetros, respuestas reutilizables. |
| security | Auth schemes (OAuth2, Bearer, API Key, mTLS). |
| tags | Agrupación de endpoints para navegación. |
| webhooks | Eventos que la API emite hacia el consumidor. |

- Novedades 3.1 vs 3.0: JSON Schema completo, webhooks, nullable con type: [string, null], licencia con SPDX identifier.
```yaml
openapi: 3.1.0
info:
  title: CrediScore API
  version: 1.0.0
  license: { name: MIT, identifier: MIT }
servers:
  - url: https://api.crediscore.cl/v1
paths:
  /credit-applications:
    post:
      summary: Crear solicitud de crédito
      operationId: createApplication
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ApplicationInput'
      responses:
        '201':
          description: Creada
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Application'
        '422':
          $ref: '#/components/responses/ValidationError'
components:
  schemas:
    ApplicationInput:
      type: object
      required: [rut, amount]
      properties:
        rut: { type: string, pattern: '^\d{7,8}-[0-9K]$' }
        amount: { type: integer, minimum: 50000 }
```

## Slide 7
- Contract-first
- El contrato antes del código
- Contract-first vs code-first

|  | CONTRACT-FIRST | CODE-FIRST |
|---|---|---|
| Fuente de verdad | openapi.yaml | Anotaciones en código |
| Colaboración | PO/QA revisan el contrato | Requiere leer código |
| Multi-lenguaje | Nativo | Cada stack genera su propio spec |
| Drift API/código | Casi imposible | Fácil que aparezca |
| Frontend paralelo | Mock desde día 1 | Espera al backend |

- Regla del taller: contract-first para APIs públicas, code-first solo para APIs internas de un solo consumidor.
- Toolchain que generamos desde el contrato
- Un solo openapi.yaml alimenta:
- openapi-generator, oapi-codegen, springdoc.
- TypeScript, Python, Java, Go — generados.
- Prism (Stoplight): frontend trabaja sin backend.
- Swagger UI, Redoc, Stoplight Elements.
- Spectral con reglas del equipo.
- Schemathesis, Dredd, Pact.
- Servidor stub
- Clientes tipados
- Mock server
- Documentación viva
- Linter
- Contract testing

## Slide 8
- Caso de uso · CrediScore
- OpenAPI del endpoint de scoring
- Como partner comercial,
- quiero consultar el score de un solicitante vía API,
- para aprobar créditos en mi plataforma en tiempo real.
- Latencia p95 < 60s.
- Idempotencia obligatoria (crédito no se puede duplicar).
- Autenticación mTLS + OAuth2 client credentials.
- Rate limit: 100 req/min por partner.
- Trazabilidad: trace_id en cada respuesta.
- User story de referencia
- Requisitos NFR
```yaml
paths:
  /v1/scoring/evaluate:
    post:
      summary: Evaluar solicitud de crédito
      operationId: evaluateApplication
      security: [ { oauth2: [scoring:write] } ]
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [rut, amount, term_months]
              properties:
                rut: { type: string, pattern: '^\d{7,8}-[0-9K]$' }
                amount: { type: integer, minimum: 50000, maximum: 5000000 }
                term_months: { type: integer, minimum: 1, maximum: 36 }
      responses:
        '200':
          headers:
            X-Rate-Limit-Remaining: { schema: { type: integer } }
            X-Trace-Id: { schema: { type: string } }
          content:
            application/json:
              schema:
                type: object
                properties:
                  application_id: { type: string, format: uuid }
                  score: { type: integer, minimum: 0, maximum: 1000 }
                  decision: { enum: [approved, rejected, review] }
                  reasons: { type: array, items: { type: string } }
                  explainability_url: { type: string, format: uri }
        '422':
          $ref: '#/components/responses/ValidationError'
        '429':
          $ref: '#/components/responses/RateLimited'
```

## Slide 9
- Mini-lab de la sesión · 30 min
- Contrato OpenAPI del servicio principal
- Backlog + C4 L2 aprobados.
- Spectral CLI instalado.
- Editor Swagger / Stoplight Studio.
- Identificar ≥ 5 endpoints RESTful del servicio principal.
- Definir 3 schemas base (input, output, error RFC 7807).
- Configurar security schemes (OAuth2, Bearer o mTLS).
- Agregar ejemplos de request y response por endpoint.
- Definir versionado y política de deprecación.
- Configurar Spectral con reglas del equipo.
- Pasar el lint sin errores. Generar cliente TS.
- PR con api/openapi.yaml y .spectral.yaml.
- Prerrequisitos
- Pasos
- PR al repo del equipo con:
- api/openapi.yaml con ≥ 5 endpoints y ≥ 3 schemas.
- .spectral.yaml con reglas del equipo.
- api/examples/ con al menos 3 ejemplos ejecutables.
- docs/api/versioning-policy.md con política de compatibilidad.
- Cliente TypeScript generado en packages/api-client/.
- Bonus: setup de mock server con Prism para el frontend.
- Entregable
- RÚBRICA · 100 PUNTOS

| ≥ 5 endpoints bien diseñados | 25 |
|---|---|
| Schemas reutilizables y tipados | 20 |
| Errores RFC 7807 + idempotencia | 20 |
| Ejemplos ejecutables | 10 |
| Lint Spectral pasa sin errores | 15 |
| Política de versionado | 5 |
| Puntualidad | 5 |

- Deadline: antes del inicio de la S06.

## Slide 10
- Cierre y próximos pasos
- Contrato listo.
- Ahora, los datos.
- Compromisos hasta la próxima clase
- Entregar OpenAPI 3.1 + lint verde + cliente generado.
- Publicar la documentación viva (Swagger UI o Redoc) en un ambiente accesible.
- Preparar el modelo de datos preliminar (entidades y relaciones).
- Leer los patrones Outbox, Saga y CQRS antes de la S06.
- Datos: SQL, NoSQL
- y event-driven
- Elección de motor, CQRS, Event Sourcing, Outbox y Saga. DDD y bounded contexts aplicados al ciclo de vida de un paciente en MediTriage.

---

# S06 — Datos: SQL, NoSQL y arquitecturas event-driven

## Slide 1
- Sesión 06 · 2h 30 min
- Los datos
- fluyen.
- Elección de motor SQL vs NoSQL, arquitecturas event-driven, patrones CQRS · Event Sourcing · Outbox · Saga, y DDD bounded contexts aplicados a MediTriage.
- BLOQUE B · DISEÑO Y DATOS
- Persistencia · Eventos · Consistencia
- MÓDULO
- 06
- de 18 sesiones
- BLOQUE
- Datos

## Slide 2
- Agenda
- Cómo se distribuyen las 2h 30 min
- 01
- Warm-up: review de OpenAPI
- Feedback cruzado de contratos. · 15 min
- 02
- SQL vs NoSQL
- Elegir motor según acceso y consistencia. · 25 min
- 03
- Arquitecturas event-driven
- Brokers, delivery semantics, idempotencia. · 25 min
- 04
- Patrones de datos
- CQRS · Event Sourcing · Outbox · Saga. · 30 min
- 05
- DDD y bounded contexts
- De la ubiquitous language al modelo. · 20 min
- 06
- Caso MediTriage + Mini-lab
- Ciclo de vida del paciente como eventos. · 30 min
- INCLUYE 15 MIN DE DESCANSO Y 5 MIN DE RETROSPECTIVA · TOTAL 150 MIN

## Slide 3
- Objetivos de la sesión
- Al terminar esta clase serás capaz de…
- OBJETIVO 01
- Elegir el motor correcto
- Decidir SQL, documental, KV, columnar o grafo con base en patrones de acceso reales.
- OBJETIVO 02
- Modelar con eventos
- Diseñar flujos event-driven con delivery semantics conscientes.
- OBJETIVO 03
- Aplicar patrones
- Usar CQRS, Event Sourcing, Outbox y Saga solo cuando el problema los pide.
- OBJETIVO 04
- Definir bounded contexts
- Trazar fronteras claras entre subdominios con lenguaje ubicuo.
- OBJETIVO 05
- Documentar decisiones
- Redactar ADR 0004 justificando persistencia y broker elegidos.
- ENTREGABLE DEL DÍA
- DER + mapa de eventos + docs/adr/0004-datos-y-eventos.md.

## Slide 4
- Elección de motor
- SQL sigue siendo la respuesta por defecto

| FAMILIA | EJEMPLO | CUÁNDO ELEGIRLA | CUÁNDO NO |
|---|---|---|---|
| Relacional (SQL) | PostgreSQL, MySQL, Aurora | Transacciones ACID, integridad referencial, consultas ad-hoc, informes. | Volúmenes petabyte con acceso key-only. |
| Documental | MongoDB, DocumentDB, Firestore | Modelos anidados, schemaless controlado, agregación simple. | Joins complejos, transacciones cross-document masivas. |
| Clave-valor | Redis, DynamoDB, KeyDB | Sesiones, cache, feature flags, contadores, leaderboards. | Consultas por atributos secundarios. |
| Columnar | Cassandra, ScyllaDB, BigTable | Time-series, escritura masiva, escalado horizontal linear. | Consultas ad-hoc por múltiples índices. |
| Grafo | Neo4j, Neptune, ArangoDB | Relaciones complejas: recomendaciones, fraude, redes sociales. | Casos donde < 2 saltos entre entidades. |
| Vectorial | pgvector, Pinecone, Qdrant, Weaviate | Embeddings, búsqueda semántica, RAG. | Consultas exactas por atributo escalar. |
| Search / OLAP | OpenSearch, ClickHouse, BigQuery | Búsqueda full-text, analítica sobre eventos, dashboards. | Escrituras transaccionales de baja latencia. |

- Regla del taller · Empieza con PostgreSQL. Agrega Redis para cache. Introduce un motor especializado solo cuando midas que Postgres no alcanza — no antes.

## Slide 5
- Event-driven
- El evento como fuente de verdad
- Anatomía de un evento
- Un evento describe algo que ya ocurrió, en pasado. No es un comando ni una petición.
- Reglas: nombra en pasado, incluye versión, incluye trace_id, es inmutable, no lo modifiques nunca.
```json
{
  "event_id": "01HK2M...",
  "event_type": "patient.triage.completed",
  "event_version": "1.0",
  "occurred_at": "2026-03-15T14:22:31Z",
  "aggregate_id": "patient-9f4e",
  "trace_id": "c8f2b1...",
  "data": {
    "esi_category": 2,
    "reasoning": "dolor torácico + PA elevada",
    "triaged_by": "ai-engine-v3"
  }
}
```
- Brokers y delivery semantics

| BROKER | MODELO | IDEAL PARA |
|---|---|---|
| Kafka | Log distribuido | Alto throughput, replay, streaming. |
| RabbitMQ | Queue tradicional | Tareas asíncronas, RPC async. |
| SQS + SNS | Managed queue + pub/sub | Serverless, low ops. |
| Pub/Sub GCP | Managed pub/sub | Integración cloud-native. |
| NATS | Ligero, in-memory | Comunicación entre microservicios. |

- Garantías de entrega
- At-most-once: puede perder mensajes. Solo métricas no críticas.
- At-least-once: puede duplicar. Requiere idempotencia. Es lo normal.
- Exactly-once: solo en escenarios muy acotados (Kafka transactional, con costo).
- Ley: asume at-least-once. Toda operación consumidora debe ser idempotente por event_id.

## Slide 6
- Patrones de datos
- CQRS · Event Sourcing · Outbox · Saga

| PATRÓN | PROBLEMA QUE RESUELVE | CÓMO FUNCIONA | TRADE-OFF |
|---|---|---|---|
| CQRS Command Query Responsibility Segregation | El modelo de lectura y de escritura tienen requisitos radicalmente distintos. | Separas dos modelos: uno para comandos (writes), otro para consultas (reads). Puedes optimizar cada uno. | Duplicación de código y consistencia eventual. |
| Event Sourcing | Necesitas auditoría absoluta, poder reconstruir el estado o hacer time-travel debugging. | El estado se deriva reproduciendo los eventos. El log de eventos es la fuente de verdad. | Curva de aprendizaje alta, replay lento en aggregates grandes, versionado de eventos. |
| Outbox | Publicar un evento y guardar en la DB no es atómico. Si el broker cae después del commit, se pierde el evento. | Insertas el evento en una tabla outbox dentro de la misma transacción. Un relay lee y publica. | Latencia extra en la publicación, requiere el relay operativo. |
| Saga | Transacción distribuida sobre múltiples servicios sin 2PC. | Serie de pasos locales. Si uno falla, se ejecutan compensaciones. Coreografía (eventos) u orquestación (Temporal). | Complejidad de compensaciones, difícil debugging. |
| Change Data Capture | Necesitas que cambios en la DB se propaguen a otros sistemas sin doble escritura. | Herramientas como Debezium leen el WAL y publican cambios como eventos. | Acoplamiento al schema físico, riesgo de exponer detalles internos. |

- Regla · No agregues Event Sourcing por moda. Solo si necesitas auditoría inmutable, replay o time-travel. Outbox, en cambio, es casi siempre útil cuando publicas eventos.

## Slide 7
- Domain-Driven Design
- Bounded contexts: fronteras semánticas
- Ideas centrales de DDD (Eric Evans)

| Ubiquitous language | El mismo vocabulario entre negocio y código. |
|---|---|
| Bounded context | Frontera donde un término tiene UN solo significado. |
| Aggregate | Racimo de objetos que se modifican como una unidad. |
| Aggregate root | La única entrada permitida al aggregate. |
| Domain event | Algo relevante que ocurrió en el dominio. |
| Context map | Diagrama de relaciones entre bounded contexts. |

- El síntoma clásico: la palabra "Paciente" significa cosas distintas en Clínica, Facturación y Marketing. Cada contexto merece su propio modelo.
- Bounded contexts de MediTriage
- CONTEXTO · CLÍNICO
- Paciente = persona con signos vitales, síntomas, categoría ESI. Aggregate: Encounter.
- CONTEXTO · IDENTIDAD
- Paciente = persona con RUT validado, consentimiento firmado, contactos. Aggregate: Person.
- CONTEXTO · AUDITORÍA
- Paciente = referencia opaca a decisiones IA registradas. Aggregate: AuditLog.
- CONTEXTO · FACTURACIÓN
- Paciente = titular de plan, con cargos y coberturas. Aggregate: Account.

## Slide 8
- Caso de uso · MediTriage
- Ciclo de vida del paciente como eventos
- Un paciente atraviesa el sistema como una secuencia de eventos de dominio. Cada evento actualiza proyecciones de lectura y activa reglas de negocio.
- Eventos del contexto clínico
- 1
- RUT validado, consentimiento firmado.
- 2
- Signos vitales medidos por enfermera.
- 3
- Formulario clínico completado.
- 4
- Comando envía el caso al motor IA.
- 5
- Categoría ESI + justificación disponibles.
- 6
- Enfermera acepta o modifica la categoría.
- 7
- Paciente atendido por médico.
- patient.registered
- vitals.captured
- symptoms.reported
- triage.requested
- triage.completed
- triage.confirmed
- patient.attended
- DECISIÓN DE PERSISTENCIA
- Tres motores, un dominio

| PostgreSQL | State actual del Encounter. ACID, integridad. |
|---|---|
| Kafka | Stream de eventos clínicos. Auditoría + replay. |
| OpenSearch | Proyección de lectura para dashboard triage. |
| Redis | Estado en tiempo real de la sala de espera. |

- Patrón aplicado: Outbox en PostgreSQL para publicar a Kafka de forma atómica. CQRS: lectura desde OpenSearch, escritura contra Postgres.

## Slide 9
- Mini-lab de la sesión · 30 min
- Modelo de datos + mapa de eventos + ADR 0004
- OpenAPI aprobado (S05).
- C4 L2 con tecnologías managed elegidas (S04).
- Backlog priorizado (S02).
- Identificar 3-4 bounded contexts de tu iniciativa.
- Dibujar el DER del contexto principal (5-8 entidades).
- Listar 10-15 eventos de dominio del ciclo de vida principal.
- Elegir motor de persistencia por contexto.
- Elegir broker de eventos.
- Decidir si aplicar Outbox, CQRS y/o Saga.
- Redactar ADR 0004 con justificación y trade-offs.
- PR con DER, mapa de eventos y ADR.
- Prerrequisitos
- Pasos
- PR al repo del equipo con:
- docs/data/der.png + fuente (dbdiagram.io, PlantUML).
- docs/data/event-catalog.md con 10-15 eventos y su schema.
- docs/data/bounded-contexts.md con context map.
- docs/adr/0004-datos-y-eventos.md.
- Actualización del C4 L2 con motores y broker.
- Formato evento: nombre en pasado (recurso.acción.pasado), versión, campos, productor, consumidores.
- Entregable
- RÚBRICA · 100 PUNTOS

| DER completo y coherente | 20 |
|---|---|
| Catálogo de eventos bien nombrado | 20 |
| Bounded contexts justificados | 15 |
| Elección de motores argumentada | 15 |
| Patrones (Outbox/CQRS/Saga) aplicados con criterio | 15 |
| ADR 0004 completo | 10 |
| Puntualidad | 5 |

- Deadline: antes del inicio de la S07.

## Slide 10
- Cierre y próximos pasos
- Fin de fundamentos
- y diseño.
- Hito parcial 1 · Bloque de diseño completo
- Charter, backlog, C4, 12-Factor, OpenAPI y modelo de datos entregados.
- Cada equipo presenta su arquitectura en 5 min al inicio de la S07.
- Docente entrega feedback consolidado antes del bloque de automatización.
- Instalar Docker Desktop, kubectl y Terraform antes de la S07.
- Contenedores, K8s
- e Infraestructura como Código
- Docker multi-stage, manifiestos K8s, Helm vs Kustomize, y Terraform aplicados al servicio de scoring de CrediScore.


---

# PARTE 2 — Estado real del repo FeathersForAll (contexto de lo ya construido)

Fuente: https://github.com/Erolayer-Cl/FeathersForAll (rama `main`, revisado el 2026-09-28; actualizado el 2026-10-07 con S04–S06 y el código en `code/`). Los documentos están en `FeathersForAll/Documentos/`. Última actividad en el repo: "Tercera Semana" (S03). Lo que sigue es el contenido de esos documentos, más el estado y los pendientes respecto a las PPT (Parte 1).

## Estado por sesión

| Sesión | Entregable según PPT | Estado en el repo |
|---|---|---|
| S01 | CHARTER.md, ADR 0001, board Kanban | Hecho (Charter y ADR 0001 existen) |
| S02 | impact-map.md, backlog.md (5 historias), 15 escenarios Gherkin, MoSCoW | Hecho |
| S03 | C4 L1 + L2, ADR 0002, atributos de calidad (top 3) | Hecho; ADR 0002 sigue "Propuesto" |
| S04 | 12-factor-checklist.md, ADR 0003 (estilo cloud), managed-services.md, C4 L2 actualizado | Hecho (basado en el deck de S04 del equipo): `Documentos/12-factor-checklist.md`, `Documentos/adr/0003-cloud.md`, `Documentos/cloud/managed-services.md`, C4 L2 actualizado |
| S05 | api/openapi.yaml (≥5 endpoints, ≥3 schemas), .spectral.yaml, versioning-policy.md, cliente TS, ejemplos | Hecho: `FeathersForAll/api/openapi.yaml` (10 endpoints, 15 schemas), `FeathersForAll/.spectral.yaml`, `FeathersForAll/api/examples/` (5 + runner), `Documentos/api/versioning-policy.md`, `FeathersForAll/packages/api-client/` |
| S06 | DER, event-catalog.md (10–15 eventos), bounded-contexts.md, ADR 0004, C4 L2 con motores y broker | Hecho: `Documentos/data/der.{puml,png}` + `der-completo`, `data/event-catalog.md` (14 eventos), `data/bounded-contexts.md`, `adr/0004-datos-y-eventos.md`, `adr/0005-frontend-react.md`, C4 L2 actualizado, esquema en `code/backend/db/` (01 del equipo + 02 de ajustes S06) |

## Equipo (Charter y README)

Juan (Product Owner), Iván (Tech Lead, arquitectura y ADRs), Ignacio (DevSecOps), Bastián (AI/Data Lead), Cristofer (QA), Alex (QA, automatización). Comunicación por Discord; reuniones lunes o miércoles. Reglas: todo en GitHub Issues, cambios por Pull Request con revisión de otro integrante, ramas `main` y `develop` protegidas, commits en Conventional Commits, IA declarada con trailer `AI-Assisted:`.

## Stack confirmado

Frontend React 19 + Vite en Vercel (ADR 0005, reemplaza "HTML/CSS/JS sin framework" del ADR 0002). Backend Node.js 22 + Express 5 como monolito modular (`code/backend`, ESM, logs pino). Base de datos PostgreSQL 16 + pgvector (BD local de desarrollo "laura"), esquema en `code/backend/db/01_schema.sql`. LLM en desarrollo: Ollama local (`qwen2.5:3b`) detrás de `modules/tutor/llm-client.js`.

## Inconsistencias y decisiones abiertas (resolver antes de S04–S06)

1. (Resuelta en S04) El C4 L2 mantiene "Servicio Tutor IA" como contenedor y ahora incluye Worker/cola con SQS; el ADR 0002 (D2, D3) se alineó con eso.
2. El README lista el ADR 0002 como "Modelo de aislamiento multi-tenant", pero el archivo es de estilo arquitectónico. El aislamiento (schema por tenant vs RLS en PostgreSQL) no está decidido; `TENANT_STRATEGY` en el ejemplo de 12-Factor asume `schema_per_tenant`. Afecta S04 (config, backing services) y S06 (DER).
3. El README describe otra estructura (`CHARTER.md` en raíz, `docs/adr/`, `docs/compromisos-s02.md`, `scripts/bootstrap-board.sh`) que no coincide con la carpeta real `FeathersForAll/Documentos/`. Además enlaza secciones del Charter (#4 DoD, #5 política de IA) con numeración distinta a la del Charter real (DoD es la 7, política de IA la 8).
4. El ADR 0001 está como "eleccion de iniciativa 001.md" (nombre con espacios y sin el formato `0001-...`); el ADR 0002 no tiene fecha ni está aceptado.
5. (Resuelta en S04) Worker/cola incluido con AWS SQS; la elección de broker y catálogo de eventos se profundiza en S06.
6. Métricas de atributos de calidad sin cerrar: SLA exacto (ej. 99.5% en horario escolar) y umbrales de latencia quedan pendientes.
7. Fuera de alcance del backlog actual: panel del apoderado, importación masiva de estudiantes, múltiples intentos por evaluación.
8. (S06) La BDD 3FN inicial tenía FK que dejaban mezclar colegios, roles, preguntas y alternativas; el equipo la reescribió (`code/backend/db/01_schema.sql`, `CAMBIOS_SCHEMA.md`) y S06 le agrega `02_s06_ajustes.sql` (ver ADR 0004).
9. (S06) Frontend real es React + Vite; documentado en ADR 0005 (Propuesto).
10. Atención de diseño para S04–S06: datos de menores (consentimiento parental), picos en periodo de pruebas (escalado horizontal), FinOps del LLM por tenant, RAG limitado al currículum MINEDUC y por tenant.

---

# Documentos del repo (texto completo)

---

### [repo] Charter del equipo  (`Entregables/Charter.md`)

##### Charter del Equipo AulaViva

###### 1. Propósito del equipo

El equipo AulaViva tiene como propósito desarrollar una plataforma educativa SaaS multi-tenant con tutor IA, orientada a mejorar la experiencia de aprendizaje en establecimientos educacionales.

El objetivo es construir una solución segura y escalable que permita gestionar estudiantes, docentes, cursos, evaluaciones y apoyo académico mediante inteligencia artificial, manteniendo la privacidad y aislamiento de datos entre colegios.

---

###### 2. Integrantes del equipo

| Integrante | Rol |
|---|---|
| Juan | Product Owner |
| Iván | Tech Lead |
| Ignacio | DevSecOps |
| Bastián | AI/Data Lead |
| Cristofer | QA |
| Alex | QA |

---

###### 3. Roles y responsabilidades

####### Product Owner (Juan)
- Representar las necesidades del usuario y del negocio.
- Priorizar funcionalidades del producto.
- Gestionar y validar el backlog.
- Definir criterios de aceptación junto al equipo.

####### Tech Lead (Iván)
- Definir la arquitectura técnica del sistema.
- Supervisar decisiones de desarrollo.
- Asegurar buenas prácticas de programación.
- Coordinar soluciones técnicas.

####### DevSecOps (Ignacio)
- Gestionar infraestructura, despliegues y automatización.
- Implementar prácticas de seguridad.
- Apoyar la integración continua y control de versiones.

####### AI/Data Lead (Bastián)
- Diseñar la integración del tutor IA.
- Gestionar datos, modelos y componentes RAG.
- Revisar calidad y seguridad de las respuestas generadas.

####### QA (Cristofer y Alex)
- Diseñar y ejecutar pruebas.
- Validar calidad del producto.
- Detectar errores y verificar cumplimiento de requisitos.

---

###### 4. Valores del equipo

- Comunicación constante y transparente.
- Responsabilidad individual y colaboración.
- Respeto por las opiniones técnicas del equipo.
- Compromiso con la calidad del producto.
- Mejora continua mediante retroalimentación.

---

###### 5. Reglas de trabajo

- Todas las tareas deben estar registradas mediante GitHub Issues.
- Los cambios importantes deben realizarse mediante Pull Request.
- Antes de integrar cambios a la rama principal, deben ser revisados por otro integrante.
- Los problemas técnicos deben comunicarse oportunamente al equipo.
- Las decisiones importantes deben quedar documentadas.

---

###### 6. Comunicación y reuniones

El equipo utilizará Discord como canal principal de comunicación.

Se realizarán reuniones de coordinación los días lunes o miércoles, donde se revisará:

- Avance de tareas.
- Problemas encontrados.
- Próximas actividades.
- Estado del backlog.

---

###### 7. Definition of Done (DoD)

Una tarea será considerada terminada cuando:

- Cumpla los requisitos definidos en la historia de usuario.
- Haya sido implementada y revisada por otro integrante.
- Tenga pruebas realizadas según corresponda.
- No presente errores críticos.
- Sus cambios estén integrados correctamente mediante Pull Request.
- La documentación necesaria esté actualizada.

---

###### 8. Política de uso de Inteligencia Artificial

El equipo podrá utilizar herramientas de IA como apoyo para programación, documentación, análisis y resolución de problemas.

Las reglas serán:

- Todo contenido generado por IA debe ser revisado por un integrante antes de incorporarse al proyecto.
- No se ingresará información sensible o datos reales de estudiantes en herramientas externas.
- La IA será utilizada como herramienta de apoyo y no reemplazará las decisiones del equipo.
- Las respuestas generadas por el tutor IA deben estar basadas en información autorizada del curso.
- Se debe verificar la precisión de los contenidos generados por IA antes de entregarlos a usuarios finales.

---

###### 9. Compromiso del equipo

El equipo AulaViva se compromete a desarrollar una solución segura, colaborativa y orientada a la calidad, aplicando buenas prácticas de ingeniería de software y manteniendo una comunicación efectiva durante todo el proyecto.
---

### [repo] ADR 0001 — Elección de iniciativa  (`adr/eleccion de iniciativa 001.md`)

##### ADR 0001 - Elección de iniciativa AulaViva

###### Contexto

El equipo debía seleccionar una de las iniciativas propuestas para desarrollar durante el taller de Ingeniería de Software.

###### Decisión

Se decidió desarrollar AulaViva debido a su complejidad técnica, impacto educativo y desafíos relacionados con arquitectura SaaS, inteligencia artificial y seguridad.

###### Razones

- Permite aplicar conceptos de ingeniería de software.
- Incluye arquitectura multi-tenant.
- Requiere gestión de usuarios y permisos.
- Incorpora IA mediante RAG.
- Presenta desafíos de privacidad y escalabilidad.

###### Consecuencias positivas

- Permite aplicar buenas prácticas de desarrollo.
- Genera experiencia en tecnologías actuales.
- Facilita trabajo distribuido mediante Scrum y GitHub.

###### Consecuencias negativas

- Mayor complejidad técnica.
- Requiere mayor control de seguridad.
- La implementación del tutor IA implica desafíos adicionales.

###### Fecha

21-08-2026

###### Autores

Equipo AulaViva
---

### [repo] ADR 0002 — Estilo arquitectónico  (`adr/0002-estilo-arquitectonico.md`)

##### ADR 0002 · Elección de estilo arquitectónico para AulaViva

###### Estado

Propuesto — pendiente de aceptación por el equipo (Ignacio Ibañez, Juan Castillo, Iván Oliva, Bastián González, Cristofer Jeria, Alex Flores).

###### Contexto

AulaViva es una plataforma SaaS multi-tenant que debe permitir a cada colegio gestionar cursos, crear evaluaciones auto-corregidas con retroalimentación inmediata, y ofrecer un tutor IA (RAG) que responda dudas ancladas al currículum de cada curso, aislado por tenant.

El equipo está compuesto por 6 personas y el proyecto está en etapa de MVP para el piloto 2026. El dominio (gestión académica + tutor IA) todavía se está descubriendo, por lo que se prioriza poder iterar rápido sin cargar con complejidad operacional innecesaria desde el día uno.

###### Decisión

Se adopta un **modular monolith** como estilo arquitectónico inicial, con fronteras de módulo claras entre: gestión de cursos/matrícula, evaluaciones, y tutor IA (RAG). El módulo de Tutor IA queda diseñado para poder **extraerse como servicio event-driven** más adelante, si el volumen de consultas o su latencia lo justifican.

###### Consecuencias

**Gana:**

- Deploy único, más simple de operar y depurar con un equipo de 6 personas.

- Transacciones ACID naturales entre cursos, matrículas y evaluaciones.

- El módulo de Tutor IA queda delimitado desde el día 1, facilitando una futura extracción sin reescribir el dominio completo.

**Pierde / se vuelve más difícil:**

- Requiere disciplina de módulos: si el monolito no se mantiene realmente modular, la futura extracción del Tutor IA será costosa.

- Escalabilidad acoplada: si el tutor IA necesita escalar de forma independiente al resto del sistema, el monolito no lo permite sin refactor.

###### Alternativas descartadas

- **Microservicios desde el día 0:** complejidad operacional excesiva para un equipo de 6 personas sin DevOps dedicado; no se justifica en la etapa de MVP/piloto.

- **Serverless puro (FaaS):** los cold starts son incompatibles con una experiencia de tutor IA conversacional y fluida para el estudiante.

###### Stack confirmado

- **Frontend:** HTML + CSS + JavaScript (sin framework de SPA), servido por el propio backend.

- **Backend:** Node.js + Express, como monolito único.

- **Base de datos:** PostgreSQL, elegida por su robustez y madurez en la persistencia y validación de datos.

Este stack refuerza la decisión de modular monolith: sin un framework SPA ni microservicios, mantener un único backend Express es la opción más simple de operar para un equipo primerizo de 6 personas.

###### Próximos pasos

- Validar esta decisión con el equipo completo antes de marcarla como "Aceptada".

- Confirmar si el módulo de Tutor IA (RAG) también corre dentro del mismo proceso Express o como servicio separado desde el inicio.
---

### [repo] Atributos de calidad  (`arch/atributos-calidad.md`)

##### Atributos de calidad priorizados — AulaViva

Top 3 atributos de calidad (NFRs) que guían las decisiones arquitectónicas
de AulaViva, en orden de prioridad para el piloto 2026.

###### 1. Seguridad — Aislamiento por tenant (RBAC)
- **Métrica:** 0 casos de fuga de datos entre colegios (tenants) en
  auditoría; control de acceso por rol (docente / estudiante / admin
  colegio) verificado en el 100% de los endpoints.
- **Impacto en la arquitectura:** IAM granular por rol, aislamiento de
  datos por colegio (schema o RLS en PostgreSQL), validación de tenant en
  cada request de la API.
- **Responsable sugerido:** equipo backend / Tech Lead.

###### 2. Disponibilidad — SLA durante horario escolar
- **Métrica:** disponibilidad objetivo durante el horario de clases del
  colegio piloto (a definir el % exacto, ej. 99.5%).
- **Impacto en la arquitectura:** health checks en la API, manejo de
  caídas o timeouts del proveedor LLM sin bloquear el resto del sistema,
  monitoreo básico de errores.
- **Responsable sugerido:** Tech Lead + equipo backend.

###### 3. Mantenibilidad — Lead time de cambios
- **Métrica:** el equipo puede entregar un cambio de módulo (cursos,
  evaluaciones o tutor IA) sin depender de soporte técnico externo ni de
  tocar los otros módulos.
- **Impacto en la arquitectura:** módulos con fronteras claras dentro del
  monolito Express (ver ADR 0002), documentación viva de cada contenedor
  en `docs/c4/`. Al ser un equipo primerizo con HTML/CSS/JS y Express sin
  framework, mantener carpetas/rutas bien organizadas por módulo es clave
  para no acoplar todo en un solo archivo.
- **Responsable sugerido:** todo el equipo.

###### Stack confirmado
Frontend HTML + CSS + JavaScript · Backend Node.js + Express (monolito) ·
Base de datos PostgreSQL.

---
*Nota: las métricas exactas (SLA %, umbrales de latencia, etc.) quedan
pendientes de que el equipo las defina con datos reales del piloto.*
---

### [repo] Impact Map  (`impact-map.md`)

##### Impact Map — AulaViva

> S02 · Insumo para derivar el backlog inicial (`docs/backlog.md`).

###### Objetivo de negocio (Goal)

**Reducir el tiempo que el docente dedica a administrar y corregir evaluaciones, y aumentar el aprendizaje efectivo del estudiante, para incrementar la adopción de AulaViva en los colegios del piloto 2026.**

###### Actores clave elegidos

Del conjunto de actores del sistema (Estudiante, Docente, Coordinador académico, Apoderado, Sostenedor) se seleccionan **Docente** y **Estudiante** como actores clave para esta iteración: son quienes ejecutan el loop central del producto (gestionar curso → evaluar → recibir apoyo IA) y de quienes depende validar el MVP más rápido.

---

###### Rama: Docente

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

###### Rama: Estudiante

```
Goal
 └─ Actor: Estudiante
     ├─ Impacto: Recibe retroalimentación inmediata al terminar una evaluación
     │    └─ Deliverable: Flujo de rendición de evaluación con resultado y feedback al instante
     └─ Impacto: Resuelve dudas de contenido curricular fuera del horario de clases
          └─ Deliverable: Tutor IA con RAG anclado a los apuntes de su propio curso/tenant
```

###### Fuera de alcance de este mapa (queda para próxima iteración)

- **Apoderado** → Panel de seguimiento (MVP ítem 5): no se mapea aún porque depende de que existan resultados de evaluación (rama Docente/Estudiante) primero.
- **Sostenedor / Coordinador académico**: impactos de administración multi-colegio, se abordan al formalizar el modelo de aislamiento multi-tenant (ADR 0002, S03).

---

###### De este mapa a las 5 historias del backlog

| Deliverable del mapa | Historia derivada |
|---|---|
| Gestión de curso y matrícula (RBAC + tenant) | H1 |
| Evaluaciones auto-corregidas con retroalimentación | H2 |
| Dashboard de resultados | H3 |
| Flujo de rendición con feedback inmediato | H4 |
| Tutor IA con RAG por tenant | H5 |

Ver detalle, formato INVEST y priorización MoSCoW en [`docs/backlog.md`](backlog.md).
---

### [repo] Backlog inicial  (`backlog.md`)

##### Backlog inicial — AulaViva

> S02 · Derivado de [`docs/impact-map.md`](impact-map.md). 5 historias, checklist INVEST aplicado a cada una, priorización MoSCoW. Escenarios Gherkin en [`docs/scenarios/`](scenarios/) (3 por historia, 15 en total).

###### Priorización MoSCoW

| Prioridad | Historias | Justificación |
|---|---|---|
| **Must have** | H1, H2, H4 | Forman el loop mínimo funcional: sin curso ni matrícula no hay evaluación, y sin evaluación rendida no hay feedback. Es el MVP mínimo demostrable. |
| **Should have** | H5 | Diferenciador clave de AulaViva (tutor IA con RAG) y parte del alcance mínimo comprometido, pero puede entrar una vez el loop docente-estudiante esté estable. |
| **Could have** | H3 | Aporta valor (visibilidad docente) pero no bloquea el flujo principal; puede iterarse con datos reales una vez existan respuestas registradas. |
| **Won't have (esta iteración)** | Panel de apoderado, importación masiva de estudiantes, múltiples intentos configurables por evaluación | Dependen de que H1–H4 estén validadas primero; quedan para el siguiente ciclo. |

---

###### H1 — Crear curso y matricular estudiantes

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

###### H2 — Crear evaluación auto-corregida

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

###### H3 — Ver dashboard de resultados

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

###### H4 — Rendir evaluación y recibir retroalimentación

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

###### H5 — Consultar al tutor IA

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
---

### [repo] Escenarios Gherkin (`scenarios/`)

#### h1-crear-curso-y-matricular.feature

```gherkin
# language: es
Característica: Crear curso y matricular estudiantes
  Como Docente
  quiero crear un curso y matricular a mis estudiantes en él
  para gestionar mi grupo de forma aislada dentro de mi colegio (tenant)

  Escenario: Un docente crea un curso dentro de su propio colegio
    Dado que soy un docente autenticado en el tenant "Colegio San Rafael"
    Cuando creo un curso llamado "Matemática 8vo Básico" para el periodo "2026-1"
    Entonces el curso queda asociado únicamente al tenant "Colegio San Rafael"

  Escenario: Un docente matricula a un estudiante en su curso
    Dado que existe el curso "Matemática 8vo Básico" en mi tenant
    Cuando matriculo al estudiante con correo "estudiante@sanrafael.cl"
    Entonces el estudiante aparece en la lista de matriculados del curso

  Escenario: No se puede matricular a un estudiante de otro colegio
    Dado que el estudiante "estudiante@otrocolegio.cl" pertenece al tenant "Colegio Los Andes"
    Cuando un docente del tenant "Colegio San Rafael" intenta matricularlo en su curso
    Entonces el sistema rechaza la operación por aislamiento entre tenants
```
#### h2-crear-evaluacion.feature

```gherkin
# language: es
Característica: Crear evaluación auto-corregida
  Como Docente
  quiero crear una evaluación de alternativas con retroalimentación por pregunta
  para ahorrar tiempo de corrección y dar respuesta oportuna a mis estudiantes

  Escenario: Crear una evaluación con preguntas de alternativas
    Dado que existe el curso "Matemática 8vo Básico"
    Cuando creo una evaluación con 5 preguntas de alternativas marcando la respuesta correcta en cada una
    Entonces la evaluación queda disponible para ese curso

  Escenario: Definir retroalimentación por pregunta
    Dado que la evaluación "Prueba Fracciones" está publicada
    Cuando defino un texto de retroalimentación para una de sus preguntas
    Entonces ese texto se muestra al estudiante después de responder esa pregunta

  Escenario: No se puede publicar una evaluación incompleta
    Dado que la evaluación "Prueba Fracciones" tiene una pregunta sin respuesta correcta definida
    Cuando intento publicar la evaluación
    Entonces el sistema impide la publicación y muestra el motivo del rechazo
```
#### h3-dashboard-resultados.feature

```gherkin
# language: es
Característica: Ver dashboard de resultados
  Como Docente
  quiero ver un dashboard con los resultados agregados de una evaluación
  para identificar rápidamente qué contenidos debo reforzar

  Escenario: Ver el resultado agregado de una evaluación
    Dado que la evaluación "Prueba Fracciones" tiene respuestas registradas de sus estudiantes
    Cuando abro el dashboard del curso
    Entonces veo el puntaje promedio y la distribución de aciertos por pregunta

  Escenario: Ver el detalle de un estudiante en particular
    Dado que el dashboard del curso está abierto
    Cuando filtro los resultados por un estudiante específico
    Entonces veo el detalle de sus respuestas y la retroalimentación que recibió

  Escenario: Dashboard sin respuestas registradas todavía
    Dado que ningún estudiante ha respondido la evaluación "Prueba Fracciones"
    Cuando abro el dashboard del curso
    Entonces el sistema muestra un estado vacío en vez de un error
```
#### h4-rendir-evaluacion.feature

```gherkin
# language: es
Característica: Rendir evaluación y recibir retroalimentación
  Como Estudiante
  quiero rendir una evaluación y ver mi retroalimentación inmediatamente al finalizar
  para saber en qué debo reforzar sin esperar la corrección del docente

  Escenario: Rendir una evaluación y recibir feedback inmediato
    Dado que estoy matriculado en el curso "Matemática 8vo Básico" y la evaluación "Prueba Fracciones" está publicada
    Cuando respondo todas las preguntas y envío la evaluación
    Entonces recibo mi puntaje y la retroalimentación de cada pregunta al instante

  Escenario: No se puede rendir dos veces la misma evaluación
    Dado que ya envié mis respuestas a la evaluación "Prueba Fracciones"
    Cuando intento volver a rendir la misma evaluación
    Entonces el sistema me lo impide y me muestra mi resultado anterior

  Escenario: Un estudiante no matriculado no puede acceder a la evaluación
    Dado que no estoy matriculado en el curso "Matemática 8vo Básico"
    Cuando intento acceder a la evaluación "Prueba Fracciones" de ese curso
    Entonces el sistema me deniega el acceso
```
#### h5-tutor-ia.feature

```gherkin
# language: es
Característica: Consultar al tutor IA
  Como Estudiante
  quiero preguntarle al tutor IA dudas sobre el contenido de mi curso
  para resolverlas fuera del horario de clases con información confiable del currículum

  Escenario: El tutor IA responde con base en los apuntes del curso
    Dado que estoy en el curso "Matemática 8vo Básico" con apuntes cargados
    Cuando le pregunto al tutor IA una duda sobre esa materia
    Entonces recibo una respuesta basada en el contenido (RAG) de ese curso

  Escenario: El tutor IA no inventa respuestas fuera del temario
    Dado que le hago una pregunta al tutor IA que está fuera del temario del curso
    Cuando el tutor IA no encuentra contenido de respaldo en los apuntes
    Entonces responde indicando que no tiene información suficiente, sin inventar una respuesta

  Escenario: El tutor IA no usa apuntes de otro colegio
    Dado que soy estudiante del tenant "Colegio San Rafael"
    Cuando le hago una consulta al tutor IA
    Entonces solo se usan como fuente los apuntes de mi propio tenant y curso, nunca los de otro colegio
```
---

### [repo] Diagramas C4 (fuente PlantUML, `c4/`)

#### l1-context.puml

```plantuml
@startuml l1-context
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

LAYOUT_WITH_LEGEND()

title Diagrama de Contexto (C4 Nivel 1) — AulaViva

Person(docente, "Docente", "Crea cursos, evaluaciones y revisa resultados")
Person(estudiante, "Estudiante", "Rinde evaluaciones y consulta al Tutor IA")
Person(admin, "Administrador de colegio", "Gestiona el tenant: matrícula de cursos y usuarios")

System(aulaviva, "AulaViva", "SaaS multi-tenant de gestión académica, evaluaciones auto-corregidas y tutor IA, aislado por colegio")

System_Ext(llm, "Proveedor LLM", "API externa de modelo de lenguaje usada por el Tutor IA (RAG)")
System_Ext(email, "Proveedor Email/SMTP", "Envío de notificaciones a docentes y apoderados")
System_Ext(auth, "Auth institucional (SSO)", "Login institucional del colegio, a validar por tenant")

Rel(docente, aulaviva, "Crea cursos y evaluaciones, revisa dashboard", "HTTPS")
Rel(estudiante, aulaviva, "Rinde evaluaciones, consulta tutor IA", "HTTPS")
Rel(admin, aulaviva, "Administra tenant, matrícula usuarios", "HTTPS")

Rel(aulaviva, llm, "Envía consultas del tutor IA (RAG)", "HTTPS/API")
Rel(aulaviva, email, "Envía notificaciones", "SMTP/API")
Rel(aulaviva, auth, "Valida identidad institucional", "SSO/OAuth2")

@enduml
```
#### l2-container.puml

```plantuml
@startuml l2-container
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

LAYOUT_WITH_LEGEND()

title Diagrama de Contenedor (C4 Nivel 2) — AulaViva

Person(docente, "Docente")
Person(estudiante, "Estudiante")
Person(admin, "Administrador de colegio")

System_Boundary(aulaviva, "AulaViva") {
  Container(web, "Aplicación Web", "HTML + CSS + JavaScript", "Interfaz de docentes, estudiantes y administradores, renderizada por el backend")
  Container(api, "Backend monolítico", "Node.js + Express", "Lógica de negocio, autenticación, RBAC por tenant y renderizado de vistas")
  ContainerDb(db, "Base de datos", "PostgreSQL", "Cursos, evaluaciones, resultados; aislamiento por colegio (schema/RLS)")
  Container(tutor, "Servicio Tutor IA", "RAG + pgvector", "Responde dudas ancladas al currículum del curso/tenant")
  Container(worker, "Worker / cola asíncrona", "Opcional — a validar", "Notificaciones y consultas largas al Tutor IA sin bloquear la API")
}

System_Ext(llm, "Proveedor LLM", "API externa de modelo de lenguaje")
System_Ext(email, "Proveedor Email/SMTP")
System_Ext(auth, "Auth institucional (SSO)")

Rel(docente, web, "Usa", "HTTPS")
Rel(estudiante, web, "Usa", "HTTPS")
Rel(admin, web, "Usa", "HTTPS")

Rel(web, api, "Llama", "HTTPS/JSON")
Rel(api, db, "Lee/escribe", "SQL")
Rel(api, tutor, "Reenvía consultas del tutor IA", "HTTPS/JSON")
Rel(api, worker, "Encola tareas", "HTTPS/cola")
Rel(tutor, db, "Lee apuntes/embeddings del curso", "SQL")
Rel(tutor, llm, "Consulta el modelo", "HTTPS/API")
Rel(worker, email, "Envía notificaciones", "SMTP/API")
Rel(api, auth, "Valida identidad", "SSO/OAuth2")

@enduml
```

Nota: los PNG `l1-context.png` y `l2-container.png` están en el repo junto a los .puml.

---

### [deck del equipo] S04 — De la arquitectura a la nube (FeathersForAll.pdf, 11 láminas)

Decisión cloud: mantener el monolito modular y usar arquitectura cloud híbrida para el piloto (equipo de 6, MVP inicial, menor complejidad operacional, arquitectura de S03, Tutor IA preparado para futura extracción). Alternativas descartadas: microservicios (complejidad operacional) y serverless puro (no necesario para el MVP).

Servicios gestionados: Vercel (frontend), Render (backend, worker y PostgreSQL con aislamiento por colegio schema/RLS), AWS SQS (tareas asíncronas), AWS Secrets Manager (secretos), Amazon CloudWatch (logs, métricas, monitoreo).

Auditoría 12-Factor: Cumple = Codebase (Git), Dependencies (package.json), Port Binding (puerto configurable). Parcial = Config (variables de entorno), Backing Services, Build/Release/Run (CI/CD), Processes (backend stateless), Concurrency (escalamiento), Disposability (graceful shutdown), Dev/Prod Parity, Logs (CloudWatch), Admin Processes (migraciones automatizadas).

Brechas: configuración (secretos fuera del código), despliegue (CI/CD), disponibilidad (health checks y apagado controlado), logs (centralizar), ambientes (dev/prod similares), responsables (cada acción asignada).

C4 L2 actualizado: Frontend (Vercel) → Backend Node/Express (Render) → BD PostgreSQL+pgvector (Render); Servicio Tutor IA (RAG+pgvector) vía HTTP/JSON; Worker/cola (Render) vía SQS hacia LLM y Email/SMTP; secretos en AWS Secrets Manager; logs/métricas a CloudWatch; Auth institucional SSO/OAuth2.

ADR 0003: decisión híbrida Vercel + Render + servicios AWS; beneficios (menor carga operacional, escalabilidad, servicios administrados, mantiene arquitectura S03, foco en producto); trade-offs (varios proveedores, costos variables por consumo, curva de aprendizaje cloud).

Trazabilidad: H1–H4 = Aplicación Web → Backend → PostgreSQL (Vercel → Render → Render PostgreSQL); H5 = Aplicación Web → Backend → Servicio Tutor IA → LLM (Tutor IA → Render → SQS → LLM).

Archivos en el repo: `Documentos/12-factor-checklist.md`, `Documentos/adr/0003-cloud.md`, `Documentos/cloud/managed-services.md`, `Documentos/c4/l2-container.{puml,png}`.

---

### [deck de apoyo, no va al repo] S05 — APIs, contratos y OpenAPI (AulaViva_S05_API.pptx, 12 láminas)

Decisión de estilo: REST/HTTP JSON como API principal + asíncrono (202 Accepted + SQS) para el Tutor IA. GraphQL descartado (un solo consumidor), gRPC descartado (no hay microservicios internos), WebSocket/SSE para más adelante (avisar respuesta del tutor).

Contrato `FeathersForAll/api/openapi.yaml` (OpenAPI 3.1, contract-first), servers `/v1` (prod, staging en Render y local :3000). Seguridad: Bearer JWT del SSO con `tenant_id` y `role` (docente, estudiante, admin_colegio). El tenant nunca viaja en la URL; el backend lo fija con `SET LOCAL app.tenant_id` (RLS). Recurso de otro colegio → 404.

Endpoints (10):
- H1: `POST /courses`, `GET /courses` (cursor, filtro period), `GET /courses/{courseId}`, `POST /courses/{courseId}/enrollments` (por student_email; 409 si ya matriculado).
- H2: `POST /courses/{courseId}/assessments` (crea draft), `PATCH /assessments/{assessmentId}` (status published/closed; 422 si falta correct_option).
- H4: `POST /assessments/{assessmentId}/submissions` (puntaje + feedback al instante; 409 si ya rindió).
- H3: `GET /assessments/{assessmentId}/results` (promedio, % acierto por pregunta, filtro student_id; vacío sin error).
- H5: `POST /courses/{courseId}/tutor-questions` (202 + Location, encola en SQS), `GET /tutor-questions/{questionId}` (status queued/answered/failed, grounded, sources del mismo tenant).

Schemas (15): Problem (RFC 7807 + trace_id + errors[]), CourseInput, Course, CoursePage, EnrollmentInput, Enrollment, QuestionInput, AssessmentInput, Assessment, AssessmentStatusInput, SubmissionInput, SubmissionResult, AssessmentResults, TutorQuestionInput, TutorQuestion. Respuestas de error reutilizables: BadRequest, Unauthorized, Forbidden, NotFound, Conflict, ValidationError, RateLimited (429 por tenant con Retry-After y X-RateLimit-Remaining).

Convenciones: recursos en plural kebab-case sin verbos, propiedades snake_case, Idempotency-Key (UUID) obligatoria en todo POST (24 h), paginación por cursor (cursor, limit, next_cursor), X-Trace-Id en respuestas 2xx.

Toolchain verificado: Spectral (`.spectral.yaml`, extiende spectral:oas + 8 reglas propias) sin problemas; Prism mock (sirve paths sin `/v1` en 127.0.0.1:4010) con 5/5 ejemplos OK (`node api/examples/run-examples.mjs`); cliente TS con openapi-typescript + openapi-fetch (`packages/api-client`, typecheck OK).

Versionado (`Documentos/api/versioning-policy.md`): SemVer en info.version, MAJOR = nuevo prefijo /v2. Compatible: agregar endpoint, campo opcional, query opcional, error documentado. Rompe: eliminar/renombrar, cambiar tipo, volver obligatorio, cambiar auth o identificación del tenant. Deprecación con `deprecated: true` + headers Deprecation y Sunset, plazo mínimo un semestre.

Pendiente post-S05: publicar docs vivas (Swagger UI/Redoc), implementar endpoints en Express siguiendo el contrato, S06 (DER, eventos, bounded contexts, ADR 0004).

---

### [repo] Código en `code/` (estado al 2026-10-07)

- `code/backend`: Express 5 + pino, ESM. Módulo `tutor` con chat de desarrollo `POST /v1/dev/chat` (streaming, modos tutor/pruebas) contra Ollama; `/health` con estado del LLM; errores RFC 7807 con `trace_id`; apagado graceful. Aún sin base de datos conectada. Tests con `node --test` (LLM simulado).
- `code/frontend`: React 19 + Vite. Chat del tutor (modo Tutor y sub-modo Pruebas) y Aula virtual (Inicio, Mis cursos, Notas). Vitest + ESLint. En dev Vite reenvía `/v1` y `/health` al backend; en producción usa `VITE_API_URL`.
- `code/backend/db/` (S06): `01_schema.sql` (equipo) + `CAMBIOS_SCHEMA.md`, `02_s06_ajustes.sql`, `98_test_s06_ajustes.sql` (23 pruebas), `queries.js` (ESM, 43 consultas). Falta subir `99_test_schema.sql` (28 pruebas del 01).

---

### [entregables] S06 — Datos: SQL, NoSQL y arquitecturas event-driven

Bounded contexts: Identidad y tenancy (colegios, usuarios; login en dos pasos RBD → email), Gestión académica (cursos, matrículas), Evaluaciones (evaluaciones, preguntas, alternativas + vista alternativas_publicas, intentos, respuestas) y Tutor IA (apuntes, embeddings, consultas, fuentes). Plataforma: outbox_eventos, claves_idempotencia. Futuro: Seguimiento del apoderado (consume `intento.corregido`). "Estudiante" significa algo distinto en cada contexto (usuario con rol, matriculado, quien rinde, quien consulta). Context map: SSO → Identidad (ACL), Identidad → resto (Open Host: JWT + SET LOCAL app.colegio_id), Gestión académica → Evaluaciones (Customer/Supplier, FK a matrículas), Gestión académica → Tutor IA (evento), Tutor IA → LLM (ACL en llm-client.js).

Esquema base del equipo (`01_schema.sql`, PostgreSQL 16 + citext + pgvector): colegio_id en todas las tablas con FKs compuestas `(x_id, colegio_id)`; rol en la FK con columnas generadas (`docente_rol`, `estudiante_rol`); intentos y consultas exigen matrícula (FK a `matriculas(curso_id, estudiante_id)`); RLS ENABLE+FORCE fail-closed con `app_colegio_id()` (variable `app.colegio_id`, SET LOCAL por transacción); roles `feathersforall_app` (sin BYPASSRLS) y `feathersforall_plataforma` (BYPASSRLS); RESTRICT entre entidades independientes + soft delete (`activo`), CASCADE solo en composición; email CITEXT único por colegio (master con índice propio); una alternativa correcta como máximo; vista `alternativas_publicas` (sin es_correcta, security_invoker); `fecha_cierre`; puntaje 0–100; `es_correcta`, `retroalimentacion` y `puntaje` como corrección CONGELADA (excepción consciente a la 3FN); `embedding vector(768)` (nomic-embed-text) con índice HNSW coseno; `updated_at` con trigger.

Ajustes S06 (`02_s06_ajustes.sql`): `colegio_id DEFAULT app_colegio_id()`; `cursos.periodo` (AAAA-S1|S2, obligatorio) y `asignatura`; `preguntas.retroalimentacion` (el docente la define; se copia congelada a la respuesta); consultas al tutor asíncronas (`estado` en_cola/respondida/fallida, respuesta opcional, `con_respaldo`, `respondida_at`, CHECK de coherencia) + `consultas_fuentes` (apunte del mismo curso por FK); `outbox_eventos` (tipo `recurso.accion`, payload solo IDs, `intentos`) y `claves_idempotencia` (PK colegio+clave, operación, 24 h), ambas con RLS; función `colegio_por_rbd()` SECURITY DEFINER (dueña plataforma) para el login. Verificado: 23 pruebas en `98_test_s06_ajustes.sql`, 43 consultas de `queries.js` compilan y flujo H1→H5 completo como `feathersforall_app` bajo RLS.

Eventos (14, `recurso.accion_en_pasado`, v1.0, sobre con event_id, event_type, event_version, occurred_at, colegio_id, aggregate_id, trace_id, data): colegio.creado, usuario.creado, curso.creado, estudiante.matriculado, evaluacion.creada, evaluacion.publicada, evaluacion.cerrada, intento.enviado, intento.corregido, apunte.cargado, apunte.indexado, consulta_tutor.encolada, consulta_tutor.respondida, consulta_tutor.fallida. Publicados en SQS en el MVP: usuario.creado, estudiante.matriculado, evaluacion.publicada, apunte.cargado, consulta_tutor.encolada; el resto queda en outbox. Relay en el worker con rol plataforma.

ADR 0004 (Propuesto): PostgreSQL con RLS + pgvector en el mismo motor; archivos fuera de la BD (S07); SQS at-least-once con consumidores idempotentes por event_id. Patrones: Outbox sí (FOR UPDATE SKIP LOCKED), idempotencia sí, CQRS liviano (puntaje guardado + consultas agregadas); Event Sourcing, Saga y CDC no. Descartados: base vectorial dedicada, Redis, MongoDB/JSON para exámenes, Kafka/RabbitMQ, email único global. Por confirmar: dimensión del vector, escala 0–100 vs 1.0–7.0, retención de consultas al tutor, almacenamiento de archivos.

ADR 0005 (Propuesto): frontend React + Vite en Vercel; reemplaza la línea de frontend del ADR 0002.

C4 L2 (S06): Frontend React+Vite (Vercel) → Backend Express (Render, rol feathersforall_app, SET LOCAL app.colegio_id) → PostgreSQL 16 + pgvector (Render; RLS fail-closed, outbox, idempotencia); Worker (relay de outbox con rol plataforma y consumidor) ↔ AWS SQS; Servicio Tutor IA → embeddings; externos LLM (Ollama en dev), Email, SSO, Secrets Manager, CloudWatch.

Hito parcial 1 (inicio de S07): presentar la arquitectura en 5 minutos (charter, backlog, C4, 12-Factor, OpenAPI, modelo de datos).
