# ADR 0018 · Panel del apoderado y respuesta correcta secreta en la base

## Estado

Propuesto — 2026-11-27. Cumple el punto 5 del MVP («Panel del apoderado con seguimiento de avance», `readme.md`), que el backlog había dejado para después. Implementado en el contrato v1.12 y en las migraciones `15_rol_apoderado.sql`, `16_apoderado.sql` y `17_secreto_respuestas.sql`.

## Contexto

- El MVP comprometía un panel para el apoderado, y no existía ni el rol.
- Son datos de menores: el apoderado debe ver el avance de SU pupilo y nada más. No debe ver las respuestas del pupilo, sus conversaciones con el tutor, los apuntes ni a otros estudiantes.
- Las políticas de lectura de `04` están pensadas para estudiante, docente y admin. Abrirlas a un cuarto rol arriesga filtrar datos si una política futura olvida el caso.
- La revisión del 27-11-2026 confirmó otra brecha: una sesión de la API podía leer `alternativas.es_correcta` y `preguntas.respuestas_aceptadas`. La API nunca se las entregaba al estudiante, pero el RLS no lo impedía.

## Decisión

1. **Rol `apoderado`** (`15`), en un archivo aparte porque PostgreSQL no deja usar un valor nuevo de un enum en la misma transacción. Entra con su correo, igual que estudiantes y docentes (`cuentas_por_correo`).
2. **Vínculo `apoderados_estudiantes`** (`16`): lo crea y lo quita SOLO el admin del colegio (`POST`/`DELETE /v1/users/{id}/wards`, que quedan en la bitácora). Las FK compuestas exigen que ambos sean del mismo colegio y de los roles correctos.
3. **El apoderado no ve ninguna tabla académica.** Una política RESTRICTIVE `sin_apoderado` se suma a toda tabla con `colegio_id`, salvo `usuarios` (solo su fila), sus vínculos, la bitácora y la idempotencia. Así, aunque una política futura olvide el caso, el apoderado sigue sin ver nada.
4. **Lo único que lee** sale de funciones `SECURITY DEFINER` limitadas a sus pupilos activos y vinculados en el colegio de la sesión (`mis_pupilos`, `ramos_pupilo`, `notas_pupilo`, `pendientes_pupilo`), y la API lo entrega en `GET /v1/me/wards`. Solo trae resultados (nota, promedio, pendientes y si la nota es provisional), nunca respuestas ni retroalimentación.
5. **Respuesta correcta secreta** (`17`): el rol de la API pierde el SELECT de `alternativas.es_correcta` y `preguntas.respuestas_aceptadas`. El trigger de corrección pasa a `SECURITY DEFINER` y solo corre al responder. El docente del curso y el admin las leen con `alternativas_staff()` y `aceptadas_staff()`, que exigen `puede_gestionar_evaluacion()`.
6. **Quien nunca abrió una evaluación que ya cerró** no recibe una nota automática. Queda «sin rendir», como hasta ahora, y el docente decide: puede aplicar otra instancia o una nota en el libro, según su reglamento de evaluación. El Decreto 67/2018 deja esa decisión al reglamento de cada colegio, no al sistema. El apoderado lo ve como «por rendir» mientras la evaluación está abierta.
7. **«Otro docente del mismo colegio»** se mantiene como está documentado en `permisos.md`:
   - **403** en evaluaciones y notas: el recurso se ubica por la evaluación, que el RLS le deja ver, y su rol no lo autoriza.
   - **404** en tareas y material: el RLS de `10` no le muestra el curso.

   Las dos respuestas cumplen la regla («del colegio, pero sin permiso» o «no participas») y ninguna revela datos de otro curso.

## Consecuencias

**Gana:**

- El MVP completo: el apoderado sigue el avance sin pedirlo por correo al colegio.
- Mínimo privilegio verificable: con sesión de apoderado, la base devuelve 0 filas en cursos, matrículas, intentos, respuestas, conversaciones y apuntes (`test/apoderado.pg.test.js`).
- La respuesta correcta ya no depende de que la API no se equivoque: un `SELECT es_correcta` falla con `42501` para cualquier sesión (`test/privacidad.pg.test.js`).

**Pierde / se vuelve más difícil:**

- Tres migraciones más (`15`, `16` y `17`).
- Una consulta que necesite la alternativa correcta tiene que pasar por las funciones del personal.
- El apoderado no ve a sus pupilos hasta que el admin crea el vínculo (no hay autoservicio).
- Un apoderado con pupilos en dos colegios necesita una cuenta en cada uno (igual que un docente en dos colegios, ADR 0015).

## Alternativas descartadas

- **Abrir `puede_ver_curso()` y `puede_ver_estudiante()` al apoderado:** le daría acceso a todo lo que esas funciones protegen (respuestas, consultas al tutor), salvo que cada política lo excluyera a mano.
- **Que el estudiante comparta su sesión con el apoderado:** expone la clave del menor y sus conversaciones con el tutor.
- **Contexto consumidor del evento `intento.corregido`** (lo previsto en `data/bounded-contexts.md`): no hay worker ni cola que lo procese (ADR 0013), y el panel solo necesita leer el estado actual. Queda para los avisos por correo al apoderado.
- **Un rol de base de datos distinto para el estudiante (para ocultar columnas):** es la solución más fuerte, pero duplica el pool de conexiones y la configuración; el permiso por columna más las funciones logran lo mismo para este caso.

## Fecha

2026-11-27

## Autores

Ignacio (DevSecOps), con asistencia de IA. Pendiente de revisión del equipo y del PO (Juan).
