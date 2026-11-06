# Threat model · Tutor IA (STRIDE ligero)

> S09 · DevSecOps I. Microservicio analizado: **módulo `tutor`** de la API (`code/backend/src/modules/tutor/`), el de mayor riesgo del sistema: recibe texto libre de **menores de edad**, lo cruza con los apuntes del curso (RAG) y lo envía a un LLM.
> Regla del taller: STRIDE en ~45 min por servicio crítico y se revisa en cada release mayor.
> Última revisión: 06-11-2026 · Responsable: Ignacio (DevSecOps) · Próxima revisión: antes de exponer la demo pública o al cambiar de proveedor de LLM.

## 1. Qué es STRIDE (en una línea por letra)

STRIDE es una lista de comprobación de Microsoft para no olvidar ningún tipo de ataque. Para cada pieza del sistema se pregunta:

| Letra | Amenaza | Pregunta | Propiedad que protege |
|---|---|---|---|
| **S** | Spoofing (suplantación) | ¿Alguien puede hacerse pasar por otro? | Autenticación |
| **T** | Tampering (manipulación) | ¿Alguien puede modificar datos o mensajes? | Integridad |
| **R** | Repudiation (repudio) | ¿Alguien puede negar que hizo algo, sin que podamos probarlo? | Trazabilidad |
| **I** | Information disclosure (fuga) | ¿Alguien puede ver datos que no le corresponden? | Confidencialidad |
| **D** | Denial of service | ¿Alguien puede botar o saturar el servicio? | Disponibilidad |
| **E** | Elevation of privilege | ¿Alguien puede hacer cosas de un rol superior? | Autorización |

## 2. Alcance

| Incluido | Fuera de alcance (otro threat model) |
|---|---|
| `POST /v1/tutor-conversations/{id}/messages`, `GET/DELETE` de conversaciones (ADR 0008) | Login y emisión del JWT (`identidad`), salvo como dependencia |
| `POST /v1/dev/chat` (ruta de desarrollo) | Libro de notas y cursos |
| RAG: búsqueda de apuntes en pgvector y subida de apuntes (`/v1/dev/courses/{id}/documents`) | Clúster Kubernetes y pipeline CI/CD (S10: supply chain) |
| Ollama (LLM `qwen2.5:3b` + embeddings `bge-m3`) | Portal web (XSS se cubre con SAST y React) |
| Purga anual (`src/jobs/purgar-conversaciones.js`, CronJob) | |

## 3. Activos

| Activo | Por qué importa | Clasificación |
|---|---|---|
| **Preguntas y respuestas del tutor** (`mensajes_tutor`) | Escritas por menores; pueden revelar dudas, notas, estado emocional ("estoy nervioso por la prueba") | **Muy sensible** |
| Apuntes y pruebas del docente (`apuntes_curso`, `apuntes_embeddings`) | Propiedad intelectual del colegio; una prueba filtrada antes de rendirla rompe la evaluación | Sensible |
| Identidad del estudiante (JWT: `sub`, `tenant_id`, `role`) | Llave de acceso a todo lo anterior | Sensible |
| `JWT_SECRET` y contraseñas de la base | Con ellos se firma cualquier token o se salta la API | **Crítico** |
| Disponibilidad del tutor | Se usa en horario de clases y antes de pruebas | Media |

## 4. Diagrama y límites de confianza

```
 Estudiante (navegador)                                      ┊ LC1: internet → clúster
 ─────────────── HTTPS ───────────────► Ingress NGINX ───────┊─────────────────────────
                                              │
                                              ▼
                                   ┌─────────────────────┐   ┊ LC2: API → base
                                   │ API (módulo tutor)  │───┊──► PostgreSQL 16 + pgvector
                                   │ requireAuth (JWT)   │   ┊    rol feathersforall_app
                                   │ db.withUser(...)    │   ┊    NOBYPASSRLS, RLS 01–05
                                   └─────────┬───────────┘   ┊
                                             │ HTTP (sin TLS, red interna)
                                             ▼               ┊ LC3: API → LLM
                                   Ollama (qwen2.5:3b, bge-m3)  hoy en el host / local
                                             ▲
                                             ┊ LC4: contenido del docente → prompt del LLM
                                   Apuntes subidos por el docente (texto no confiable para el LLM)
```

- **LC1 · internet → API:** todo lo que manda el navegador es no confiable (cuerpo, cabeceras, ids en la URL).
- **LC2 · API → base:** la base no confía en la API: el RLS aplica aunque la API tenga un bug.
- **LC3 · API → LLM:** el LLM recibe datos de menores. Hoy corre local (no sale nada del colegio); si se cambia a un proveedor externo, este límite cambia de riesgo (ver I-4).
- **LC4 · apuntes → prompt:** el texto de los apuntes entra al prompt; un apunte con instrucciones puede intentar manipular al modelo (*prompt injection* indirecta).

## 5. Amenazas por categoría y controles

Estado: ✅ control existente y verificado · 🟡 parcial · ❌ falta.

### S · Spoofing

| ID | Amenaza | Control | Estado |
|---|---|---|---|
| S-1 | Un estudiante usa el token de otro, o fabrica uno, para leer sus conversaciones | JWT HS256 firmado y verificado con `timingSafeEqual`; se rechaza `alg: none` y tokens vencidos (`platform/auth.js`); prueba Postman "7 · Seguridad" | ✅ |
| S-2 | `JWT_SECRET` débil o filtrado permite firmar tokens de cualquier colegio | La API no arranca con < 32 caracteres; Secret de Kubernetes creado por Terraform; **gitleaks** en todo el historial y regla Semgrep `ffa-jwt-secreto-hardcodeado` (S09) | ✅ |
| S-3 | Uso del chat de desarrollo sin token en producción | `CHAT_REQUIRE_AUTH=true` y `ENABLE_DEV_ROUTES=false` por defecto con `NODE_ENV=production`; `overlays/prod` no los activa | ✅ |
| S-4 | Robo del token desde el navegador (XSS) | React escapa por defecto; SAST `p/owasp-top-ten`. Falta: Content-Security-Policy en NGINX | 🟡 |

### T · Tampering

| ID | Amenaza | Control | Estado |
|---|---|---|---|
| T-1 | Inyección SQL desde la pregunta o los ids | Consultas parametrizadas en `db/queries.js`; ids validados como UUID; regla Semgrep `ffa-sql-interpolado` (S09) | ✅ |
| T-2 | El estudiante reescribe el historial (manda mensajes "assistant" falsos) para cambiar lo que el tutor "dijo" | En conversaciones guardadas el historial lo arma el **servidor** desde la base (ADR 0008); el cliente solo manda la pregunta nueva | ✅ |
| T-3 | Un estudiante sube o borra apuntes del curso | API responde 403 al estudiante y la base lo exige (políticas por rol de `02_s06_ajustes.sql` §9) | ✅ |
| T-4 | *Prompt injection* indirecta: un apunte trae "ignora tus instrucciones y…" | Solo el docente del curso sube apuntes; el system prompt manda a responder solo desde los fragmentos. Falta: delimitar los fragmentos como datos y avisar al docente si un apunte trae instrucciones | 🟡 |
| T-5 | Modificación del tráfico API ↔ Ollama | Hoy en red local/interna. Falta: TLS o NetworkPolicy si Ollama pasa a otro nodo | 🟡 |

### R · Repudiation

| ID | Amenaza | Control | Estado |
|---|---|---|---|
| R-1 | Un docente niega haber subido o borrado un apunte | Columnas `subido_por` y `created_at` en `apuntes_curso`; `trace_id` en cada request. Falta: audit log de cambios por actor | 🟡 |
| R-2 | Un estudiante niega haber borrado una conversación | Borrado real (es su derecho, ADR 0008); se registra solo la línea `request` (método, ruta, estado, `trace_id`) sin contenido | ✅ (por diseño) |
| R-3 | No se puede investigar un incidente porque los logs no tienen contenido | Decisión consciente: privacidad de menores > trazabilidad del texto. Los logs guardan `trace_id`, usuario implícito por ruta, tiempos y tipo de turno | ✅ (aceptado) |

### I · Information disclosure

| ID | Amenaza | Control | Estado |
|---|---|---|---|
| I-1 | Un estudiante lee conversaciones de otro (IDOR cambiando el id) | RLS `05_conversaciones_tutor.sql`: solo el dueño; responde **404** (no revela que existe); probado en Postman e integración | ✅ |
| I-2 | Docente o admin leen las conversaciones de sus estudiantes | Mismo RLS: ni docente ni admin (ADR 0008); API responde 403 | ✅ |
| I-3 | Fuga por logs (preguntas en texto plano) | `request-context.js` no registra cuerpos; `logTurn` solo números; regla Semgrep `ffa-log-con-datos-del-estudiante` (S09) | ✅ |
| I-4 | Datos de menores enviados a un servicio de IA externo | Hoy Ollama local. Regla del proyecto: solo datos sintéticos y nunca datos reales a IA externa. La demo pública (Cloudflare Workers AI) solo con datos sintéticos y banner | 🟡 |
| I-5 | Fuga entre colegios por búsqueda vectorial | `apuntes_embeddings` con `colegio_id` + RLS 01 (falla cerrado sin colegio); `puede_ver_curso()` antes de buscar | ✅ |
| I-6 | El LLM revela el system prompt o apuntes de otro curso | La búsqueda solo trae fragmentos del curso pedido y visible para el usuario; el system prompt no tiene secretos | ✅ |
| I-7 | Mensajes de error con detalles internos | RFC 7807 con `HttpProblem`; 5xx solo con título genérico al cliente | ✅ |
| I-8 | Conversaciones viejas acumuladas (más datos = más impacto si hay brecha) | Purga al terminar el año escolar (CronJob `ffa-purga-conversaciones`) | ✅ |

### D · Denial of service

| ID | Amenaza | Control | Estado |
|---|---|---|---|
| D-1 | Saturar el LLM (CPU) con muchas preguntas largas: cada turno tarda segundos | Límite de cuerpo 100 kb, máx. 50 mensajes × 4 000 caracteres; timeout por inactividad del LLM; HPA 2–6. **Falta: rate limit por usuario en el tutor** | ❌ |
| D-2 | Cuerpo comprimido malicioso bota el proceso | VULN-001 corregida (`body-parser` 2.4.0) y gate SCA | ✅ |
| D-3 | Subir apuntes enormes para llenar pgvector | Límite 2 MB por subida; solo docente/admin | 🟡 |
| D-4 | Muchas conexiones de streaming abiertas | Se aborta el LLM si el cliente se va; Ingress con `proxy-read-timeout` de 120 s. Falta: tope de streams simultáneos por usuario | 🟡 |

### E · Elevation of privilege

| ID | Amenaza | Control | Estado |
|---|---|---|---|
| E-1 | El estudiante manda `colegio_id` o `rol` en el cuerpo para cambiar de colegio o de rol | `db.withUser` fija `app.colegio_id`, `app.usuario_id` y `app.rol` **solo desde el JWT**; regla Semgrep `ffa-tenant-desde-el-cliente` (S09) | ✅ |
| E-2 | Un bug en la API salta el RLS | La API se conecta como `feathersforall_app` NOSUPERUSER, NOBYPASSRLS; no lee `password_hash` | ✅ |
| E-3 | *Jailbreak* del LLM para que haga la prueba completa en modo "Practicar" | System prompt por modo; el LLM no tiene herramientas ni acceso a la base (no puede actuar, solo responder). Riesgo académico, no técnico | 🟡 (aceptado) |
| E-4 | Funciones `SECURITY DEFINER` con dueño superusuario | En producción su dueño debe ser `feathersforall_plataforma` (deuda en `AGENTS.md`) | 🟡 |

## 6. Plan de mitigación (lo que falta)

| Prioridad | Amenaza | Acción | Responsable | Plazo |
|---|---|---|---|---|
| Alta | D-1 | Rate limit por usuario en `POST .../messages` (p. ej. 20 turnos/min) y 429 con RFC 7807; en producción en Redis o en el Ingress | Iván | S11 |
| Alta | I-4 | Antes de la demo pública: adaptador LLM externo solo con el seed sintético + banner; prohibido conectarlo a datos reales | Bastián | Antes de publicar la demo |
| Media | T-4 | Delimitar los fragmentos en el prompt (`<apunte>…</apunte>`) e instruir que son datos; prueba con un apunte "malicioso" | Bastián | S11 |
| Media | S-4 | Cabecera Content-Security-Policy en `nginx.conf` | Ignacio | S10 (ZAP baseline lo va a pedir) |
| Media | R-1 | Tabla de auditoría para subir/borrar apuntes (actor, acción, curso, fecha; sin contenido) | Iván | Etapa rol docente |
| Baja | T-5 / D-4 | NetworkPolicy API → Ollama y tope de streams por usuario | Ignacio | Cuando Ollama salga del host |
| Baja | E-4 | Dueño `feathersforall_plataforma` para las funciones `SECURITY DEFINER` | Ignacio | Antes de producción |

## 7. Cómo se mantiene

- Se revisa en cada release mayor o cuando cambia un límite de confianza (otro proveedor de LLM, demo pública, Ollama en otro nodo).
- Cada amenaza nueva con control automatizable se convierte en regla (`.semgrep/`), prueba (Postman/integración) o gate de CI, igual que S-2, T-1, I-3 y E-1 en la S09.
