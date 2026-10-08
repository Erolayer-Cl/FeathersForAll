# Cambios en `01_schema.sql`

Revisión del esquema base de FeathersForAll. El objetivo principal: que la **base de datos** garantice el aislamiento entre colegios y la integridad de las evaluaciones, en vez de depender de que la API nunca se equivoque.

Todas las reglas están verificadas en `99_test_schema.sql` (28 pruebas, PostgreSQL 16 + pgvector):

```bash
psql -v ON_ERROR_STOP=1 -f 01_schema.sql -f 99_test_schema.sql
```

> Ajustes posteriores de S06 (tutor asíncrono, periodo del curso, retroalimentación por pregunta, outbox, idempotencia y búsqueda del colegio para el login): ver `02_s06_ajustes.sql` y sus pruebas en `98_test_s06_ajustes.sql`.

---

## 🔴 Seguridad: aislamiento entre colegios

| # | Cambio | Problema que resuelve |
|---|--------|----------------------|
| 1 | `colegio_id` agregado a **todas** las tablas de un colegio (`matriculas`, `evaluaciones`, `preguntas`, `alternativas`, `intentos_evaluacion`, `respuestas_estudiante`, `apuntes_curso`, `apuntes_embeddings`, `consultas_tutor_ia`) | Antes solo `usuarios` y `cursos` lo tenían, y era imposible escribir políticas RLS simples. |
| 2 | **FKs compuestas** `(x_id, colegio_id) → padre(id, colegio_id)` | Un curso del colegio A podía tener un docente del colegio B; un estudiante de B podía matricularse en un curso de A. |
| 3 | **Rol validado en la FK** mediante columnas generadas (`cursos.docente_rol`, `matriculas.estudiante_rol`) | Un estudiante podía quedar como docente de un curso, y un docente podía ser matriculado como estudiante. Además ya no se puede cambiar el rol de un docente que tiene cursos asignados. |
| 4 | `intentos_evaluacion` y `consultas_tutor_ia` referencian `matriculas(curso_id, estudiante_id)` | Un estudiante podía rendir evaluaciones o consultar al tutor IA en un curso donde no está matriculado. |
| 5 | **Row Level Security** con `ENABLE` + `FORCE` en todas las tablas, filtrando por `app_colegio_id()` | El aislamiento dependía de que cada query llevara su `WHERE colegio_id = ...`. Ahora Postgres lo aplica siempre. |
| 6 | RLS **fail-closed**: sin `app.colegio_id` en la sesión no se ve ninguna fila | Si la API olvida setear el colegio, el resultado es vacío en vez de exponer todo. |
| 7 | `apuntes_embeddings` tiene `curso_id` y `colegio_id`, amarrados al apunte por FK | El RAG podía devolver chunks de otro curso u otro colegio al tutor IA. |
| 8 | Vista `alternativas_publicas` (sin `es_correcta`, con `security_invoker = true`) | Un endpoint que devolviera las alternativas tal cual le entregaba las respuestas correctas al estudiante. |
| 9 | Bloque de referencia con roles de BD: `feathersforall_app` (sin BYPASSRLS) y `feathersforall_plataforma` (BYPASSRLS, para el master) | Separa la API normal de las operaciones de plataforma. |

## 🟠 Integridad de evaluaciones

| # | Cambio | Problema que resuelve |
|---|--------|----------------------|
| 10 | FK `(alternativa_elegida_id, pregunta_id) → alternativas(id, pregunta_id)` | Una respuesta podía apuntar a una alternativa de otra pregunta. |
| 11 | `respuestas_estudiante.evaluacion_id` + FKs hacia el intento y la pregunta con esa misma evaluación | Una respuesta podía ser a una pregunta de otra evaluación distinta a la del intento. |
| 12 | Índice único parcial: máximo una alternativa correcta por pregunta | Las respuestas guardan una sola alternativa, así que dos correctas no tenían sentido. |
| 13 | `UNIQUE (evaluacion_id, orden)` en `preguntas`, `DEFERRABLE` | Dos preguntas podían tener el mismo número. Al ser diferible, se pueden reordenar dentro de una transacción. |
| 14 | `respuestas_estudiante.es_correcta` documentado como **corrección congelada** | Se mantiene a propósito; recorregir debe ser una acción explícita. |
| 15 | Nuevos `CHECK`: `fecha_envio >= fecha_inicio`, puntaje entre 0 y 100, puntaje solo si hay envío, `fecha_publicacion` obligatoria si no es borrador, `fecha_cierre > fecha_publicacion`, pregunta sin responder no puede ser correcta, `orden > 0` | Datos imposibles que antes se aceptaban. |
| 16 | Nueva columna `evaluaciones.fecha_cierre` | No había forma de rechazar envíos tardíos. |

## 🟡 Diseño y rendimiento

| # | Cambio | Problema que resuelve |
|---|--------|----------------------|
| 17 | `embedding TEXT` → `vector(768)` (pgvector) + índice **HNSW** con `vector_cosine_ops` | La búsqueda por similitud no se podía hacer dentro de la base. 768 = dimensión de `nomic-embed-text` (Ollama). |
| 18 | `apuntes_embeddings.chunk_indice` + `UNIQUE (apunte_id, chunk_indice)` | Orden de los chunks y evitar duplicados al re-indexar. |
| 19 | Índices en todas las FKs que no estaban cubiertas | Postgres no los crea solo; los JOIN y las verificaciones de FK recorrían la tabla completa. |
| 20 | `ON DELETE CASCADE` → `RESTRICT` entre entidades independientes; `CASCADE` solo en composición (pregunta → alternativas, intento → respuestas, apunte → embeddings) | Un `DELETE FROM colegios` borraba todo el historial académico, y borrar un estudiante funcionaba o fallaba según la tabla. Se usa soft delete (`activo`). |
| 21 | `activo` agregado a `cursos` y `matriculas` | Necesario para el soft delete al pasar a `RESTRICT`. |
| 22 | `email` → `CITEXT` | `Juan@x.cl` y `juan@x.cl` contaban como usuarios distintos. |

## ⚪ Menores

| # | Cambio |
|---|--------|
| 23 | `colegios.rbd` ahora es `UNIQUE`. |
| 24 | `updated_at` en las tablas editables, mantenido por el trigger `set_updated_at()`. |
| 25 | `uuid-ossp` / `uuid_generate_v4()` → `gen_random_uuid()` nativo (PG13+). |
| 26 | Índice en `consultas_tutor_ia(created_at)` y nota sobre política de retención (datos de menores de edad). |
| 27 | Constraints con nombre explícito (`fk_...`, `uq_...`, `chk_...`) para que los errores sean legibles en la API. |

---

## ⚠️ Lo que cambia para el backend

1. **Cada request debe setear el colegio dentro de una transacción:**
   ```sql
   BEGIN;
   SET LOCAL app.colegio_id = '<uuid>';
   -- queries
   COMMIT;
   ```
   Tiene que ser `SET LOCAL`: con pool de conexiones, un `SET` normal queda pegado a la conexión y lo hereda el siguiente request.
2. **La API no puede conectarse como superusuario ni con BYPASSRLS**, porque esos roles saltan el RLS. Debe usar `feathersforall_app`.
3. **El login del master** va por `feathersforall_plataforma`, porque los usuarios master (sin colegio) son invisibles para el rol de la app.
4. **Los inserts llevan más columnas** (`colegio_id`, y en algunos casos `curso_id` o `evaluacion_id`). Si el backend manda un valor inconsistente, la base lo rechaza.
5. **A los estudiantes se les sirven las alternativas desde `alternativas_publicas`**, nunca desde `alternativas`.
6. **Validar en la API al publicar una evaluación** que cada pregunta tenga al menos una alternativa correcta (la base solo garantiza "como máximo una").

## Decisiones a confirmar con el equipo

- Dimensión `vector(768)`: depende del modelo de embeddings que usen.
- Escala de puntaje 0–100: ajustar si usan 1.0–7.0.
- Plazo de retención de `consultas_tutor_ia`.
