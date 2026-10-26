# AGENTS.md — contexto del proyecto para agentes de IA y personas nuevas

> Léelo antes de tocar el repo. Se actualiza al cerrar cada etapa.
> El contenido de las clases del taller (PPT S01–S07) y el estado por sesión están en [`models.md`](models.md); la vista general, en [`readme.md`](readme.md).

## Qué es

**FeathersForAll** (iniciativa *AulaViva* del Taller de Ingeniería de Software 2026, 18 sesiones) es un SaaS **multi-tenant** para colegios: 1 colegio = 1 tenant aislado. Ofrece cursos, evaluaciones auto-corregidas con notas en escala chilena 1,0–7,0 y un **tutor IA con RAG** sobre los apuntes de cada curso.

| Integrante | Rol |
|---|---|
| Juan | Product Owner |
| Iván | Tech Lead |
| Ignacio | DevSecOps |
| Bastián | AI/Data |
| Cristofer | QA |
| Alex | QA |

## Reglas de trabajo (obligatorias)

- **Idioma:** todo en **español (es-CL)**: respuestas, comentarios, documentos y commits. Los identificadores de código quedan en su idioma.
- **Datos de menores:**
  - Solo se usan datos **sintéticos**.
  - Nunca se envían datos personales reales a servicios de IA.
  - Los logs no guardan cuerpos de request ni preguntas al tutor.
- **Git:**
  - Commits en Conventional Commits, con el trailer `AI-Assisted:` cuando se usó IA.
  - **No hacer commit ni push sin que el usuario lo pida.**
  - Trabajar en ramas `feat/...` y abrir PR contra `main`; el remoto no tiene `develop`.
- **Contract-first:**
  - Todo cambio de API va también en `FeathersForAll/api/openapi.yaml`, con lint de Spectral (`FeathersForAll/.spectral.yaml`) y el cliente TS regenerado (`FeathersForAll/packages/api-client`).
  - Versionado según `FeathersForAll/Documentos/api/versioning-policy.md`.
- **Errores:** RFC 7807, con `HttpProblem` de `code/backend/src/platform/problem.js`.
- **Decisiones caras de revertir:** van en un ADR en `FeathersForAll/Documentos/adr/` (plantilla `template.md`) y se enlazan en la tabla de `readme.md`.

## Stack y mapa del repo

| Pieza | Dónde | Notas |
|---|---|---|
| API | `code/backend/` | Node.js 22 + Express 5, monolito modular (ADR 0002). Módulos en `src/modules/`: `tutor` (RAG), `notas`, `identidad`, `cursos`. Plataforma en `src/platform/`: db, auth JWT, errores, contraseñas |
| Base de datos | `code/backend/db/` | PostgreSQL 16 + pgvector + citext. Se aplican en orden `01` a `05`, luego `permisos_app.sql` y el seed `90_seed_demo.sql`. Todas las consultas están en `queries.js` |
| Frontend | `code/frontend/` | React 19 + Vite (ADR 0005). `index.html` = chat del tutor; `portal.html` = portal por rol (`src/portal/`, router por hash `#/portal/<id>`) |
| Contrato | `FeathersForAll/api/` | OpenAPI 3.1 con ejemplos ejecutables contra Prism |
| Infra | `k8s/`, `terraform/` | Laboratorio S07: kind + Kustomize + Terraform (ADR 0006) |
| CI/CD | `.github/workflows/`, repo `Erolayer-Cl/feathersforall-gitops` | S08 (ADR 0009): gates bloqueantes en cada PR, imágenes a GHCR por sha y GitOps con Argo CD. Guía: `Documentos/infra/ci-cd.md` |
| Documentos | `FeathersForAll/Documentos/` | ADRs, C4, backlog, escenarios Gherkin, datos (DER, eventos, bounded contexts) y prototipo del portal (`diseno/prototipo-portal.html`) |

## Seguridad multi-tenant (no romper)

**Conexión de la API a la base**
- La API se conecta como `feathersforall_app` (**NOSUPERUSER, NOBYPASSRLS**).
- Cada request corre en `db.withUser(req.user, fn)` (`src/platform/db.js`), que fija `app.colegio_id`, `app.usuario_id` y `app.rol` desde el **JWT verificado**, nunca desde el cuerpo.

**Capas de RLS**
- `01`: aislamiento por colegio, que falla cerrado si la sesión no tiene colegio.
- `02` §9: quién puede escribir, según el rol.
- `04`: quién puede leer. El estudiante ve solo lo suyo, el docente solo sus cursos y una sesión sin rol no ve nada.
- `05`: conversaciones del tutor (ADR 0008). Solo el estudiante dueño las lee, escribe y borra; ni el docente ni el admin. Se purgan al terminar el año escolar (`npm run tutor:purgar`).

**Contraseñas**
- La API no puede leer `password_hash`: tiene permisos por columna (`permisos_app.sql`).
- El login usa la función `credenciales_login()` (`SECURITY DEFINER`).

**Respuestas de acceso denegado**
- **404** si el recurso es de otro colegio o no participas en él.
- **403** si eres del colegio pero tu rol no permite la acción.

**JWT**
- HS256, con solo `sub`, `tenant_id` y `role`.
- Se emite en `POST /v1/auth/login` (RBD + correo + contraseña). Para pruebas también existe `npm run dev:token`.

## Cómo correrlo en local

```bash
cd code/backend
docker compose up -d                 # PostgreSQL 16 + pgvector con esquema y datos demo (down -v = empezar de cero)
npm install && npm run dev           # API en http://localhost:3000 (requiere JWT_SECRET en .env; ver .env.example)
npm test                             # pruebas unitarias (sin base ni Ollama)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test   # también las de integración

cd ../frontend
npm install && npm run dev           # portal en http://localhost:5173/portal.html
```

- **Tutor IA:** usa Ollama local (`ollama serve`) con los modelos `qwen2.5:3b` y `bge-m3`. Los apuntes demo se cargan con `npm run ingest`.
- **Postman:** `code/backend/requests/postman/` (colección + environment); `npm run test:postman` la corre con Newman.
- **Credenciales demo:** RBD `99901` (Colegio Demo A) o `99902` (B), correos en `code/backend/README.md`, contraseña `demo1234`.

## Estado

- **Sesiones S01–S07:** hechas (detalle en `readme.md` y `models.md`).
- **S08 (CI/CD y GitOps):** preparada el 26-10-2026 en la rama `Ignacio` (detalle abajo). Su PPT ya está en `models.md`.

### Etapa 1 — rol estudiante (cerrada el 16-10-2026; commit `29cccce`, llevado a la rama `Ignacio`, donde sigue el trabajo)

**Objetivo:** que cada estudiante inicie sesión en el portal y vea sus asignaturas y sus notas, solo en modo lectura, con privacidad por usuario y el RAG funcionando multi-tenant.

- [x] Base local con Docker Compose (`code/backend/compose.yaml`).
- [x] `04_privacidad_login.sql` + `permisos_app.sql` + seed con hashes scrypt (clave demo `demo1234`). Suite SQL `98`: 52/52.
- [x] API: `POST /v1/auth/login`, `GET /v1/me`, `GET /v1/courses[/{id}]` y `GET /v1/me/grades` (todos los ramos, con `tutor_available`). Pruebas backend: 183/183 (`test/pg-fixture.js` usa el rol `feathersforall_app_test` para no cambiar la clave de la API).
- [x] Portal: login con RBD, guardia de rutas, Inicio, Mis cursos, Curso y Mis notas con datos reales. Frontend: 55 pruebas vitest + recorrido con Brave headless (escritorio y 360 px). Se corrigió `base.css` (el reset de botones pisaba el color de los componentes: contraste del login).
- [x] Pruebas (backend y frontend), contrato OpenAPI v1.1.0 (Spectral sin errores, cliente TS regenerado, 7 ejemplos Prism OK), colección Postman (40 requests, 69 aserciones; carpeta del tutor verificada con Ollama).
- [x] ADR 0007 (autenticación y privacidad) y `Documentos/api/permisos.md`.
- [x] Agente `.claude/agents/revisor-ux.md` (`subagent_type: revisor-ux`): revisó Login, Inicio, Mis cursos, Curso, Mis notas y Configuración. Sus 31 hallazgos están corregidos (contraste AA, foco, estados 403/404, tabla en celular, botones sin función). Informe y checklist para el docente: `FeathersForAll/Documentos/diseno/revision-ux-portal.md`.
- **Falta:** que el equipo revise y apruebe los commits propuestos y el PR contra `main`. El ADR 0007 sigue en estado "Propuesto" hasta la reunión del equipo.

### Próximas etapas

- **Rol docente:**
  - subir archivos a la asignatura (pruebas y apuntes) para alimentar el RAG;
  - crear cursos y matricular estudiantes (Idempotency-Key + outbox);
  - libro de notas;
  - evaluaciones.
- **Admin:** gestión de usuarios.
- ~~**Tutor IA dentro del portal.**~~ Hecho el 16-10-2026 en la rama `Ignacio`: pantalla `est-tutor[/<curso>]` con modos Estudiar y Practicar una prueba, selector de curso, fuente de cada respuesta y enlaces desde Inicio y Curso. Verificado con Ollama y Brave headless (escritorio, 360 px y tema oscuro).
  - 19-10-2026: el selector de asignatura pasó al cuadro donde se escribe (flecha hacia abajo).
  - 19-10-2026: **conversaciones guardadas** (ADR 0008, contrato v1.2.0, `db/05_conversaciones_tutor.sql`): historial "Mis conversaciones" por curso, retomar y borrar; el servidor guarda el historial. Pruebas: backend 123 sin base / 221 con integración, frontend 84, Postman carpeta 8 (58 requests y 102 aserciones en total). Retención: CronJob diario `k8s/cronjob-purga.yaml` con Secret aparte `ffa-jobs-secrets` (Terraform), job en `src/jobs/purgar-conversaciones.js`. Verificado con Brave headless (privacidad entre estudiantes incluida).
- **Auditoría de rendimiento y base de datos** (23-10-2026): informe en `FeathersForAll/Documentos/auditoria/rendimiento-y-base-de-datos.md`. La base no es el cuello de botella (endpoints < 12 ms con 6 000 estudiantes y 96 000 fragmentos; búsqueda de apuntes ~5 ms, recall 100 %); el tiempo del tutor lo domina el LLM en CPU. Aplicado: log `tutor` con tiempos por fase, `LLM_KEEP_ALIVE=30m` (primera pregunta tras una pausa: 18,8 s → 8,4 s) y `shm_size` en el compose. Propuestas P1–P8 pendientes de decidir en equipo.
- **Currículum Mineduc en el RAG:** pendiente. Está en los requisitos (`readme.md`), pero hoy el RAG solo usa los apuntes del docente. Ignacio buscará una fuente confiable; no cargar contenido del Mineduc hasta entonces. Diseño conversado: un corpus compartido de solo lectura por asignatura y nivel, sin `colegio_id`.
- **Demo pública gratuita:** investigada (informe PDF enviado el 16-10-2026): Vercel Hobby + Render Free + Neon Free + Cloudflare Workers AI (bge-m3). Falta: adaptadores LLM/embeddings compatibles con OpenAI, `vercel.json`, `render.yaml` y banner de datos sintéticos. Ya corregido: `ALTER ROLE` sin `NOSUPERUSER` (fallaba en Postgres gestionados).
- **S08 — CI/CD y GitOps** (26-10-2026, ADR 0009, guía `FeathersForAll/Documentos/infra/ci-cd.md`):
  - `ci.yml`: contrato, lint, cobertura ≥ 70 % (en rojo bajo 70 %; backend 98,9 %, frontend 91 % sobre `src/**/*.js`), SCA, Semgrep, Newman con Compose (sin tutor) y Trivy; en `main`, push a GHCR y PR al repo gitops. `promote-prod.yml` con Environment `production`.
  - Repo gitops armado en `../feathersforall-gitops` (`git init`, sin commit).
  - Los gates encontraron 3 vulnerabilidades, ya corregidas y registradas con CVE, CWE y CVSS en `FeathersForAll/Documentos/seguridad/vulnerabilidades.md`: body-parser 2.4.0, API en `distroless/nodejs22-debian13` y web en `nginx-unprivileged:1.30-alpine` + `apk upgrade`.
  - **Falta (equipo):** crear el repo en GitHub y hacer push, `GITOPS_TOKEN`, Environment `production`, protección de rama con 2 revisores, paquetes GHCR públicos, Argo CD v3.5.6 en kind con screenshot Synced/Healthy y la primera run verde en `main`.
  - Gates para S09: cobertura de `.jsx`/hooks (Testing Library), gitleaks, SBOM + cosign, ZAP baseline y Dependabot.

## Pendientes y deuda conocida

- En `main` hay cambios sin commitear de antes de la etapa 1:
  - el Dockerfile ahora copia `db/queries.js`;
  - arreglos del chat y del almacén JSON;
  - el rebrand a FeathersForAll.
- **Contrato S05 sin implementar:** evaluaciones (crear, publicar, rendir) y tutor asíncrono (`tutor-questions`). El Tutor IA del portal ya usa las rutas del contrato v1.2 (`tutor-conversations`); `POST /v1/dev/chat` queda para desarrollo y docentes.
- **CORS:** el backend no tiene. Hoy no hace falta (Vite y NGINX sirven todo desde un solo origen), pero la demo pública (Vercel + Render) sí lo necesita, exponiendo `X-Tutor-Turn`, `X-Rag-Sources` y `X-Conversation-Mode` con `Access-Control-Expose-Headers`.
- **Propuestas de la auditoría sin decidir** (detalle en el informe): LLM con GPU o proveedor externo, reordenar el prompt del tutor (~2 s menos), quitar el índice HNSW que no se usa (750 MB), RLS del docente sin consulta por fila y `UV_THREADPOOL_SIZE` (login ~25/s por proceso).
- **Imagen de la API: 211 MB**, sobre la meta de < 200 MB del ADR 0006 (la base distroless debian13 ya pesa 203 MB).
- **`k8s/` duplicado con `base/` del repo gitops:** desde S08 manda el repo gitops; si se cambia un manifiesto, hay que cambiarlo en ambos lados (o borrar `k8s/` cuando el equipo lo decida).
- **Puerto 5432:** si hay un PostgreSQL nativo instalado, el contenedor no arranca (ver README del backend).
- **Limitador del login:** guarda los intentos en memoria, así que cada pod cuenta los suyos. En producción iría en Redis o en el Ingress.
- **Funciones `SECURITY DEFINER`** (`colegio_por_rbd`, `credenciales_login`): en producción su dueño debe ser `feathersforall_plataforma`. Hoy, en local, es el superusuario.
