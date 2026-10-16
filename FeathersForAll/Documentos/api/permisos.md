# Matriz de permisos — API v1.1.0 (etapa 1, rol estudiante)

Quién puede hacer qué en la API, y qué hace la base de datos si la API se equivocara. Cada fila está probada:
- en el backend (`code/backend/test/*.pg.test.js`);
- en Postman (`code/backend/requests/postman/`), cuyo Runner muestra la matriz en verde.

Decisión de diseño: [ADR 0007](../adr/0007-autenticacion-y-privacidad.md).

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

## Tutor IA (RAG multi-tenant)

| Acción | Estudiante matriculado | Docente del curso | Admin | Otro colegio |
|---|---|---|---|---|
| `POST /v1/dev/chat` con `course_id` | 200, respuesta solo con los apuntes de **ese curso** | 200 | 200 | **404** |
| Indicador `tutor_available` del ramo | visible | visible | visible | — |

Cada colegio tiene sus propios apuntes. Una pregunta en el curso del colegio B nunca recibe fragmentos del colegio A: se ve en `test/rag.pg.test.js` y en la carpeta 6 de Postman.

## Segunda línea: lo que aplica la base de datos

Esto vale aunque la API tuviera un error. Lo implementan `01` + `02` + `04` + `permisos_app.sql`.

| Capa | Regla |
|---|---|
| Colegio (RLS de `01`) | Sin `app.colegio_id` no se ve ninguna fila; con él, solo las de ese colegio |
| Escritura por rol (`02` §9) | Solo el docente del curso o el admin escriben evaluaciones, apuntes y matrículas; el estudiante no puede cambiar exigencias, ponderaciones ni intentos entregados |
| Lectura por usuario (`04`) | El estudiante ve solo sus matrículas, intentos, notas, respuestas y consultas; el docente, solo las de sus cursos; sin `app.rol`, nada |
| Usuarios (`04`) | El estudiante ve su fila y al personal, no a otros estudiantes |
| Contraseñas (`permisos_app.sql`) | La API no puede leer `password_hash` (permiso por columna); solo existe `credenciales_login()` |
