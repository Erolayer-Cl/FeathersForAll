# Matriz de permisos — API v1.12.0

Quién puede hacer qué en la API, y qué hace la base de datos si la API se equivocara. Cada fila está probada:
- en el backend (`code/backend/test/*.pg.test.js`);
- en Postman (`code/backend/requests/postman/`), cuyo Runner muestra la matriz en verde.

Decisión de diseño: [ADR 0007](../adr/0007-autenticacion-y-privacidad.md); conversaciones del tutor: [ADR 0008](../adr/0008-conversaciones-del-tutor.md).

## Reglas generales

| Situación | Respuesta |
|---|---|
| Sin token, o con un token inválido, vencido o con `alg: none` | **401** |
| El recurso es de **otro colegio**, o es un curso en el que **no participas** | **404**: no se revela que existe |
| El recurso es de tu colegio, pero **tu rol no permite** la acción | **403** |
| Login con cualquier dato incorrecto (RBD, correo o contraseña) | **401**, siempre el mismo mensaje |
| 5 logins fallidos de una misma cuenta en 15 minutos | **429** con `Retry-After` |

## Actores

Los actores son los usuarios demo de `db/90_seed_demo.sql`. La contraseña de todos es `demo1234`.

| Actor | Ejemplo | Colegio (RBD) |
|---|---|---|
| Estudiante matriculado | Camila (Matemáticas e Historia) | A (99901) |
| Otro estudiante del colegio | Sofía | A |
| Docente del curso | Ana (Matemáticas) | A |
| Docente de otro curso | Luis (Historia) | A |
| Admin del colegio | Marta | A |
| Usuario de otro colegio | Javiera (estudiante) / Pedro (docente) | B (99902) |

## Endpoints de la etapa 1

| Endpoint | Estudiante (lo suyo) | Otro estudiante | Docente del curso | Otro docente | Admin | Otro colegio |
|---|---|---|---|---|---|---|
| `POST /v1/auth/login` | 200 (pública) | — | 200 | 200 | 200 | 401 con el RBD de A |
| `GET /v1/me` | 200, su perfil | — | 200 | 200 | 200 | 200, su perfil |
| `GET /v1/courses` | **sus asignaturas** | — | **sus clases** + `students_count` | sus clases | todo el colegio | solo los de su colegio |
| `GET /v1/courses/{id}` | 200 si está matriculado | 404 si no está matriculado | 200 | 404 | 200 | 404 |
| `GET /v1/me/grades` | **sus ramos y notas** | — | 403 | 403 | 403 | sus propios ramos |
| `GET /v1/me/grades/{assessmentId}` | 200 si la entregó (404 si no) | — | 403 | 403 | 403 | 404 |

## Endpoints de notas del docente (ya existían)

Se documentan aquí por el permiso del estudiante, que **solo lee**.

| Endpoint | Estudiante | Docente del curso | Otro docente | Admin | Otro colegio |
|---|---|---|---|---|---|
| `GET /v1/courses/{id}/gradebook` | **403** | 200 | 403 | 200 | 404 |
| `GET /v1/courses/{id}/grades/summary` | **403** | 200 | 403 | 200 | 404 |
| `GET /v1/courses/{id}/students/{studentId}/grades` | 200 solo para sí mismo; **403** con las de otro | 200 | 403 | 200 | 404 |
| `GET /v1/assessments/{id}/results` | **403** | 200 | 403 | 200 | 404 |
| `PATCH /v1/assessments/{id}/grading` | **403** (solo ver) | 200 | 403 | 200 | 404 |

## Ciclo mínimo: cursos, matrículas y evaluaciones (v1.4)

Las rutas solo del personal (matricular, crear, publicar) dan **403** a cualquier estudiante del colegio; las que un estudiante usa (ver y rendir) dan **404** si no está matriculado.

Probado en `test/ciclo.pg.test.js` (PostgreSQL real), `test/evaluaciones.routes.test.js` (unitarias) y en la carpeta 10 de Postman. Todos los `POST` exigen `Idempotency-Key`.

| Endpoint | Estudiante matriculado | Otro estudiante | Docente del curso | Otro docente | Admin | Otro colegio |
|---|---|---|---|---|---|---|
| `POST /v1/courses` | **403** | **403** | 201, a su nombre (a nombre de otro: **403**) | 201, a su nombre | 201, indicando `teacher_id` | solo en su colegio |
| `POST /v1/courses/{id}/enrollments` | **403** | **403** | 201 (409 si ya está; 404 si el correo no es de un estudiante del colegio) | **403** | 201 | **404** |
| `GET /v1/courses/{id}/enrollments` | **403** | **403** | 200 | **403** | 200 | **404** |
| `POST /v1/courses/{id}/assessments` | **403** | **403** | 201 (borrador) | **403** | 201 | **404** |
| `GET /v1/courses/{id}/assessments` | 200: solo publicadas y cerradas, con su nota | 404 | 200: todas, con borradores | **403** | 200 | **404** |
| `GET /v1/assessments/{id}` | 200 si está publicada o cerrada, **sin** la alternativa correcta ni la retroalimentación; un borrador da 404 | 404 | 200, con la alternativa correcta | **403** | 200 | **404** |
| `PATCH /v1/assessments/{id}` | **403** | **403** | 200 (422 si falta una alternativa correcta; 409 si el estado no lo permite) | **403** | 200 | **404** |
| `POST /v1/assessments/{id}/submissions` | 201 con puntaje, nota y retroalimentación (409 si ya la rindió o está cerrada) | 404 | **403** | **403** | **403** | **404** |

Segunda línea en la base: solo el docente del curso o el admin escriben cursos propios, matrículas y evaluaciones (`02` §9); el estudiante abre y envía solo sus intentos, y la corrección queda congelada al responder.

## Gestión de usuarios, contraseñas y bitácora (v1.12, ADR 0017)

Probado en `test/usuarios.pg.test.js` (PostgreSQL real). El rol de una cuenta no se cambia (trigger de `13`); ninguna cuenta se borra, se desactiva.

| Endpoint | Estudiante | Docente | Admin del colegio | Otro colegio |
|---|---|---|---|---|
| `GET /v1/users` | **403** | **403** | 200, solo su colegio (sin `password_hash`) | — |
| `POST /v1/users` | **403** | **403** | 201 (409 si el correo ya existe en el colegio) | el mismo correo puede existir en otro colegio |
| `GET /v1/users/{id}` | **403** | **403** | 200, con sus cursos | **404** |
| `PATCH /v1/users/{id}` | **403** | **403** | 200 (400 si intenta cambiar el rol; 409 si se desactiva a sí mismo o el correo ya existe) | **404** |
| `PUT /v1/users/{id}/password` | **403** | **403** | 204, y corta las sesiones de la cuenta (409 para su propia cuenta) | **404** |
| `POST /v1/me/password` | 200 con token nuevo; los anteriores dan 401 (422 si la actual no calza; 429 tras varios fallos) | igual | igual | — |
| `GET /v1/audit-log` | **403** | **403** | 200, solo su colegio | — |

Desactivar una cuenta o restablecer su clave la deja sin acceso en la **siguiente petición** (`SESION_VIGENTE` en `db.withUser`).

## Panel del apoderado (MVP 5, ADR 0018)

Probado en `test/apoderado.pg.test.js`. El apoderado solo lee, y solo a los pupilos que el admin le vinculó.

| Endpoint | Apoderado (sus pupilos) | Estudiante | Docente | Admin | Otro colegio |
|---|---|---|---|---|---|
| `GET /v1/me/wards` | 200: ramos, promedio, notas y pendientes de sus pupilos activos; sin respuestas ni retroalimentación | **403** | **403** | **403** | 401 (no hay cuenta vigente con ese token) |
| `POST /v1/users/{id}/wards` | **403** | **403** | **403** | 201 (404 si el correo no es de un estudiante del colegio; 409 si ya está vinculado o la cuenta no es de apoderado) | **404** |
| `DELETE /v1/users/{id}/wards/{studentId}` | **403** | **403** | **403** | 204 (404 si no estaba vinculado) | **404** |
| Resto de la API (`/v1/courses`, `/v1/me/grades`, libro, tareas…) | lista vacía, 403 o 404: la base no le muestra datos académicos | | | | |

## Pruebas con tiempo y notas provisionales (v1.12)

Probado en `test/revision-v112.pg.test.js`.

| Endpoint | Estudiante matriculado | Otro estudiante | Docente del curso | Admin | Otro colegio |
|---|---|---|---|---|---|
| `POST /v1/assessments/{id}/attempts` | 201 (empieza) o 200 (retoma, sin reiniciar el reloj); 409 si ya entregó, está cerrada o venció | 404 | **403** | **403** | **404** |
| `GET /v1/assessments/{id}` con `duration_minutes` | sin preguntas hasta empezar; después, con `attempt.deadline` y `server_time` | 404 | completa | completa | **404** |
| `POST /v1/assessments/{id}/submissions` con tiempo | 201 dentro del plazo (+30 s); 409 `attempt-not-started` o `attempt-expired` | 404 | **403** | **403** | **404** |
| Cualquier operación sobre un **borrador** | **404** (antes 403: para el estudiante no existe) | 404 | según la tabla anterior | | **404** |

En la base (`14`): una sesión de estudiante no ve borradores ni sus preguntas o alternativas. La hora de inicio y la de envío las pone la base, y una respuesta fuera de plazo se rechaza con `55000`, que la API traduce a `409`.

## Material del curso y apuntes del tutor (v1.8 y v1.12)

| Endpoint | Estudiante matriculado | Docente del curso | Admin | Otro docente | Otro colegio |
|---|---|---|---|---|---|
| `GET /v1/courses/{id}/materials` | 200, **solo los apuntes visibles** | 200, todos, con `visible_to_students` | 200, todos | **404** | **404** |
| `PATCH /v1/courses/{id}/documents/{nombre}` | **403** | 200 | 200 | **404** | **404** |

## Tutor IA (RAG multi-tenant)

| Acción | Estudiante matriculado | Docente del curso | Admin | Otro colegio |
|---|---|---|---|---|
| `POST /v1/dev/chat` con `course_id` | 200, respuesta solo con los apuntes de **ese curso** | 200 | 200 | **404** |
| Indicador `tutor_available` del ramo | visible | visible | visible | — |

### Conversaciones guardadas del tutor (v1.2, ADR 0008)

Son **privadas del estudiante**: ni el docente ni el admin las leen. Se borran al terminar el año escolar.

| Endpoint | Estudiante (lo suyo) | Otro estudiante | Docente del curso | Admin | Otro colegio |
|---|---|---|---|---|---|
| `GET /v1/courses/{id}/tutor-conversations` | 200, **sus** conversaciones del curso | 200, solo las suyas (no ve las ajenas) | **403** | **403** | 404 |
| `GET /v1/tutor-conversations/{id}` | 200 | **404** | **403** | **403** | 404 |
| `DELETE /v1/tutor-conversations/{id}` | 204 | **404** | **403** | **403** | 404 |
| `POST /v1/courses/{id}/tutor-conversations/{convId}/messages` | 200 (streaming) si está matriculado | con un id ajeno no agrega nada a esa conversación | **403** | **403** | 404 |

Probado en `test/conversaciones.pg.test.js`.

Cada colegio tiene sus propios apuntes. Una pregunta en el curso del colegio B nunca recibe fragmentos del colegio A: se ve en `test/rag.pg.test.js` y en la carpeta 6 de Postman.

## Segunda línea: lo que aplica la base de datos

Esto vale aunque la API tuviera un error. Lo implementan `01` + `02` + `04` + `05` + `permisos_app.sql`.

| Capa | Regla |
|---|---|
| Colegio (RLS de `01`) | Sin `app.colegio_id` no se ve ninguna fila; con él, solo las de ese colegio |
| Escritura por rol (`02` §9) | Solo el docente del curso o el admin escriben evaluaciones, apuntes y matrículas; el estudiante no puede cambiar exigencias, ponderaciones ni intentos entregados |
| Lectura por usuario (`04`) | El estudiante ve solo sus matrículas, intentos, notas, respuestas y consultas; el docente, solo las de sus cursos; sin `app.rol`, nada |
| Conversaciones del tutor (`05`) | Solo el estudiante dueño lee, crea y borra sus conversaciones y mensajes; docente y admin no ven nada. La purga anual (`purgar_conversaciones_tutor()`) no la puede ejecutar la API |
| Usuarios (`04`) | El estudiante ve su fila y al personal, no a otros estudiantes |
| Contraseñas (`permisos_app.sql`) | La API no puede leer `password_hash` (permiso por columna); solo existe `credenciales_login()` |
| Usuarios (`02` §9 y `13`) | Solo el admin crea o edita cuentas; nadie cambia el rol ni el colegio de una cuenta desde la API; cada uno cambia su clave solo con `cambiar_mi_clave()` |
| Sesiones (`13`) | Un JWT emitido antes del último cambio de clave (`sesiones_desde`) deja de valer |
| Auditoría (`13`) | Solo se agrega; la API no puede editarla ni borrarla; la lee solo el admin |
| Borradores y plazos (`14`) | El estudiante no ve borradores; el plazo de su intento lo hace cumplir la base |
| Apoderado (`16`) | Política `sin_apoderado` en toda tabla con `colegio_id` (salvo su fila de usuarios y sus vínculos); lee solo por funciones limitadas a sus pupilos |
| Respuesta correcta (`17`) | Ninguna sesión de la API lee `alternativas.es_correcta` ni `preguntas.respuestas_aceptadas` (permiso por columna); el personal del curso usa `alternativas_staff()` y `aceptadas_staff()` |
