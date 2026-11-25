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
| API | `code/backend/` | Node.js 22 + Express 5, monolito modular (ADR 0002). Módulos en `src/modules/`: `tutor` (RAG), `notas`, `identidad`, `cursos`, `evaluaciones`. Plataforma en `src/platform/`: db, auth JWT, errores, contraseñas |
| Base de datos | `code/backend/db/` | PostgreSQL 16 + pgvector + citext. Se aplican en orden `01` a `06`, luego `permisos_app.sql` y el seed `90_seed_demo.sql`. Todas las consultas están en `queries.js` |
| Frontend | `code/frontend/` | React 19 + Vite (ADR 0005). `index.html` = chat del tutor; `portal.html` = portal por rol (`src/portal/`, router por hash `#/portal/<id>`) |
| Contrato | `FeathersForAll/api/` | OpenAPI 3.1 con ejemplos ejecutables contra Prism |
| Infra | `k8s/`, `terraform/` | Laboratorio S07: kind + Kustomize + Terraform (ADR 0006) |
| CI/CD | `.github/workflows/`, repo `Erolayer-Cl/feathersforall-gitops` | S08 (ADR 0009): gates bloqueantes en cada PR, imágenes a GHCR por sha y GitOps con Argo CD. Guía: `Documentos/infra/ci-cd.md`. S09 (ADR 0010): `security.yml` con SAST, SCA, SBOM y secretos. S10 (ADR 0011): IaC scan, firma cosign + attestations y DAST en `ci.yml` |
| Supply chain | `.checkov.yaml`, `dast/`, `k8s/policies/`, `k8s/networkpolicy.yaml`, `falco/` | S10 (ADR 0011): excepciones de Checkov, staging efímero y reglas de ZAP, policy Kyverno de firma, NetworkPolicy y reglas Falco con su ruta de alerta |
| Seguridad | `.semgrep/`, `.gitleaks.toml`, `.vex/`, `FeathersForAll/Documentos/seguridad/` | Reglas Semgrep propias (con pruebas), excepciones de gitleaks y VEX, threat model STRIDE del tutor, triage y registro de vulnerabilidades |
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
- **S08 (CI/CD y GitOps):** preparada el 26-10-2026 en la rama `Ignacio` y mergeada en `main` (PR #13).
- **S09 (DevSecOps I):** preparada el 06-11-2026 en la rama `feat/s09-devsecops` (detalle abajo). Su PPT ya está en `models.md`.
- **S10 (DevSecOps II):** preparada el 11-11-2026 sobre la rama de la S09 (detalle abajo). Su PPT ya está en `models.md`.
- **RAG v1.0 (PR #16, rama `rag-V1.0`):** revisado y corregido el 14-11-2026 (detalle abajo). Falta la decisión del equipo sobre el Mineduc antes de mergear.
- **Nociones básicas del tutor (contrato v1.6):** el tutor responde sin apuntes los cálculos (`1+1`, `3/4 + 1/2`, con calculadora exacta) y los conceptos elementales del glosario (`rag/basics-glossary.json`), con el nuevo turno `X-Tutor-Turn: basic`. Los apuntes del docente siguen mandando y lo que no es básico sigue sin inventarse (detalle en `code/backend/README.md`). Falta probarlo con el LLM real (`qwen2.5:3b`) y que el equipo revise el glosario.
- **Ciclo mínimo H1, H2, H4:** hecho el 14-11-2026 sobre la misma rama (detalle abajo): el docente crea curso, matricula y crea y publica evaluaciones; el estudiante las rinde y ve su nota.

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
  - 10-11-2026 (rama `feat/portal-mejoras`): caché en memoria de las respuestas GET (`api/cache.js`; al navegar ya no aparece «Cargando…»), la sesión se sincroniza entre pestañas y se vacía la caché al iniciar o cerrar sesión, y el streaming del tutor corta la descarga al salir y convierte las caídas de red en `ApiError` 0. 20-11-2026: mezclado con `main` (login por rol y ciclo H1/H2/H4); la caché también se vacía al entregar una evaluación. Frontend: 134 pruebas, backend 350 sin base; verificado con Brave headless antes de la mezcla.
- **Auditoría de rendimiento y base de datos** (23-10-2026): informe en `FeathersForAll/Documentos/auditoria/rendimiento-y-base-de-datos.md`. La base no es el cuello de botella (endpoints < 12 ms con 6 000 estudiantes y 96 000 fragmentos; búsqueda de apuntes ~5 ms, recall 100 %); el tiempo del tutor lo domina el LLM en CPU. Aplicado: log `tutor` con tiempos por fase, `LLM_KEEP_ALIVE=30m` (primera pregunta tras una pausa: 18,8 s → 8,4 s) y `shm_size` en el compose. Propuestas P1–P8 pendientes de decidir en equipo.
- **Currículum Mineduc en el RAG:** pendiente. Está en los requisitos (`readme.md`), pero hoy el RAG solo usa los apuntes del docente. Ignacio buscará una fuente confiable; no cargar contenido del Mineduc hasta entonces. Diseño conversado: un corpus compartido de solo lectura por asignatura y nivel, sin `colegio_id`.
- **Demo pública gratuita:** investigada (informe PDF enviado el 16-10-2026): Vercel Hobby + Render Free + Neon Free + Cloudflare Workers AI (bge-m3). El frontend ya está en Vercel (proyecto `feathers-for-all`, raíz `code/frontend`, despliega `main`). Desde el 20-11-2026, `code/frontend/vercel.json` redirige `/` al portal y repite las cabeceras de seguridad de NGINX. Falta: desplegar la API y agregar el rewrite `/v1` → backend (está en `code/frontend/README.md`; hasta entonces el login da 404), adaptadores LLM/embeddings compatibles con OpenAI, `render.yaml` y banner de datos sintéticos. Ya corregido: `ALTER ROLE` sin `NOSUPERUSER` (fallaba en Postgres gestionados).
- **S08 — CI/CD y GitOps** (26-10-2026, ADR 0009, guía `FeathersForAll/Documentos/infra/ci-cd.md`):
  - `ci.yml`: contrato, lint, cobertura ≥ 70 % (en rojo bajo 70 %; backend 98,9 %, frontend 91 % sobre `src/**/*.js`), SCA, Semgrep, Newman con Compose (sin tutor) y Trivy; en `main`, push a GHCR y PR al repo gitops. `promote-prod.yml` con Environment `production`.
  - Repo gitops armado en `../feathersforall-gitops` (`git init`, sin commit).
  - Los gates encontraron 3 vulnerabilidades, ya corregidas y registradas con CVE, CWE y CVSS en `FeathersForAll/Documentos/seguridad/vulnerabilidades.md`: body-parser 2.4.0, API en `distroless/nodejs22-debian13` y web en `nginx-unprivileged:1.30-alpine` + `apk upgrade`.
  - **Falta (equipo):** crear el repo en GitHub y hacer push, `GITOPS_TOKEN`, Environment `production`, protección de rama con 2 revisores, paquetes GHCR públicos, Argo CD v3.5.6 en kind con screenshot Synced/Healthy y la primera run verde en `main`.
  - Gates para después: cobertura de `.jsx`/hooks (Testing Library), cosign + SBOM como attestation, ZAP baseline, IaC scanning y Dependabot (S10).

- **S09 — DevSecOps I: shift-left** (06-11-2026, ADR 0010):
  - `.github/workflows/security.yml`: `security-sast` (Semgrep OWASP Top 10 + `.semgrep/`), `security-sca` (Trivy fs + VEX), `security-sbom` (CycloneDX + SPDX) y `security-secrets` (gitleaks con todo el historial). Corre en PR, en `main` y cada lunes. `ci.yml` usa las mismas reglas Semgrep y publica el SBOM de cada imagen.
  - 4 reglas Semgrep propias con pruebas: JWT hardcodeado, SQL interpolado, logs con datos del estudiante, colegio/rol desde el cliente.
  - Threat model STRIDE del tutor: `FeathersForAll/Documentos/seguridad/threat-model.md`. Triage, SLA y VEX: `triage-y-excepciones.md`.
  - **No verificado en local** (no se pudieron descargar los escáneres); la primera run en GitHub es la verificación.
  - **Falta (equipo):** PR contra `main`, revisar la primera run, screenshot de los checks, agregar `security-*` a la protección de rama y leer el post-mortem (SolarWinds o XZ Utils).

- **S10 — DevSecOps II: supply chain** (11-11-2026, ADR 0011):
  - `ci.yml`: job `iac-scan` (Checkov sobre Terraform y la salida de kustomize + validación de las reglas Falco), firma keyless con cosign, attestations SLSA provenance y SBOM, `cosign verify`, y job `dast` (ZAP baseline contra `dast/compose.staging.yaml`). `promote` ahora depende de `dast`.
  - `k8s/policies/require-signature.yaml` (Kyverno `ImageValidatingPolicy`), `k8s/networkpolicy.yaml` y `falco/rules-custom.yaml` con 3 reglas y ruta de alerta (`falco/README.md`).
  - Frontend: CSP y demás cabeceras en `code/frontend/security-headers.conf`; se quitó el `<style>` en línea de `portal.html`. Cierra S-4 del threat model.
  - **Verificado en local:** Checkov (Terraform y manifiestos, 0 fallas con 2 excepciones), actionlint, sintaxis del compose de staging y carga del chat y del login del portal en Chrome headless con la CSP (sin violaciones).
  - **No verificado en local** (sin acceso a registros de imágenes ni clúster): la firma y las attestations, ZAP, la policy de Kyverno, la NetworkPolicy y las reglas Falco. La primera run en `main` y una pasada en kind son la verificación.
  - **Falta (equipo):** mergear primero la S09; primera run en `main` y copiar la salida de `cosign verify` al PR; instalar Kyverno y Falco en kind y probar que la policy rechaza una imagen sin firma y que disparan las 3 reglas; copiar `networkpolicy.yaml` a `base/` del repo gitops; agregar `iac-scan` y `dast` a la protección de rama; definir el canal de alertas de Falco.

- **RAG v1.0 — PR #16** (Cristofer, revisado el 14-11-2026):
  - Trae búsqueda híbrida (pgvector + texto en español, mezcladas con RRF), apuntes en PDF (`unpdf`), Bases Curriculares del Mineduc por asignatura y nivel (`npm run ingest:mineduc`) y la pantalla Docente · Curso para subir apuntes.
  - Arreglos de la revisión:
    - Apuntes en el contrato **v1.3.0**: `GET /v1/courses/{id}/documents`, `PUT` y `DELETE .../documents/{nombre}` (`src/modules/tutor/apuntes.routes.js`). `PUT` porque reemplaza por nombre (sin `Idempotency-Key`). 404 si no participas, 403 al estudiante. Se quitó la ruta de desarrollo `/v1/dev/courses/{id}/files`.
    - El nombre `MINEDUC…` queda reservado para las Bases, y los nombres de archivo llegan saneados al prompt dentro de `<temas>` (T-4).
    - Ingress aparte `feathersforall-cursos` para `/v1/courses` (40 MB y 600 s); el resto de `/v1` sigue en 2 MB.
    - Vuelve `body { margin: 0 }` a `base.css` (lo había borrado el PR; es de la S10).
    - El apunte de aritmética pasó a `samples/operaciones-basicas.md`; se borró `scripts/ingest-aritmetica.js` (usaba el superusuario e IDs fijos).
    - Fuera: código muerto (`withMathExpression`) y "gay" de la lista de insultos de la charla.
  - Segunda revisión (agente revisor, 14-11-2026), corregida con pruebas de regresión:
    - PDF de ejercicios (antes una guía de multiplicación quedaba vacía): se quitan las líneas idénticas que se repiten en muchas páginas (encabezados de varias líneas) y, en las 2 primeras y últimas líneas, las que llevan un número que avanza con la página ("Página 3 de 10", "Bases… 45"). Un número que no avanza ("Respuesta: 18") es contenido y se queda. `4 x 8 = 32` ya no pasa por título numerado (la regex tenía la bandera `i`).
    - Búsqueda por texto: `toTsQuery` descarta las palabras de pedir ayuda ("dame", "ejemplo", "dice"…) pero no las de tema ("materia", "clase"), y arma frases término curricular + número (`oa <-> 3`, `decreto <-> 97`, `unidad <-> 2`; lista `PHRASE_TERMS`), nunca un número suelto. "OA 3" y "OA 3-4" ya no se toman como cálculo.
    - Dos `PUT` del mismo nombre a la vez ya no duplican el apunte (`pg_advisory_xact_lock` en `replaceDocument`); el 200/201 sale de la misma transacción.
    - `.txt`/`.md` en UTF-16 o Windows-1252 se leen bien (antes, 500 o texto dañado); sin NUL ni BOM.
    - URL mal codificada → 400 (antes 500, en todas las rutas); multipart/urlencoded → 415; `DELETE` recorta espacios igual que `PUT`.
    - "¿Qué temas hay?" ya no captura preguntas de materia ("¿Qué lecciones nos dejó la Guerra del Pacífico?").
    - `tutor_documents` y `tutor_available` no cuentan las Bases del Mineduc (en `/v1/courses` y en `/v1/me/grades`).
    - Niveles en romanos ("IV Medio", "IVº Medio") y asignaturas "Ciencias para la Ciudadanía" / "Artes Musicales" bien clasificadas.
    - Portal docente: no se sube en paralelo al soltar archivos mientras otro se procesa.
    - El agente revisor verificó las correcciones; lo que quedó a medias y sus 5 regresiones nuevas también se corrigieron.
  - **Verificado en local:** lint; backend 259 pruebas sin base y 388 con PostgreSQL (cobertura 98,45 %); frontend 101; Spectral sin errores ni advertencias; cliente TS regenerado; 8 ejemplos Prism; Newman como en CI (50 requests, 88 aserciones, con la carpeta nueva 9); Checkov sobre kustomize (269 OK, 0 fallas); Semgrep con `.semgrep/`; recorrido en Chrome headless del build con la CSP de NGINX (subir `.md` y PDF, rechazar `.docx`, quitar, 360 px, estudiante 403, sin violaciones de CSP). Embeddings con un Ollama falso: la calidad de las respuestas con `bge-m3` no se volvió a medir.
  - **Falta (equipo):**
    - Decidir el diseño del Mineduc con un ADR. Hoy el PR copia las Bases en cada curso, dentro de `apuntes_curso` (el docente puede borrarlas); lo conversado era un corpus compartido de solo lectura, sin `colegio_id`. Además, validar la fuente (Ignacio) antes de cargar los PDF.
    - Copiar el Ingress nuevo a `base/` del repo gitops.
- **Login por rol** (14-11-2026, sobre la misma rama):
  - Selector **Estudiante / Docente** arriba del formulario (`pages/login/LoginPage.jsx`, `LOGIN_TABS` en `textos.js`); la administración entra por un enlace aparte. Las tres rutas de acceso usan el mismo componente (`LoginRoute`): al cambiar de pestaña no se pierde lo escrito.
  - Si la cuenta es de otro rol, la sesión **no** se guarda (`signInWith` / `acceptLogin` / `RoleMismatchError` en `session/session.js`, probado de punta a punta con login y almacenamiento falsos): el login avisa, pasa el foco a «Cambiar a …» y conserva la contraseña. Mientras se envía, ningún enlace de la pantalla navega; al navegar, el aviso anterior se borra. Las credenciales malas siguen dando el mismo 401 genérico (no se revela el rol).
  - Ayuda del RBD según el rol. Sin cambios en la API ni en el contrato.
  - **Verificado en local:** frontend 101 pruebas y lint; recorrido en Chrome headless del build con la CSP y la API real (27 comprobaciones, foco incluido: los tres roles, cruce de rol, clave mala, teclado, 360 px y tema oscuro, sin violaciones de CSP); contraste AA de los elementos nuevos en ambos temas (mínimo 5,5:1).

- **Ciclo mínimo H1, H2, H4** (14-11-2026, contrato v1.4.0):
  - **Decisiones:** empezar por el ciclo mínimo; `tutor-questions` queda **deprecado** en el contrato (nunca se implementó; lo reemplazan las conversaciones); se quita «Colegios» del menú del administrador (es del rol master, que no tiene login).
  - **API:** `POST /v1/courses`, `POST` y `GET /v1/courses/{id}/enrollments`, `POST` y `GET /v1/courses/{id}/assessments`, `GET` y `PATCH /v1/assessments/{id}` (publicar y cerrar) y `POST /v1/assessments/{id}/submissions`. Código en `src/modules/cursos/` y `src/modules/evaluaciones/`. Las rutas de notas del docente (libro, resumen, notas de un estudiante, exigencia) ya existían y ahora están en el contrato.
  - **Idempotency-Key** (`src/platform/idempotency.js`): candado, búsqueda, operación y guardado en UNA transacción; dos envíos simultáneos con la misma clave crean un solo recurso, y la misma clave en otra operación u otro usuario da 422. Los errores de PostgreSQL esperables (RLS 42501, único 23505, FK/formato) se traducen a 403/409/422 en `problem.js`.
  - **Migración `06_alternativas_orden.sql`:** las alternativas no tenían orden, así que `correct_option` y `selected_option` (índices) no eran estables. Columna `orden` (sin UNIQUE, para no romper los SQL de prueba); quien lee ordena por `(orden, id)`. Hay que aplicarla en las bases existentes (`npm run db:setup` lo hace).
  - **Reglas:** el estudiante nunca recibe la alternativa correcta ni la retroalimentación antes de entregar; un borrador no existe para él (404); un solo intento (409 con su resultado anterior); no se publica sin alternativa correcta en todas las preguntas (422 con cuáles); otro docente o admin sin permiso 403, estudiante sin matrícula 404.
  - **Portal:** docente — Nuevo curso, matricular por correo, lista de estudiantes, Nueva evaluación (preguntas y alternativas con la correcta marcada), publicar y cerrar, resultados con acierto por pregunta y menú Evaluaciones; estudiante — «Por rendir» en el curso, rendir con confirmación y resultado con nota y retroalimentación al instante. El formulario reutiliza la `Idempotency-Key` si la red falla.
  - **Verificado en local:** lint; backend 322 pruebas sin base y 480 con PostgreSQL (cobertura 98,57 %; incluye `test/ciclo.pg.test.js`); frontend 116 pruebas; Spectral sin errores ni advertencias; cliente TS regenerado; 11 ejemplos Prism; Newman (66 requests, 120 aserciones, con la carpeta 10 del ciclo); recorrido en Chrome headless del build con la CSP y la API real (docente, estudiante y administrador, 360 px, sin violaciones de CSP).
  - **Falta:** gestión de usuarios del administrador; pantalla «Progreso», aún marcador (las del docente se hicieron en la H3); rate limit en el resto de los POST (el contrato declara 429).

- **Evaluaciones con IA y edición de borradores** (14-11-2026, contrato v1.5.0):
  - Tres formas de crear: a mano, con IA, o con IA y el docente la edita. `POST /v1/courses/{id}/assessments/generate` (`src/modules/evaluaciones/generar-ia.js`) **solo propone**: no guarda nada; el docente revisa, edita y guarda con el POST normal. Usa el tema y, por defecto, los apuntes del curso (RAG del colegio y curso del token; sin apuntes sobre el tema, 422).
  - La salida del modelo es un dato no confiable: se extrae el JSON, se valida pregunta por pregunta y se descarta lo inválido (nunca se "arregla"); los apuntes van dentro de `<apuntes>` como material, no como instrucciones; sin respuesta utilizable, 502. Tope por usuario (10 generaciones cada 10 min, 429 con `Retry-After`; en memoria, por pod). No se registra el tema ni el contenido.
  - Editar y borrar solo borradores: `PUT` y `DELETE /v1/assessments/{id}` (409 si ya está publicada: tiene entregas y notas). Fecha de cierre (`closes_at`) en el formulario.
  - Portal: `EditorEvaluacion` compartido por «Nueva evaluación» y «Editar borrador» (`doc-evaluacion-editar/<id>`), con el panel «Generar con IA» solo al crear (en edición reemplazaría lo guardado) y aviso de que la IA puede equivocarse.
  - **Verificado en local:** backend 335 sin base y 506 con PostgreSQL (cobertura 98,67 %); frontend 123; Spectral sin errores; recorrido en Chrome headless con la CSP, la API real y un Ollama falso (tema sin apuntes, generar, editar lo generado, guardar, editar, publicar, eliminar, 360 px). **No verificado:** la calidad de las preguntas con `qwen2.5:3b` real (solo se probó el parser con respuestas simuladas); conviene que un docente las revise.

- **Auditoría de secretos y logs** (14-11-2026): sin llaves ni contraseñas reales en los archivos ni en el historial (patrones conocidos, `.env`, `tfstate`, llaves). Hallazgos corregidos:
  - `k8s/configmap.yaml` ya no deja el chat sin token ni las rutas `/v1/dev/*` abiertas (`ENABLE_DEV_ROUTES`/`CHAT_REQUIRE_AUTH`): el frontend ya tiene login. Hay que replicarlo en `base/` del repo gitops.
  - Logs de la API (`src/platform/logger.js`): `redact` de password, token, authorization, cookie y secretos; los errores de PostgreSQL se serializan sin `detail`/`where`/`parameters` (traen valores de filas, p. ej. correos). El log de cada request registra el patrón de la ruta (`/v1/courses/:courseId`), no la ruta real (ids y nombres de archivos de apuntes).
  - CI: el reporte de ZAP se sanea (token y `Bearer …`) antes de subirse como artefacto y al `GITHUB_STEP_SUMMARY`; si queda un JWT, el job falla y no se publica.
  - gitleaks: excepción acotada para el UUID de `Idempotency-Key` de `portalApi.test.js`.
  - Sigue siendo válido: las claves de laboratorio (`postgres:postgres`, `cambiar`, `demo1234`) son sintéticas y no deben llegar a producción.

## Plan de acción (por rol y arquitectura)

> Plan de arquitectura del 14-11-2026. Se actualiza al cerrar cada fase. ✅ hecho · 🔜 siguiente · ⬜ pendiente.

### Qué puede hacer cada rol hoy

| Rol | Ya puede | Le falta |
|---|---|---|
| **Docente** | Crear cursos, matricular por correo, ver estudiantes; crear evaluaciones (a mano, con IA o con IA y editar), editar y borrar borradores, publicar y cerrar; ver resultados; subir apuntes al tutor; libro de notas con estudiantes en riesgo, notas de cada estudiante, exigencia y ponderación, «Mis estudiantes» y «Reportes» | Exportar el libro (CSV/PDF), umbral de riesgo configurable en pantalla |
| **Estudiante** | Ver cursos y notas, rendir evaluaciones con nota y retroalimentación al instante, usar el tutor IA con historial | «Progreso», contenido del curso (`est-contenido`), columnas Examen/Final de «Mis notas» (no existen en la base) |
| **Administrador** | Entrar y leer cursos y notas de su colegio por la API | Todo en el portal: gestión de usuarios (crear, desactivar, restablecer clave), vista de cursos, evaluaciones y reportes del colegio |

### Fases

1. ✅ **Cerrar lo abierto.** PR #16 revisado y mergeado (PR #17), login por rol, auditoría de secretos y logs.
2. ✅ **Ciclo mínimo H1, H2, H4** (contrato v1.4.0) y **evaluaciones con IA y edición de borradores** (v1.5.0).
3. ✅ **Docente ve sus resultados (H3)** (20-11-2026, rama `feat/docente-resultados`, solo frontend, sin cambios de contrato):
   - `doc-libro/<curso>` (botón «Libro de notas» en el curso): KPIs, tabla estudiantes × evaluaciones con promedio ponderado, estudiantes en riesgo (`grades/summary`), resumen por evaluación y exigencia/ponderación editables (`PATCH .../grading`, confirma antes de recalcular).
   - `doc-estudiante/<curso>/<estudiante>`: notas de un estudiante. `doc-estudiantes`: estudiantes de todos los cursos con buscador. `doc-reportes`: promedio, en riesgo y entregas pendientes por curso.
   - `gradebook` y `grades/summary` entregan el estado en español (`publicada`, así dice su contrato) y `/assessments` en inglés: el portal los normaliza en `utils/evaluaciones.js` (`normalizarEstado`). Unificarlo es un cambio de contrato para v2.
   - Observación: un docente del mismo colegio que no dicta el curso recibe 403 (no 404) en estas rutas; el backend no cambió.
   - **Verificado en local:** frontend 148 pruebas, lint y build; recorrido en Brave headless con la API real y una base desechable (docente, escritorio, 360 px y tema oscuro, sin errores de consola): cambiar la exigencia de 60 a 50 % sube la nota de Sofía de 2,3 a 2,5; permisos 403 (otro docente, estudiante) y 404 (otro colegio). No verificado: la CSP (el recorrido fue con Vite, sin NGINX).
4. ⬜ **Administrador.** Gestión de usuarios (crear, desactivar, restablecer clave: hoy no hay cambio ni restablecimiento de contraseña), vista de cursos y evaluaciones del colegio. Pide contrato nuevo (`/users`) y probablemente un ADR (ciclo de vida de la cuenta).
5. ⬜ **Estudiante: Progreso** (evolución de notas por ramo) y contenido del curso.
6. ⬜ **Transversal.** Ver «Arquitectura: lo que falta» abajo.

### Arquitectura: lo que falta

| Tema | Estado | Qué hacer |
|---|---|---|
| Límite de solicitudes | Solo login e IA (en memoria, por pod) | Límite por usuario en el tutor y en los POST (el contrato declara 429); en producción, Redis o el Ingress |
| Outbox y cola SQS | Decididos en ADR 0002 y 0004; existe la tabla `outbox_eventos`, no hay worker | Definir si se implementa o se corrige el ADR: hoy ningún flujo lo necesita |
| Ciclo de vida de la cuenta | Sin cambio ni restablecimiento de clave ni cierre de sesión en el servidor (el JWT dura 8 h) | ADR + rutas; revocación de tokens |
| Auditoría | Sin registro de quién subió apuntes, publicó o cambió una exigencia (R-1 del threat model) | Tabla de auditoría escrita por la API |
| Métricas | El NFR promete 99,5 % y p95 < 500 ms, pero no se mide | Endpoint de métricas y paneles |
| Migraciones | El esquema son archivos SQL aplicados en orden (`01`–`06`) | Herramienta de migraciones antes de tener datos reales |
| Tope del tutor por pod | El límite de preguntas vive en memoria de cada pod: con N réplicas el tope real es N veces mayor | Contador compartido (Redis o la base) si se escala |
| Revisión de apuntes | El escáner de órdenes a la IA es heurístico y solo mira apuntes nuevos; los ya subidos no se revisan | Revisar los existentes; sumar un clasificador si hace falta |
| Documentos | `atributos-calidad.md` aún dice «HTML/JS» como frontend | Actualizar |

### Decisiones que son del equipo (no se pueden cerrar desde código)

- **Mineduc en el RAG:** ADR con el diseño (corpus compartido de solo lectura, sin `colegio_id`, o copia por curso como hoy) y que Ignacio valide la fuente antes de cargar ningún PDF.
- **Repo gitops:** replicar en `base/` el ConfigMap sin `ENABLE_DEV_ROUTES`/`CHAT_REQUIRE_AUTH`, el Ingress `feathersforall-cursos` y `networkpolicy.yaml`; aplicar la migración `06` en bases existentes.
- **Calidad de las preguntas con IA:** que un docente revise las generadas con el modelo real (`qwen2.5:3b`).
- **Propuestas de la auditoría de rendimiento (P1–P8)** de la sección siguiente.

## Pendientes y deuda conocida

- En `main` hay cambios sin commitear de antes de la etapa 1:
  - el Dockerfile ahora copia `db/queries.js`;
  - arreglos del chat y del almacén JSON;
  - el rebrand a FeathersForAll.
- **Contrato sin implementar:** solo el tutor asíncrono (`tutor-questions`), deprecado desde la v1.4. El Tutor IA del portal usa las rutas del contrato v1.2 (`tutor-conversations`); `POST /v1/dev/chat` queda para desarrollo y docentes.
- **CORS:** el backend no tiene. Hoy no hace falta (Vite y NGINX sirven todo desde un solo origen), pero la demo pública (Vercel + Render) sí lo necesita, exponiendo `X-Tutor-Turn`, `X-Rag-Sources` y `X-Conversation-Mode` con `Access-Control-Expose-Headers`.
- **Propuestas de la auditoría sin decidir** (detalle en el informe): LLM con GPU o proveedor externo, reordenar el prompt del tutor (~2 s menos), quitar el índice HNSW que no se usa (750 MB), RLS del docente sin consulta por fila y `UV_THREADPOOL_SIZE` (login ~25/s por proceso).
- **Imagen de la API: 211 MB**, sobre la meta de < 200 MB del ADR 0006 (la base distroless debian13 ya pesa 203 MB).
- **`k8s/` duplicado con `base/` del repo gitops:** desde S08 manda el repo gitops; si se cambia un manifiesto, hay que cambiarlo en ambos lados (o borrar `k8s/` cuando el equipo lo decida).
- **Puerto 5432:** si hay un PostgreSQL nativo instalado, el contenedor no arranca (ver README del backend).
- **Del threat model del tutor (S09):** el tope por usuario en el tutor (D-1) y la revisión de apuntes al subirlos (T-4) se hicieron en v1.7 (ver «Cambios v1.7»); sigue sin audit log de apuntes (R-1). La CSP (S-4) se cerró en la S10.
- **Del DAST (S10):** las respuestas JSON de la API no envían `X-Content-Type-Options` ni `Cache-Control: no-store` (hoy WARN en `dast/zap-rules.tsv`; cambia el contrato). Las fuentes vienen de Google Fonts: sin SRI y cada visita le entrega la IP del estudiante a Google; conviene servirlas desde el propio sitio. Falta un escaneo de la API con el contrato (`zap-api-scan`).
- **Del RAG v1.0:** el PDF y el troceado ya corren en worker threads (v1.7); el índice GIN de la búsqueda por texto ya existía (`07_rag_indices.sql`); las pantallas docentes (`.jsx`) no tienen pruebas propias.
- **Supply chain (S10):** SLSA Build L2; para L3 falta generar la provenance fuera del job (`actions/attest-build-provenance` o `slsa-github-generator`). Sin respaldo de firmas y attestations fuera de GHCR. Con la policy de Kyverno, `publicar-imagenes.ps1` ya no sirve para desplegar.
- **Limitador del login:** guarda los intentos en memoria, así que cada pod cuenta los suyos. En producción iría en Redis o en el Ingress.
- **Funciones `SECURITY DEFINER`** (`colegio_por_rbd`, `credenciales_login`): en producción su dueño debe ser `feathersforall_plataforma`. Hoy, en local, es el superusuario.

## Cambios v1.7 (tope del tutor, glosario por asignatura, apuntes seguros, PDFs en worker, examen de la IA)

- **Tope de preguntas (D-1):** `platform/rate-limiter.js` + `modules/tutor/tutor-limit.js`. Por estudiante (o IP si no hay token): 10/min, 100/h y 2 en curso. `429` RFC 7807 con `Retry-After`. Variables: `TUTOR_RATE_PER_MIN`, `TUTOR_RATE_PER_HOUR`, `TUTOR_MAX_CONCURRENT` (0 apaga ese tope). En memoria por pod.
- **Glosario por asignatura:** `rag/basics.js` filtra por la asignatura del curso (`courseSubjectKey`); la calculadora no depende de la asignatura. Sin asignatura reconocible no se filtra.
- **Apuntes tramposos (T-4):** `rag/injection-scan.js` revisa el texto al subir (`422 suspicious-document`, indica línea/página, no repite la frase ni la guarda en logs). Es heurístico.
- **PDFs sin frenar a los demás:** `rag/offload.js` (workers con límite de memoria, tiempo y cola; cola llena → `503 busy`). Variables: `PDF_WORKERS`, `PDF_QUEUE`, `PDF_TIMEOUT_MS`, `PDF_WORKER_MEMORY_MB`. El tiempo de proceso no cambia; lo que baja es el bloqueo del hilo principal (medido: 1164→4 ms con 300 páginas).
- **Examen del tutor:** `code/backend/eval/` (50 preguntas, `npm run eval`; `npm run eval:live` con Ollama). El modo determinista corre en `npm test`. Ver `eval/README.md`.
