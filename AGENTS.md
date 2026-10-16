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
| Base de datos | `code/backend/db/` | PostgreSQL 16 + pgvector + citext. Se aplican en orden `01`, `02`, `03` y `04`, luego `permisos_app.sql` y el seed `90_seed_demo.sql`. Todas las consultas están en `queries.js` |
| Frontend | `code/frontend/` | React 19 + Vite (ADR 0005). `index.html` = chat del tutor; `portal.html` = portal por rol (`src/portal/`, router por hash `#/portal/<id>`) |
| Contrato | `FeathersForAll/api/` | OpenAPI 3.1 con ejemplos ejecutables contra Prism |
| Infra | `k8s/`, `terraform/` | Laboratorio S07: kind + Kustomize + Terraform (ADR 0006) |
| Documentos | `FeathersForAll/Documentos/` | ADRs, C4, backlog, escenarios Gherkin, datos (DER, eventos, bounded contexts) y prototipo del portal (`diseno/prototipo-portal.html`) |

## Seguridad multi-tenant (no romper)

**Conexión de la API a la base**
- La API se conecta como `feathersforall_app` (**NOSUPERUSER, NOBYPASSRLS**).
- Cada request corre en `db.withUser(req.user, fn)` (`src/platform/db.js`), que fija `app.colegio_id`, `app.usuario_id` y `app.rol` desde el **JWT verificado**, nunca desde el cuerpo.

**Capas de RLS**
- `01`: aislamiento por colegio, que falla cerrado si la sesión no tiene colegio.
- `02` §9: quién puede escribir, según el rol.
- `04`: quién puede leer. El estudiante ve solo lo suyo, el docente solo sus cursos y una sesión sin rol no ve nada.

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
- **S08 (CI/CD y GitOps):** pendiente; su PPT todavía no está en `models.md`.

### Etapa 1 — rol estudiante (cerrada el 16-10-2026, rama `feat/estudiante-asignaturas-notas`, sin commitear)

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
- **Tutor IA dentro del portal.**
- **Demo pública gratuita:** investigada (informe PDF enviado el 16-10-2026): Vercel Hobby + Render Free + Neon Free + Cloudflare Workers AI (bge-m3). Falta: adaptadores LLM/embeddings compatibles con OpenAI, `vercel.json`, `render.yaml` y banner de datos sintéticos. Ya corregido: `ALTER ROLE` sin `NOSUPERUSER` (fallaba en Postgres gestionados).
- **S08:** CI/CD con quality gates (Newman y Compose).

## Pendientes y deuda conocida

- En `main` hay cambios sin commitear de antes de la etapa 1:
  - el Dockerfile ahora copia `db/queries.js`;
  - arreglos del chat y del almacén JSON;
  - el rebrand a FeathersForAll.
- **Contrato S05 sin implementar:** evaluaciones (crear, publicar, rendir) y tutor asíncrono (`tutor-questions`).
- **Limitador del login:** guarda los intentos en memoria, así que cada pod cuenta los suyos. En producción iría en Redis o en el Ingress.
- **Funciones `SECURITY DEFINER`** (`colegio_por_rbd`, `credenciales_login`): en producción su dueño debe ser `feathersforall_plataforma`. Hoy, en local, es el superusuario.
