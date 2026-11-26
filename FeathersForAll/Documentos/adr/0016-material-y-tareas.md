# ADR 0016 · Material visible para el estudiante y tareas con hora límite, con archivos en PostgreSQL

## Estado

Propuesto — 2026-11-25

## Contexto

Había dos cosas que el portal no permitía:

- **Lo que subía el docente no lo veía el estudiante.** Los apuntes solo alimentaban al tutor IA. Además, la base guardaba únicamente el texto extraído (`apuntes_curso.contenido`) y no el archivo original.
- **No había tareas con entrega de archivos.** Existían evaluaciones de alternativas con `closes_at`, pero ninguna forma de que el docente pidiera un archivo con una hora límite y de que el sistema impidiera entregar después de esa hora.

El proyecto no tiene almacenamiento de objetos (S3 o similar). Todo dato de un colegio vive detrás del RLS por colegio y por rol.

## Decisión

1. **Los archivos se guardan en PostgreSQL (`BYTEA`)**, en la migración `10_material_y_tareas.sql`, con tres tablas:
   - `apuntes_archivos`: el original de cada apunte, con borrado en cascada junto al apunte.
   - `tareas`: la tarea, su hora límite y un archivo opcional del docente.
   - `entregas_tarea`: un archivo por estudiante y tarea, que se puede reemplazar.
2. **La hora límite la hace cumplir la base**, no solo la API. Las políticas RLS de `entregas_tarea` exigen `tarea_abierta(tarea_id)`, que compara `now()` con `fecha_limite`, y la hora de cada entrega la pone un trigger. La API además responde `409 task-closed` antes de leer el archivo.
3. **Los archivos se tratan como no confiables:**
   - Solo se aceptan extensiones de una lista cerrada, y el tipo MIME lo decide el servidor.
   - Los primeros bytes deben calzar con el formato.
   - El tope es de 10 MB por archivo (40 MB para los apuntes, igual que antes).
   - La descarga va como adjunto, con `nosniff` y `CSP sandbox`.
4. **Contrato v1.8.0 (MINOR):** solo se agregan operaciones nuevas, en la etiqueta «Contenido».

## Consecuencias

**Gana:**

- No hay que sumar otra pieza de infraestructura. Los archivos heredan el aislamiento por colegio, la privacidad por rol (el estudiante solo ve su entrega) y los respaldos de la base.
- Aunque la API tuviera un error, una entrega tardía o hecha a nombre de otro la rechaza PostgreSQL. Está probado en `contenido.pg.test.js`.

**Pierde / se vuelve más difícil:**

- La base crece con los archivos: 40 estudiantes × 10 MB son hasta 400 MB por tarea. Con uso real hay que vigilar el tamaño de los respaldos y mover los archivos a almacenamiento de objetos (S3 con URL firmada) si crece.
- La API recibe el archivo completo en memoria (tope de 10 MB), así que muchas subidas grandes a la vez consumen RAM del pod.
- Cuenta la hora en que el archivo **termina** de llegar al servidor. Con una conexión lenta, una subida que empieza 23:59 y termina 00:01 se rechaza. La interfaz lo avisa mostrando el tiempo restante.
- Los archivos no se revisan con antivirus.
- Las entregas no tienen purga automática al terminar el año, a diferencia de las conversaciones del tutor.

## Alternativas descartadas

- **Almacenamiento de objetos (S3, MinIO) con URL firmada:** escala mejor, pero suma un servicio, credenciales y otra política de acceso que mantener alineada con el RLS. Se deja para cuando el volumen lo justifique.
- **Controlar la hora límite solo en la API:** es más simple, pero va contra la regla del proyecto: la base debe impedir lo que la API podría olvidar, como en 09.
- **Multipart (`multipart/form-data`):** suma una dependencia para parsearlo. El cuerpo binario con el nombre en la URL ya lo usan los apuntes (v1.3).

## Fecha

2026-11-25
