# FeathersForAll — backend

La interfaz está en [`../frontend`](../frontend/).

Monolito modular Node.js + Express (ADR 0002). Módulos:

- `tutor`: tutor de IA con LLM local (Ollama) y **RAG**: responde con los apuntes que subió el docente, conversa si el estudiante solo saluda, y si la respuesta no está en los apuntes dice "No encuentro eso" en vez de inventar.
- `notas`: notas en escala chilena 1.0–7.0 sobre PostgreSQL (opcional: sin `DATABASE_URL` el servidor arranca solo con el chat).

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

### Base de datos local

```bash
createdb feathersforall
cd db
# Esquema (01 + 02 + 03) + usuario de la API feathersforall_app + datos demo, en un paso:
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

### Probar desde VS Code

El repo recomienda dos extensiones (`.vscode/extensions.json`; VS Code ofrece instalarlas al abrir la carpeta):

- **REST Client** (`humao.rest-client`): abre [`requests/notas.http`](requests/notas.http), pega la salida de `npm run dev:token -- --http` donde dice `PEGAR` y haz clic en *Send Request*. Trae todas las rutas de notas con cada rol, y también los casos que deben fallar (401, 403, 404, 400).
- **PostgreSQL** (`ms-ossdata.vscode-pgsql`, de Microsoft): conéctate a `localhost:5432`, base `feathersforall`, usuario `feathersforall_app`, y abre [`db/consultas_demo.sql`](db/consultas_demo.sql). Ejecuta primero el bloque 0 (fija el colegio para el RLS) y luego cualquier consulta: libro de notas, promedios, estudiantes en riesgo, tasa de acierto, tabla puntaje → nota y la prueba de aislamiento entre colegios.

Pruebas de integración contra PostgreSQL real (crean y borran una base temporal):

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
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
| POST | `/v1/dev/chat` | token opcional en desarrollo (obligatorio en producción) | `{ mode?: "tutor" \| "pruebas", course_id?: uuid, messages: [{ role, content }] }` → streaming `text/plain`. Cabeceras `X-Tutor-Turn`, `X-Rag-Grounded`, `X-Rag-Sources`. Con token, 404 si el usuario no participa en el curso. Fuera del contrato OpenAPI. |
| POST / GET / DELETE | `/v1/dev/courses/{courseId}/documents[/{docId}]` | docente del curso, admin (GET: también estudiantes del curso) | Subir (201), listar o borrar (204) apuntes. No existe con `NODE_ENV=production`. |
| GET | `/v1/me/grades?course_id=` | estudiante | Mis notas agrupadas por curso, con el promedio ponderado de cada curso. |
| GET | `/v1/me/grades/{assessmentId}` | estudiante | Detalle de una evaluación entregada: respuesta elegida, si fue correcta y la retroalimentación. |
| GET | `/v1/courses/{courseId}/gradebook` | docente del curso, admin | Libro de notas: evaluaciones × estudiantes, promedio por estudiante y del curso. |
| GET | `/v1/courses/{courseId}/grades/summary?threshold=4.0` | docente del curso, admin | Por evaluación: entregas, pendientes, promedio, mínima, máxima, aprobados y reprobados. Además, los estudiantes con promedio bajo el umbral (`at_risk`). |
| GET | `/v1/courses/{courseId}/students/{studentId}/grades` | docente del curso, admin, el propio estudiante | Notas y promedio de un estudiante en el curso. |
| GET | `/v1/assessments/{assessmentId}/results?student_id=` | docente del curso, admin | Dashboard H3 (contrato S05): entregas, puntaje y nota promedio, tasa de acierto por pregunta y detalle por estudiante. |
| PATCH | `/v1/assessments/{assessmentId}/grading` | docente del curso, admin | `{ pass_threshold?: 1–99, weight?: > 0 }`: cambia la exigencia (% para el 4.0) o la ponderación. Las notas se recalculan solas. |

Las rutas de notas exigen `Authorization: Bearer <JWT>` HS256 con `sub`, `tenant_id` y `role` (contrato S05). Cada request corre en una transacción con `app.colegio_id` = `tenant_id`, así que el RLS impide ver datos de otro colegio (un curso ajeno responde 404).

**Cómo se calcula la nota:** el puntaje (0–100 % de logro) se convierte con la exigencia de la evaluación (60 % por defecto): bajo la exigencia va de 1.0 a 4.0 y sobre ella de 4.0 a 7.0, redondeado a un decimal. Los promedios se ponderan por `weight` y solo consideran evaluaciones entregadas.

Los errores usan RFC 7807 (`application/problem+json`, con `trace_id`). Si Ollama no responde, el chat devuelve `503`; si PostgreSQL no responde, las rutas de notas devuelven `503`. En ambos casos el resto del servidor sigue funcionando.

## Estructura

```text
db/
  01_schema.sql, 02_s06_ajustes.sql, 03_notas.sql   # esquema (aplicar en orden)
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
