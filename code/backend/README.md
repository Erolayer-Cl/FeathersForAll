# FeathersForAll — backend

La interfaz está en [`../frontend`](../frontend/).

Monolito modular Node.js + Express (ADR 0002). Módulos:

- `tutor`: tutor de IA con LLM local (Ollama) y **RAG**: responde con los apuntes que subió el docente, conversa si el estudiante solo saluda, y si la respuesta no está en los apuntes dice "No encuentro eso" en vez de inventar.
- `notas`: notas en escala chilena 1.0–7.0 sobre PostgreSQL (opcional: sin `DATABASE_URL` el servidor arranca solo con el chat).
- `identidad`: login propio por RBD + correo + contraseña (scrypt, JWT HS256) y perfil (`/v1/me`). Ver [ADR 0007](../../FeathersForAll/Documentos/adr/0007-autenticacion-y-privacidad.md).
- `cursos`: cursos visibles por rol (las asignaturas del estudiante, las clases del docente).

## Requisitos

- Node.js ≥ 22
- Ollama, levantado **a mano** (no como servicio de arranque):

```bash
sudo pacman -S ollama        # no hace falta systemctl enable
ollama serve                 # terminal aparte; Ctrl+C para apagarlo
ollama pull qwen2.5:3b       # solo la primera vez
ollama pull bge-m3           # embeddings del RAG (1024 dimensiones = vector(1024) de la base)
```

- Para las notas: PostgreSQL 16+ con las extensiones `citext` y `pgvector` (`sudo pacman -S postgresql pgvector`).

## Uso

```bash
cd code/backend
cp .env.example .env
npm install
npm run dev                  # http://localhost:3000
npm test                     # no necesita Ollama (LLM simulado) ni PostgreSQL
```

### Base de datos local con Docker (recomendado)

```bash
docker compose up -d        # PostgreSQL 16 + pgvector con esquema 01–05, usuario de la API y datos demo
docker compose ps           # "healthy" = lista
docker compose down -v      # borrar todo y empezar de cero
```

Las claves del compose (`postgres`/`postgres` y `feathersforall_app`/`cambiar`) son solo de desarrollo y ya coinciden con `.env.example`. Falta completar `JWT_SECRET` en `.env`.

El contenedor se levanta solo al encender el equipo (`restart: unless-stopped`) y los datos viven en el volumen `feathersforall_pgdata`, así que después del primer `up` basta con `npm run dev`.

**Si `docker compose up` falla con "address already in use" en el 5432:** otro PostgreSQL ocupa el puerto (por ejemplo, uno instalado en el sistema). Revisa con `ss -ltnp | grep 5432` y elige una opción:

- detener el otro (`sudo systemctl disable --now postgresql`) y luego `docker compose up -d --force-recreate` (el `--force-recreate` hace falta si el contenedor ya intentó arrancar: si no, puede quedar sin el puerto publicado);
- o usar otro puerto: `DB_PORT=5433 docker compose up -d` y cambiar `5432` por `5433` en las URLs de `.env`.

Comprueba con `docker port feathersforall-db-1`: debe mostrar `5432/tcp -> 127.0.0.1:5432`.

### Credenciales demo (datos sintéticos)

Contraseña de todos: **`demo1234`**. Login: `POST /v1/auth/login` con `{ "rbd", "email", "password" }`.

| Colegio | RBD | Correo | Rol |
|---|---|---|---|
| Colegio Demo A | `99901` | camila@demo-a.cl · benjamin@demo-a.cl · sofia@demo-a.cl · tomas@demo-a.cl | estudiante |
| Colegio Demo A | `99901` | ana.rojas@demo-a.cl (Matemáticas) · luis.perez@demo-a.cl (Historia) | docente |
| Colegio Demo A | `99901` | marta.soto@demo-a.cl | admin_colegio |
| Colegio Demo B | `99902` | javiera@demo-b.cl | estudiante |
| Colegio Demo B | `99902` | pedro.lagos@demo-b.cl | docente |

```bash
curl -s localhost:3000/v1/auth/login -H 'content-type: application/json' \
     -d '{"rbd":"99901","email":"camila@demo-a.cl","password":"demo1234"}'
```

### Base de datos local sin Docker

```bash
createdb feathersforall
cd db
# Esquema (01 a 05) + usuario de la API feathersforall_app y sus permisos + datos demo, en un paso:
psql -d feathersforall -v app_password='cambiar' -v demo=1 -f crear_bdd.sql
```

Sin `psql` en el PATH (Windows): completa `DATABASE_ADMIN_URL` y `DATABASE_URL` en `.env` y ejecuta `npm run db:setup -- --demo` (hace lo mismo).

`crear_bdd.sql` crea el usuario `feathersforall_app` sin superusuario ni BYPASSRLS (si no, el RLS no aplica). Sin `-v demo=1` crea la base vacía.

En `.env`, completa `DATABASE_URL` y `JWT_SECRET` (ver `.env.example`). Para probar con los datos demo:

```bash
TOKEN=$(npm run -s dev:token -- docente)     # o: estudiante | admin  (--http: todos, para notas.http)
curl -H "Authorization: Bearer $TOKEN" \
     localhost:3000/v1/courses/c0000000-0000-0000-0000-000000000001/grades/summary
```

### Probar en Postman

Importa `requests/postman/FeathersForAll.postman_collection.json` y el environment `FeathersForAll.local.postman_environment.json`, elige el environment y ejecuta la carpeta **1 · Login** (guarda los tokens). Después corre cualquier carpeta o todo con el Runner: cada request tiene tests y la matriz de permisos queda en verde ([permisos.md](../../FeathersForAll/Documentos/api/permisos.md)). Desde la terminal:

```bash
npm run test:postman        # Newman; la carpeta 6 (tutor) necesita ollama serve y apuntes cargados
```

### Probar desde VS Code

El repo recomienda dos extensiones (`.vscode/extensions.json`; VS Code ofrece instalarlas al abrir la carpeta):

- **REST Client** (`humao.rest-client`): abre [`requests/notas.http`](requests/notas.http), pega la salida de `npm run dev:token -- --http` donde dice `PEGAR` y haz clic en *Send Request*. Trae todas las rutas de notas con cada rol, y también los casos que deben fallar (401, 403, 404, 400).
- **PostgreSQL** (`ms-ossdata.vscode-pgsql`, de Microsoft): conéctate a `localhost:5432`, base `feathersforall`, usuario `feathersforall_app`, y abre [`db/consultas_demo.sql`](db/consultas_demo.sql). Ejecuta primero el bloque 0 (fija el colegio para el RLS) y luego cualquier consulta: libro de notas, promedios, estudiantes en riesgo, tasa de acierto, tabla puntaje → nota y la prueba de aislamiento entre colegios.

Pruebas de integración contra PostgreSQL real (crean y borran una base temporal):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

## Tutor con RAG

```text
 apunte.md ──chunker──▶ fragmentos ──bge-m3──▶ vector(1024) ──▶ apuntes_curso / apuntes_embeddings (pgvector, RLS)

 mensaje del estudiante
   ├─ charla ("hola", "gracias", "¿quién eres?", "estoy nervioso por la prueba")
   │     → el LLM conversa en 1–3 frases, SIN contenidos de materia            X-Tutor-Turn: chat
   ├─ el curso no tiene apuntes → aviso fijo, sin LLM                          X-Tutor-Turn: no-notes
   └─ pregunta de materia → bge-m3 → top-K fragmentos del curso (HNSW, coseno)
         ├─ ninguno ≥ RAG_MIN_SCORE → "No encuentro eso en los apuntes…", sin LLM   X-Tutor-Turn: no-info
         └─ sí → prompt + fragmentos numerados → qwen2.5:3b → respuesta con citas [1]   X-Tutor-Turn: grounded
```

- **Coincide con el curso:** solo se buscan fragmentos de ese curso; el LLM recibe la orden de usar solo esos apuntes.
- **No inventa:** sin apuntes relevantes la respuesta es un texto fijo; el LLM ni se llama. La charla tiene prohibido explicar contenidos.
- **Cada colegio tiene lo suyo:** el colegio sale del JWT (`tenant_id`) y la base filtra con RLS; otro colegio ve 0 filas.
- **Solo el docente del curso o el admin suben apuntes:** la ruta da 403 al estudiante y, aunque la API fallara, la base lo rechaza (políticas por rol de `02_s06_ajustes.sql` §9).
- La charla se detecta con reglas fijas (`isSmallTalk` en `rag-prompt.js`), no con el LLM: "hola" es charla; "hola, ¿qué es una fracción?" va a los apuntes.
- En los logs solo queda el tipo de turno y el puntaje, nunca el texto de la pregunta (menores de edad).

### Probarlo (con `ollama serve` corriendo)

| Modo | Cuándo | Dónde quedan los apuntes |
|---|---|---|
| Archivo JSON | sin `DATABASE_URL` (lo más rápido) | `data/rag-store.json` |
| PostgreSQL | con `DATABASE_URL` | `apuntes_curso` y `apuntes_embeddings` |

```bash
npm run ingest -- samples/fracciones.md            # al curso DEFAULT_COURSE_ID (con BD: actúa como su docente)
# Colegio B (otro tenant): su propio curso y apuntes distintos
DEFAULT_TENANT_ID=22222222-2222-2222-2222-222222222222 npm run ingest -- c0000000-0000-0000-0000-0000000000b1 samples/geometria.md
npm run rag:search -- "¿qué indica el numerador?"   # puntajes: USA / DESCARTA
npm run dev
```

Chat de prueba (sin token usa `DEFAULT_TENANT_ID` y `DEFAULT_COURSE_ID`; con token, el colegio del JWT):

```bash
curl -i localhost:3000/v1/dev/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hola pluma"}]}'
```

Para subir apuntes por API con PostgreSQL: `POST /v1/dev/courses/{courseId}/documents` con `Authorization: Bearer $(npm run -s dev:token -- docente)` y `{ "name": "fracciones.md", "text": "..." }`.

**Ajustar la calidad:** con `npm run rag:search` prueba preguntas que sí están en los apuntes y otras que no, y pon `RAG_MIN_SCORE` entre ambos grupos (con bge-m3 suele quedar entre 0.4 y 0.6). Si faltan frases de charla, agrégalas en `SMALL_TALK` de `rag-prompt.js` (con su prueba en `test/rag.test.js`).


## Endpoints

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| GET | `/health` | — | `{ status, llm: "up" \| "down", db: "up" \| "down" \| "disabled", rag: "postgres" \| "archivo" \| "disabled" }` |
| GET | `/v1/courses/{id}/tutor-conversations?limit=` | estudiante | Mis conversaciones guardadas con el tutor en ese curso, la más reciente primero (ADR 0008). Docente y admin: 403. |
| POST | `/v1/courses/{id}/tutor-conversations/{convId}/messages` | estudiante | `{ content, mode? }` → streaming `text/plain` con las mismas cabeceras que el chat. El id lo genera el cliente: el primer mensaje crea la conversación. El servidor usa el historial guardado y guarda pregunta + respuesta cuando la respuesta termina. |
| GET | `/v1/tutor-conversations/{convId}` | estudiante (dueño) | La conversación con sus mensajes. 404 para cualquier otro usuario. |
| DELETE | `/v1/tutor-conversations/{convId}` | estudiante (dueño) | Borra la conversación. Retención: `npm run tutor:purgar` borra las de años anteriores (job anual o diario). |
| POST | `/v1/dev/chat` | token opcional en desarrollo (obligatorio en producción) | `{ mode?: "tutor" \| "pruebas", course_id?: uuid, messages: [{ role, content }] }` → streaming `text/plain`. Cabeceras `X-Tutor-Turn`, `X-Rag-Grounded`, `X-Rag-Sources`. Con token, 404 si el usuario no participa en el curso. Fuera del contrato OpenAPI. |
| POST / GET / DELETE | `/v1/dev/courses/{courseId}/documents[/{docId}]` | docente del curso, admin (GET: también estudiantes del curso) | Subir (201), listar o borrar (204) apuntes. No existe con `NODE_ENV=production`. |
| POST | `/v1/auth/login` | pública | `{ rbd, email, password }` → `{ access_token, token_type, expires_in, user }`. Cualquier fallo: el mismo 401; 5 fallos seguidos de una cuenta: 429 con `Retry-After`. |
| GET | `/v1/me` | cualquier rol | Mi perfil y mi colegio. |
| GET | `/v1/courses?period=&limit=&cursor=` | cualquier rol | Cursos visibles: el estudiante ve sus asignaturas, el docente sus clases, el admin todo el colegio. Incluye `teacher_name`, `tutor_available` y `tutor_documents`. Paginación por cursor. |
| GET | `/v1/courses/{courseId}` | quien participa | Un curso; 404 si no participas o es de otro colegio. |
| GET | `/v1/me/grades?course_id=` | estudiante | **Todas** mis asignaturas (también sin notas), con promedio ponderado, docente y `tutor_available`. Solo lectura. |
| GET | `/v1/me/grades/{assessmentId}` | estudiante | Detalle de una evaluación entregada: respuesta elegida, si fue correcta y la retroalimentación. |
| GET | `/v1/courses/{courseId}/gradebook` | docente del curso, admin | Libro de notas: evaluaciones × estudiantes, promedio por estudiante y del curso. |
| GET | `/v1/courses/{courseId}/grades/summary?threshold=4.0` | docente del curso, admin | Por evaluación: entregas, pendientes, promedio, mínima, máxima, aprobados y reprobados. Además, los estudiantes con promedio bajo el umbral (`at_risk`). |
| GET | `/v1/courses/{courseId}/students/{studentId}/grades` | docente del curso, admin, el propio estudiante | Notas y promedio de un estudiante en el curso. |
| GET | `/v1/assessments/{assessmentId}/results?student_id=` | docente del curso, admin | Dashboard H3 (contrato S05): entregas, puntaje y nota promedio, tasa de acierto por pregunta y detalle por estudiante. |
| PATCH | `/v1/assessments/{assessmentId}/grading` | docente del curso, admin | `{ pass_threshold?: 1–99, weight?: > 0 }`: cambia la exigencia (% para el 4.0) o la ponderación. Las notas se recalculan solas. |

Todas las rutas con datos exigen `Authorization: Bearer <JWT>` HS256 con `sub`, `tenant_id` y `role` (contrato S05; lo entrega `POST /v1/auth/login`, y para pruebas `npm run dev:token`). Matriz completa: [permisos.md](../../FeathersForAll/Documentos/api/permisos.md). Cada request corre en una transacción con `app.colegio_id` = `tenant_id`, así que el RLS impide ver datos de otro colegio (un curso ajeno responde 404).

**Cómo se calcula la nota:** el puntaje (0–100 % de logro) se convierte con la exigencia de la evaluación (60 % por defecto): bajo la exigencia va de 1.0 a 4.0 y sobre ella de 4.0 a 7.0, redondeado a un decimal. Los promedios se ponderan por `weight` y solo consideran evaluaciones entregadas.

Los errores usan RFC 7807 (`application/problem+json`, con `trace_id`). Si Ollama no responde, el chat devuelve `503`; si PostgreSQL no responde, las rutas de notas devuelven `503`. En ambos casos el resto del servidor sigue funcionando.

## Estructura

```text
db/
  01_schema.sql, 02_s06_ajustes.sql, 03_notas.sql, 04_privacidad_login.sql,
  05_conversaciones_tutor.sql                                                  # esquema (aplicar en orden)
  permisos_app.sql          # GRANT del rol de la API (sin lectura de password_hash)
  docker-init.sh            # lo usa compose.yaml en el primer arranque
  crear_bdd.sql             # crea todo en un paso: esquema + usuario de la API (+ demo)
  90_seed_demo.sql          # datos demo (2 colegios, cursos, notas)
  queries.js                # todas las consultas SQL
  consultas_demo.sql        # consultas de notas para ejecutar desde VS Code / psql
  98_test_s06_ajustes.sql, test_integridad.sql
src/
  server.js                 # config por env, arranque y apagado graceful
  app.js                    # Express: middlewares, rutas, errores
  platform/                 # trace_id + logs JSON, errores RFC 7807, PostgreSQL, JWT
  modules/tutor/
    llm-client.js           # única pieza que conoce a Ollama (chat)
    embeddings-client.js    # única pieza que conoce los embeddings de Ollama
    tutor.routes.js         # POST /v1/dev/chat
    conversaciones.routes.js # conversaciones guardadas del estudiante (ADR 0008)
    turn.js                 # atiende un turno (RAG + streaming); lo comparten las dos rutas
    system-prompt.js        # prompts por modo (tutor, pruebas)
    rag/
      chunker.js            # divide apuntes en fragmentos
      pg-vector-store.js    # pgvector + RLS + rol del usuario (PostgreSQL)
      vector-store.js       # archivo JSON (sin base de datos)
      rag-service.js        # ingesta y recuperación
      rag-prompt.js         # charla vs. materia, prompt con apuntes, respuestas fijas
      rag.routes.js         # carga de apuntes (desarrollo)
      create-rag.js         # arma el RAG desde .env
      errors.js
  modules/notas/
    notas.routes.js         # rutas de notas
scripts/dev-token.js        # JWT de desarrollo para los usuarios demo
scripts/ingest.js, search.js, db-setup.js   # RAG y creación de la base sin psql
samples/fracciones.md       # apunte de ejemplo (sintético)
requests/notas.http         # peticiones listas para REST Client (VS Code)
test/
```

Para cambiar de modelo o de proveedor basta con cambiar `LLM_MODEL` / `LLM_ENDPOINT` en `.env` (o `llm-client.js` si es otro proveedor).
