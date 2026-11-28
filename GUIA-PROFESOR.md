# Guía para probar FeathersForAll (profesor)

Esta guía permite levantar el sistema desde cero y probar cada funcionalidad con datos de ejemplo. Toma unos **15 minutos** la primera vez. Todos los datos son **sintéticos**: no hay información real de estudiantes.

> Cómo funciona por dentro (arquitectura, seguridad, reglas): [`COMO-FUNCIONA.md`](COMO-FUNCIONA.md).

---

## 1. Requisitos

| Programa | Versión | Para qué |
|---|---|---|
| Git | cualquiera | Clonar el repositorio |
| Docker Desktop (o Docker Engine con Compose) | 24 o superior | Base de datos PostgreSQL 16 + pgvector |
| Node.js | 22 o superior | API y portal |
| Navegador | Chrome, Edge, Firefox o Brave | Usar el portal |
| *(Opcional)* Ollama | reciente | Solo para el Tutor IA y la generación de evaluaciones con IA |

El puerto **5432** debe estar libre. Si tiene un PostgreSQL instalado en el equipo, deténgalo mientras prueba.

## 2. Levantar el sistema (comandos)

Los comandos son para una terminal **bash** (Linux, macOS, WSL o Git Bash en Windows). Hay que abrir **dos terminales**: una para la API y otra para el portal.

### Terminal 1: base de datos y API

```bash
git clone https://github.com/Erolayer-Cl/FeathersForAll.git
cd FeathersForAll/code/backend

# 1. Base de datos con el esquema completo y los datos de ejemplo (tarda ~20 s la primera vez)
docker compose up -d --wait

# 2. Configuración: copia el ejemplo y genera la clave que firma las sesiones
cp .env.example .env
sed -i.bak "s/^JWT_SECRET=$/JWT_SECRET=$(openssl rand -hex 32)/" .env

# 3. Dependencias y API
npm install
npm run dev
```

Debe aparecer un registro con `"msg":"servidor iniciado"` y `"port":3000`. Para comprobarlo, desde otra terminal:

```bash
curl http://localhost:3000/readyz      # → {"status":"ready","db":"up"}
```

> **Windows sin bash (PowerShell):** reemplace el paso 2 por estas dos líneas (probadas en PowerShell 7):
>
> ```powershell
> Copy-Item .env.example .env
> (Get-Content .env) -replace '^JWT_SECRET=$', ('JWT_SECRET=' + [guid]::NewGuid().ToString('N') * 2) | Set-Content .env
> ```

### Terminal 2: portal

```bash
cd FeathersForAll/code/frontend
npm install
npm run dev
```

Abra **http://localhost:5173/portal.html**.

### Volver a empezar de cero

```bash
cd FeathersForAll/code/backend
docker compose down -v && docker compose up -d --wait    # borra la base y la crea de nuevo con los datos de ejemplo
```

## 3. Cuentas de ejemplo

Contraseña de **todas**: `demo1234`

| Rol | Pestaña del login | Correo | Qué tiene |
|---|---|---|---|
| Estudiante | Estudiante | `camila@demo-a.cl` | Matemáticas e Historia, con notas |
| Estudiante | Estudiante | `sofia@demo-a.cl` | Otra estudiante del mismo curso |
| Docente | Docente | `ana.rojas@demo-a.cl` | Dicta Matemáticas 7° Básico A |
| Docente | Docente | `luis.perez@demo-a.cl` | Dicta Historia (no ve Matemáticas) |
| Administrador | Administrador (pide **RBD `99901`**) | `marta.soto@demo-a.cl` | Administra el Colegio Demo A |
| Apoderada | Apoderado | `carolina.diaz@demo-a.cl` | Apoderada de Camila |
| Otro colegio | Estudiante | `javiera@demo-b.cl` | Colegio Demo B (para probar el aislamiento) |

## 4. Recorrido paso a paso

Se recomienda seguir el orden: cada parte usa lo que se creó en la anterior. Use **otra ventana privada** del navegador para cada cuenta, así puede tener dos sesiones abiertas a la vez.

### A. Administrador: cuentas, cursos y bitácora (≈ 4 min)

1. Entre con la pestaña **Administrador**: RBD `99901`, `marta.soto@demo-a.cl`, `demo1234`.
   → *Panel de administración con cursos y «Cuentas activas».*
2. Menú **Usuarios**. Filtre por rol «Docentes» y escriba «rojas» en el buscador.
   → *Solo aparece Ana Rojas. No aparece nadie del Colegio Demo B.*
3. **+ Agregar usuario**: nombre «Profesor Prueba», correo `profesor.prueba@demo-a.cl`, rol **Docente**. Pulse **Generar** para la contraseña y **anótela**. Luego **Crear cuenta**.
   → *Se abre «Gestionar usuario» de la cuenta nueva.*
4. Pulse **Desactivar cuenta** y confirme. En una ventana privada, intente entrar con esa cuenta.
   → *«El correo o la contraseña no son correctos».* Vuelva y pulse **Reactivar cuenta**.
5. Menú **Cursos → + Crear curso**: nombre «Ciencias 8° A», período `2026-S2`, docente **Profesor Prueba** (elíjalo de la lista) y **Agregar curso**.
   → *Se abre el detalle del curso.* Matricule a `camila@demo-a.cl` con **+ Matricular**.
6. **Usuarios → Carolina Díaz → Gestionar**: en «Pupilos» aparece Camila. Intente vincular `javiera@demo-b.cl`.
   → *«No hay un estudiante activo con ese correo en tu colegio»: un colegio no puede vincular estudiantes de otro.*
7. **Usuarios → Ver bitácora**.
   → *Quedó registrado quién creó, desactivó y reactivó la cuenta.*

### B. Docente: prueba con tiempo (≈ 4 min)

1. En otra ventana privada, entre en la pestaña **Docente** con `profesor.prueba@demo-a.cl` y la contraseña anotada.
2. **Configuración → Cambiar contraseña**: la actual y una nueva (por ejemplo, `profe-nueva-1`).
   → *«Listo: cambiaste tu contraseña». La contraseña anterior deja de funcionar.*
3. **Mis cursos → Ciencias 8° A → Entrar →** en «Evaluaciones», **Nueva evaluación**:
   - Título: «Control relámpago».
   - **Tiempo por estudiante, en minutos: `2`**.
   - Pregunta 1 (alternativas): «¿Cuánto es 2 + 2?», alternativa 1 «3», alternativa 2 «4». Marque la **2** como correcta.
   - **Agregar pregunta de respuesta escrita**: «Explica qué es una célula» y deje vacías las respuestas aceptadas (la revisará el docente).
   - **Guardar borrador**.
4. En la evaluación, pulse **Publicar**, elija «Sin cierre automático» y vuelva a pulsar **Publicar**.
   → *Estado «Publicada».*

### C. Estudiante: rendir con tiempo y ver la nota (≈ 3 min)

1. En otra ventana privada, entre en la pestaña **Estudiante** con `camila@demo-a.cl` / `demo1234`.
2. **Mis cursos →** en la fila de «Ciencias 8° A», **Entrar →**. En «Por rendir» aparece «Control relámpago · 2 min desde que empieces». Pulse **Rendir**.
   → *Todavía **no** se ven las preguntas: aparece «Evaluación con tiempo» y el botón **Empezar ahora**.*
3. Pulse **Empezar ahora**.
   → *Aparecen las preguntas y un reloj ⏱ 2:00 que baja.*
4. Elija «4» y escriba algo en la pregunta escrita. **Recargue la página (F5).**
   → *El reloj **no** se reinicia y sus respuestas siguen ahí.*
5. **No entregue**: espere a que el reloj llegue a cero.
   → *La evaluación **se entrega sola** («Se acabó el tiempo: entregamos automáticamente…») y muestra la nota. Es **provisional**, porque la pregunta escrita espera revisión del docente.*
6. **Mis notas**.
   → *La nota aparece con un asterisco «\*»: es provisional.*

### D. Docente: revisar y libro de notas (≈ 2 min)

1. En la ventana del docente: **Mis cursos → Ciencias 8° A → Control relámpago**.
   → *En «Respuestas escritas» está la respuesta de Camila «por revisar».*
2. Márquela **Correcta**.
   → *La nota de Camila sube al instante.*
3. Vuelva al curso y pulse **Libro de notas**.
   → *Camila con su nota final. Cambie el «Umbral de riesgo» y pulse **Exportar CSV**: se descarga un archivo que abre en Excel con coma decimal.*

### E. Apoderada: seguimiento del avance (≈ 1 min)

1. En otra ventana privada, entre en la pestaña **Apoderado** con `carolina.diaz@demo-a.cl` / `demo1234`.
   → *«Mis pupilos»: Camila con su promedio general, sus asignaturas (también Ciencias 8° A, con la nota del control) y lo que tiene por rendir.*
2. Compruebe lo que **no** puede ver: no hay menú de cursos, tutor ni respuestas. Si escribe en la barra de direcciones `#/portal/est-notas`, vuelve a su panel.

### F. Seguridad y aislamiento (≈ 2 min, con la terminal)

Estos comandos muestran que la API protege los datos aunque alguien intente saltarse el portal.

```bash
# Sesión de Camila (estudiante del Colegio A)
TOKEN=$(curl -s localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"camila@demo-a.cl","password":"demo1234"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')

# 1. Sus notas: 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/v1/me/grades -H "authorization: Bearer $TOKEN"

# 2. El libro de notas del curso (es del docente): 403
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/v1/courses/c0000000-0000-0000-0000-000000000001/gradebook -H "authorization: Bearer $TOKEN"

# 3. Un curso de OTRO colegio: 404 (ni siquiera se revela que existe)
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/v1/courses/c0000000-0000-0000-0000-0000000000b1 -H "authorization: Bearer $TOKEN"

# 4. Sin sesión: 401, con el error en formato RFC 7807
curl -s localhost:3000/v1/me/grades

# 5. Freno de fuerza bruta: tras 5 claves malas, 429 con Retry-After
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " localhost:3000/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"sofia@demo-a.cl","password":"mala"}'; done; echo
```

Resultado esperado: `200`, `403`, `404`, un JSON con `"status":401` y `401 401 401 401 401 429`.

Si quiere ver la protección **dentro de la base de datos** (Row Level Security): con una sesión de estudiante, la base no devuelve la alternativa correcta aunque se la pida directamente.

```bash
docker compose exec db psql -U postgres -d feathersforall -c "
SET ROLE feathersforall_app;
SELECT set_config('app.colegio_id','11111111-1111-1111-1111-111111111111',false),
       set_config('app.usuario_id','e0000000-0000-0000-0000-000000000001',false),
       set_config('app.rol','estudiante',false);
SELECT es_correcta FROM alternativas LIMIT 1;"
```

→ *`ERROR: permission denied for table alternativas`: ni siquiera la API puede leer esa columna.*

### G. *(Opcional)* Tutor IA y evaluaciones con IA

Requiere [Ollama](https://ollama.com) instalado (unos 3 GB de modelos).

```bash
ollama pull qwen2.5:3b && ollama pull bge-m3
ollama serve                                   # en otra terminal, si no quedó corriendo
cd FeathersForAll/code/backend && npm run ingest   # carga los apuntes de ejemplo
```

1. Como **Camila**: menú **Tutor IA**, curso Matemáticas, pregunte «¿Qué es una fracción equivalente?».
   → *La respuesta cita su fuente (los apuntes del curso). Una pregunta fuera del temario («¿quién ganó el mundial?») recibe «no tengo información suficiente».*
2. Como **Ana Rojas** (docente): **Nueva evaluación → Generar con IA** con el tema «fracciones».
   → *Propone preguntas basadas en los apuntes. No guarda nada hasta que el docente revisa y pulsa Guardar.*

## 5. Pruebas automáticas

Con la base de datos del paso 2 corriendo:

```bash
# Backend: 778 pruebas (rutas, permisos, RLS y flujos completos contra PostgreSQL real)
cd FeathersForAll/code/backend
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test

# Frontend: 188 pruebas, lint y compilación
cd ../frontend
npm test && npm run lint && npm run build

# Contrato OpenAPI (reglas de diseño de la API)
cd ../../FeathersForAll
npx --yes @stoplight/spectral-cli@6 lint api/openapi.yaml

# API de punta a punta con Postman/Newman (con la API corriendo en el puerto 3000)
cd ../code/backend
npm run test:postman
```

Resultado esperado: todas en verde (`fail 0`; Spectral: «No results with a severity of 'error'»).

> `npm run test:postman` incluye la carpeta del tutor, que necesita Ollama. Sin Ollama, esas pocas peticiones fallan; el resto debe pasar. La CI corre solo las carpetas que no usan el tutor.

## 6. Si algo falla

| Síntoma | Causa probable | Solución |
|---|---|---|
| `docker compose up` falla con «port 5432 already in use» | Hay otro PostgreSQL en el equipo | Deténgalo, o en `compose.yaml` cambie `5432:5432` por `5433:5432` y use `5433` en las URL de `.env` |
| La API termina con «JWT_SECRET» | `.env` sin la clave de sesión | Repita el paso 2 de la sección 2 |
| El login dice «No pudimos conectar con el servidor» | La API no está corriendo | Revise la Terminal 1 (`npm run dev`) |
| El login de administrador falla | Falta el RBD | Use la pestaña **Administrador** con RBD `99901` |
| Datos raros tras muchas pruebas | Datos acumulados | `docker compose down -v && docker compose up -d --wait` |
| El Tutor IA responde «no disponible» | Ollama no está corriendo | Sección G, o ignórelo: el resto funciona sin IA |

## 7. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Cómo funciona por dentro | [`COMO-FUNCIONA.md`](COMO-FUNCIONA.md) |
| Matriz de permisos por rol | [`FeathersForAll/Documentos/api/permisos.md`](FeathersForAll/Documentos/api/permisos.md) |
| Contrato de la API (OpenAPI 3.1) | [`FeathersForAll/api/openapi.yaml`](FeathersForAll/api/openapi.yaml) |
| Decisiones de arquitectura (ADR) | [`FeathersForAll/Documentos/adr/`](FeathersForAll/Documentos/adr/) |
| Historias de usuario y escenarios | [`FeathersForAll/Documentos/backlog.md`](FeathersForAll/Documentos/backlog.md), `FeathersForAll/Documentos/scenarios/` |
