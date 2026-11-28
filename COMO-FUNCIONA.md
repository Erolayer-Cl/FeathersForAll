# Cómo funciona FeathersForAll

Guía para entender el programa de punta a punta: qué hace cada rol, cómo viaja una petición, dónde se protegen los datos y cómo levantarlo para probarlo. El detalle de cada decisión está en los ADR (`FeathersForAll/Documentos/adr/`) y la lista exacta de permisos, en [`permisos.md`](FeathersForAll/Documentos/api/permisos.md).

> Estado: contrato **v1.12.0**, migraciones `01` a `17`. Todos los datos de ejemplo son sintéticos.

---

## 1. Qué es

FeathersForAll es una plataforma web para colegios. Cada colegio es un *tenant* aislado: nadie de un colegio ve datos de otro. Tiene cuatro tipos de cuenta:

| Rol | Para qué la usa |
|---|---|
| **Estudiante** | Ve sus cursos y notas, rinde evaluaciones (algunas con tiempo), entrega tareas, descarga material y pregunta al Tutor IA |
| **Docente** | Crea cursos, matricula, arma evaluaciones (a mano o con IA), las publica, revisa respuestas escritas, lleva el libro de notas y sube apuntes |
| **Administrador del colegio** | Gestiona las cuentas (crear, desactivar, restablecer claves), crea cursos, vincula apoderados y revisa la bitácora |
| **Apoderado** | Sigue el avance de los estudiantes a su cargo: notas, promedios y evaluaciones por rendir (solo lectura) |

## 2. Piezas del sistema

```
 Navegador (portal React)  ──HTTPS──►  NGINX (estáticos + CSP)
                                   └─/v1──►  API Node.js/Express  ──►  PostgreSQL 16 + pgvector (RLS)
                                                    └──────────────►  Ollama (LLM qwen2.5:3b + embeddings bge-m3)
```

| Pieza | Dónde | Qué hace |
|---|---|---|
| Portal | `code/frontend/` (React 19 + Vite) | `portal.html`: una pantalla por rol, con navegación por `#/portal/<pantalla>` |
| API | `code/backend/` (monolito modular) | Rutas `/v1/...` del contrato `FeathersForAll/api/openapi.yaml`. Módulos en `src/modules/`: `identidad`, `usuarios`, `cursos`, `evaluaciones`, `notas`, `contenido`, `tutor`, `apoderado` |
| Base de datos | `code/backend/db/` | Esquema en archivos SQL numerados (`01`…`17`), permisos en `permisos_app.sql`, datos demo en `90_seed_demo.sql`, consultas en `queries.js` |
| Tutor IA | `src/modules/tutor/` | RAG: busca en los apuntes del curso (vectores + texto) y responde con el LLM |
| Infraestructura | `k8s/`, `terraform/`, `.github/workflows/` | Kubernetes (kind), GitOps con Argo CD y los gates de CI/DevSecOps |

## 3. Cómo viaja una petición

1. **Login.** `POST /v1/auth/login` con correo y contraseña. Estudiantes, docentes y apoderados entran solo con correo; el administrador agrega el RBD del colegio. La API verifica la clave (scrypt) y entrega un **JWT** que dura 8 h y solo trae `sub` (usuario), `tenant_id` (colegio) y `role`.
2. **Cada petición** lleva `Authorization: Bearer <JWT>`. La API verifica la firma y abre una transacción con `db.withUser()`, que:
   - comprueba que la cuenta siga **activa**, con el mismo rol, en un colegio activo y **sin un cambio de clave posterior al token**; si no, responde `401`;
   - fija en PostgreSQL `app.colegio_id`, `app.usuario_id` y `app.rol`, tomados del token y nunca del cuerpo de la petición.
3. **La base filtra sola** con Row Level Security (RLS): cada consulta solo ve filas del colegio de la sesión y, dentro de él, lo que el rol puede ver.
4. **Errores** en formato RFC 7807 (`application/problem+json`):
   - **404** si el recurso es de otro colegio o no participas en él;
   - **403** si eres del colegio pero tu rol no puede hacer la acción;
   - **409** por estado (ya rendida, plazo vencido);
   - **422** por reglas de negocio;
   - **429** por exceso de intentos.

## 4. Los flujos principales

### 4.1 Cuentas (administrador)

- **Usuarios** lista las cuentas del colegio con filtros por rol y estado.
- **Agregar usuario** crea un docente, estudiante, apoderado u otro administrador. La clave inicial la elige el admin (puede generarla en el navegador) y nunca se devuelve ni se guarda en texto.
- **Gestionar usuario** sirve para:
  - editar el nombre y el correo;
  - **desactivar** la cuenta, lo que corta su sesión en la siguiente petición sin borrar su historial;
  - **restablecer la contraseña**, lo que también corta sus sesiones;
  - en un apoderado, vincular o desvincular estudiantes por correo.

  El rol de una cuenta no se cambia nunca.
- **Bitácora:** quién creó, editó, desactivó o vinculó cuentas. No se puede editar ni borrar.
- Cualquier usuario cambia su propia clave en **Configuración**: pide la actual, entrega un token nuevo y deja vencidos los demás.

### 4.2 Curso y matrícula (docente o administrador)

1. El docente crea un curso a su nombre; el admin lo crea eligiendo al docente de una lista.
2. Se matricula a cada estudiante por su correo institucional (solo estudiantes del mismo colegio).

### 4.3 Evaluaciones: crear, publicar, rendir y poner nota

1. **Crear (docente).** Hay preguntas de alternativas, con la correcta marcada, y de respuesta escrita, con las respuestas aceptadas o vacías para revisarlas a mano. Se puede pedir un borrador a la IA a partir de un tema y los apuntes del curso: la IA solo propone y el docente revisa y guarda.
2. **Tiempo (opcional).**
   - **Cierre común:** una hora a la que la evaluación se cierra para todos.
   - **Minutos por estudiante:** cada estudiante tiene ese tiempo desde que la empieza, sin pasar del cierre.
3. **Publicar.** No se publica si falta la alternativa correcta en alguna pregunta.
4. **Rendir (estudiante).**
   - Con tiempo, ve «Empezar ahora» y recién entonces recibe las preguntas.
   - El reloj usa la **hora del servidor**, así que adelantar el reloj del equipo no da más tiempo.
   - Lo respondido se guarda en el navegador: recargar la página no lo pierde.
   - 5 segundos antes del plazo, **la prueba se entrega sola**.
   - La base rechaza respuestas fuera de plazo (acepta 30 s de margen por la red).
5. **Corrección.** La hace la **base de datos** con un trigger: el estudiante no puede marcar su propia respuesta como correcta. Las respuestas escritas se comparan sin distinguir mayúsculas, tildes ni puntuación, y los números por su valor («7,0» = «7»; «1.000» = mil).
6. **Nota inmediata** en escala chilena **1,0–7,0**: bajo la exigencia (60 % por defecto), `1 + 3·logro/exigencia`; desde ella, `4 + 3·(logro − exigencia)/(100 − exigencia)`. El estudiante ve su nota y la retroalimentación de cada pregunta al entregar.
7. **Revisión docente.** Las respuestas escritas sin respuesta aceptada quedan «por revisar» y valen 0 hasta que el docente las marca. Mientras tanto la nota aparece como **provisional** en «Mis notas», en el libro y en «estudiantes en riesgo».
8. **Quien empezó y no entregó** queda con nota: su intento se cierra solo con lo que alcanzó a responder. Quien **nunca abrió** una evaluación ya cerrada queda «sin rendir» y decide el docente, según el reglamento del colegio.

### 4.4 Libro de notas (docente)

- Hay una tabla de estudiantes por evaluaciones, con el promedio **ponderado**; las notas provisionales llevan `*`.
- Se pueden cambiar la exigencia y la ponderación de cada evaluación; las notas se recalculan solas.
- «Estudiantes en riesgo» usa un umbral que se elige en pantalla.
- **Exportar CSV** genera un archivo listo para Excel en Chile (separador `;`, coma decimal) y protegido contra fórmulas.

### 4.5 Material y tareas

- Los apuntes que sube el docente alimentan al Tutor IA y, si los marca **visibles**, los estudiantes los descargan. Una pauta con respuestas se sube como «solo para el tutor».
- Las tareas tienen una hora límite que hace cumplir la base. El estudiante sube un archivo, que puede reemplazar hasta esa hora, y el docente descarga las entregas.

### 4.6 Tutor IA (estudiante)

- El estudiante pregunta en el contexto de un curso. La API busca en los apuntes **de ese curso y ese colegio** y responde con el LLM, citando la fuente.
- Si no hay respaldo en los apuntes, lo dice en vez de inventar. Responde las nociones básicas (un cálculo, un concepto elemental) sin apuntes.
- Las conversaciones son **privadas del estudiante**: ni el docente ni el admin las leen, y se borran al terminar el año escolar.
- Hay un tope de preguntas por estudiante. Los apuntes se revisan antes de cargarlos, para detectar órdenes escondidas dirigidas a la IA.

### 4.7 Panel del apoderado

- El admin crea la cuenta del apoderado y le vincula a los estudiantes a su cargo.
- El apoderado entra con su correo y ve, por cada estudiante, sus ramos con promedio, sus notas (las provisionales marcadas) y lo que tiene por rendir.
- **No ve** respuestas, retroalimentación, apuntes, conversaciones del tutor ni a otros estudiantes. Para el RLS no existe ninguna tabla académica: lo que lee sale de funciones de la base limitadas a sus estudiantes vinculados.

## 5. Dónde se protegen los datos (datos de menores)

La API valida cada permiso, y **la base vuelve a validarlo**, para que un error en la API no filtre nada:

| Capa | Qué impide |
|---|---|
| RLS por colegio (`01`) | Ver o escribir filas de otro colegio. Sin colegio en la sesión no se ve nada |
| RLS por rol (`02`, `04`, `05`, `10`, `14`, `16`) | Que el estudiante vea a otros estudiantes o borradores, que el docente vea cursos ajenos, que alguien lea las conversaciones del tutor de otro y que el apoderado vea tablas académicas |
| Permisos por columna (`permisos_app.sql`, `17`) | Que la API lea `password_hash`, la alternativa correcta o las respuestas aceptadas con un `SELECT` directo |
| Triggers (`09`, `11`, `12`, `13`, `14`) | Que el estudiante se ponga nota, cambie sus horas o responda fuera de plazo, y que se cambie el rol de una cuenta |
| Sesión (`13`) | Que un token siga sirviendo después de desactivar la cuenta o cambiar la clave |
| Bitácora (`13`) | Que las acciones sobre cuentas queden sin registro o se borren |
| Logs | Guardar cuerpos de petición, preguntas al tutor, claves o tokens (se redactan) |
| Portal | Scripts o estilos de terceros (CSP estricta en NGINX) y clickjacking |

La API se conecta como `feathersforall_app`, sin superusuario ni `BYPASSRLS`. Así el RLS se aplica siempre.

## 6. Levantarlo en local

> Guía paso a paso con todo lo que hay que probar y el resultado esperado: [`GUIA-PROFESOR.md`](GUIA-PROFESOR.md).

```bash
# 1. Base de datos (PostgreSQL + pgvector con esquema y datos demo)
cd code/backend
docker compose up -d            # la primera vez crea todo; "down -v" para empezar de cero
npm install
npm run db:setup                # en una base ya existente, aplica las migraciones que falten (01–17)

# 2. API (requiere JWT_SECRET en .env; ver .env.example)
npm run dev                     # http://localhost:3000

# 3. Portal
cd ../frontend
npm install && npm run dev      # http://localhost:5173/portal.html

# 4. Tutor IA (opcional)
ollama serve                    # con los modelos qwen2.5:3b y bge-m3
cd ../backend && npm run ingest # carga los apuntes demo
```

**Cuentas demo** (contraseña `demo1234` para todas; datos sintéticos):

| Rol | Correo | Notas |
|---|---|---|
| Estudiante | `camila@demo-a.cl` | También `benjamin@`, `sofia@` y `tomas@demo-a.cl` |
| Docente | `ana.rojas@demo-a.cl` | Matemáticas. `luis.perez@demo-a.cl`: Historia |
| Administrador | `marta.soto@demo-a.cl` | Entra con el RBD `99901` |
| Apoderada | `carolina.diaz@demo-a.cl` | Apoderada de Camila |
| Otro colegio | `javiera@demo-b.cl`, `pedro.lagos@demo-b.cl` | RBD `99902`, para probar el aislamiento |

## 7. Cómo se prueba

| Qué | Comando | Qué cubre |
|---|---|---|
| Backend sin base | `cd code/backend && npm test` | Rutas, validación, RAG y utilidades con una base falsa |
| Backend con PostgreSQL | `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test` | RLS, triggers y flujos completos. Cada archivo crea y borra su propia base temporal |
| Frontend | `cd code/frontend && npm test && npm run lint && npm run build` | Lógica del portal (sesión, notas, reloj de la prueba, CSV…) |
| Contrato | `npx @stoplight/spectral-cli lint FeathersForAll/api/openapi.yaml` | Reglas del contrato (kebab-case, RFC 7807, Idempotency-Key…) |
| API de punta a punta | `npm run test:postman` (con la API corriendo) | Colección Postman: login, privacidad, seguridad, apuntes y ciclo mínimo |
| CI | `.github/workflows/ci.yml` y `security.yml` | Lo anterior, más cobertura ≥ 70 %, SAST, SCA, SBOM, secretos, IaC, firma de imágenes y DAST |

## 8. Cambiar algo sin romperlo

- **Un cambio en la API** va primero en `FeathersForAll/api/openapi.yaml`; luego se regenera el cliente TS (`FeathersForAll/packages/api-client`: `npm run generate`) y se pasa Spectral.
- **Un cambio en la base** es un archivo SQL nuevo y numerado. Se registra en `crear_bdd.sql`, `scripts/db-setup.js` y `test/pg-fixture.js`, y los permisos del rol de la API van en `permisos_app.sql`.
- **Cada consulta nueva** va en `db/queries.js` con parámetros (`$1`), nunca con texto interpolado.
- **Una decisión cara de revertir** va en un ADR nuevo, enlazado en `readme.md`.
- Commits en Conventional Commits, en español, con `AI-Assisted:` si se usó IA. Se trabaja en ramas `feat/...` con PR contra `main`.
