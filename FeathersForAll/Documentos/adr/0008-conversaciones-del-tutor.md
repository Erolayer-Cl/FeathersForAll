# ADR 0008 · Conversaciones del tutor IA guardadas y privadas del estudiante

## Estado

Propuesto — 2026-10-19. Pendiente de ratificar en la reunión del equipo.

## Contexto

El Tutor IA del portal (`est-tutor`) guardaba la conversación solo en la memoria de la pestaña: al recargar o cambiar de equipo, el estudiante perdía todo. Además, el cliente enviaba la conversación completa en cada turno a `POST /v1/dev/chat`, una ruta de desarrollo fuera del contrato.

Se pidió que las conversaciones se guarden, para que el estudiante pueda retomarlas.

**Fuerzas en juego:**
- Son textos escritos por menores de edad. Pueden contener dudas, inseguridades o datos que el estudiante no debería haber escrito.
- Los computadores de los colegios suelen ser compartidos.
- La base ya tiene `consultas_tutor_ia`, pensada para el tutor **asíncrono** del contrato S05 (`tutor-questions`): preguntas sueltas con estados `en_cola` / `respondida` / `fallida`, que responde un worker. Su política de lectura deja ver las consultas al docente del curso y al admin.
- La respuesta del tutor llega en streaming (se escribe mientras el LLM genera).

## Decisión

Las conversaciones se guardan **en PostgreSQL**, en tablas nuevas (`conversaciones_tutor` y `mensajes_tutor`, script `db/05_conversaciones_tutor.sql`). Solo las ve, escribe y borra **el propio estudiante**, y se conservan **hasta fin del año escolar**.

1. **Privacidad (RLS):** además del aislamiento por colegio, una política `RESTRICTIVE` exige `app_rol() = 'estudiante' AND estudiante_id = app_usuario_id()` para leer, crear, actualizar y borrar. El docente y el admin no las ven: la API les responde `403` y, aunque se equivocara, la base les devuelve 0 filas. Crear exige además matrícula activa (`puede_ver_curso`) y una FK a `matriculas`.
2. **Retención:** `purgar_conversaciones_tutor()` borra las conversaciones sin actividad desde antes del 1 de enero del año en curso (hora de Chile; el año escolar chileno calza con el calendario). La corre un job (`npm run tutor:purgar`, por ejemplo un CronJob cada 1 de enero o a diario, ya que es idempotente). Es `SECURITY DEFINER` y el usuario de la API no puede ejecutarla.
3. **Contrato v1.2.0:**
   - `GET /courses/{courseId}/tutor-conversations`: mis conversaciones del curso.
   - `GET /tutor-conversations/{id}`: una conversación con sus mensajes.
   - `DELETE /tutor-conversations/{id}`: borrarla.
   - `POST /courses/{courseId}/tutor-conversations/{id}/messages`: envía una pregunta y responde en streaming.
4. **El servidor tiene el historial:** el cliente envía solo la pregunta nueva y el servidor arma el contexto con los mensajes guardados.
5. **El cliente genera el id de la conversación (UUID):** el primer mensaje la crea. La pregunta y la respuesta se guardan juntas solo cuando la respuesta terminó. Si el LLM falla o el estudiante corta, no se guarda nada y no quedan conversaciones vacías. Por eso este POST no usa `Idempotency-Key` (excepción a la política del contrato): reintentar un turno fallido no duplica nada.

## Consecuencias

**Gana:**

- El estudiante retoma sus conversaciones en cualquier dispositivo, y el modo "Practicar una prueba" sobrevive a una recarga.
- La privacidad la exige la base, no solo la API, igual que el resto de los datos de menores (ADR 0007).
- El historial que ve el LLM lo arma el servidor: el cliente ya no puede inyectar turnos falsos del "assistant".
- La ruta del portal queda dentro del contrato. `/v1/dev/chat` sigue solo para desarrollo y para el docente.

**Pierde / se vuelve más difícil:**

- Se guardan textos de menores: hay que operar el job de retención y, en producción, el dueño de la función debe ser `feathersforall_plataforma`.
- El docente no puede ver qué preguntan sus estudiantes. Si se quisiera, haría falta un ADR nuevo con estadísticas agregadas y anónimas, no las conversaciones.
- Si guardar falla después de mostrar la respuesta, el estudiante la vio pero no queda en el historial (se registra un aviso sin contenido en el log).
- Dos tablas y un flujo más que mantener junto a `consultas_tutor_ia`.

## Alternativas descartadas

- **Guardar en el navegador (localStorage):** no sirve para cambiar de equipo y deja las conversaciones de un menor en computadores compartidos del colegio.
- **Reusar `consultas_tutor_ia`:** modela preguntas sueltas asíncronas con estados y worker, no conversaciones, y su política de lectura incluye al docente y al admin.
- **Que el docente también lea las conversaciones:** se prefirió que el estudiante pregunte sin sentirse observado.
- **Crear la conversación con un POST previo (con `Idempotency-Key`):** agrega un viaje de red y deja conversaciones vacías cuando el primer turno falla.
- **Retención fija de 90 días:** cortaría conversaciones útiles en medio del semestre.

## Fecha

2026-10-19

## Autores

Ignacio (DevSecOps), con asistencia de IA (Claude Code).

> Regla del taller: un ADR nunca se edita una vez aceptado. Si cambia la decisión, se marca como "Reemplazado" y se crea uno nuevo. Un archivo por ADR en `Documentos/adr/`, numerados: `NNNN-titulo-corto.md`.
