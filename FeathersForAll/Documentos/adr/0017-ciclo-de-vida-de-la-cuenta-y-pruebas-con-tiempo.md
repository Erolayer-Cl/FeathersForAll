# ADR 0017 · Ciclo de vida de la cuenta, auditoría y pruebas con tiempo

## Estado

Propuesto — 2026-11-27. Completa el [ADR 0015](0015-login-por-correo-y-revocacion.md): agrega la revocación al cambiar la clave. Implementado en el contrato v1.12 y en las migraciones `13_gestion_usuarios.sql` y `14_correcciones_revision.sql`.

## Contexto

Al 27-11-2026, el plan por rol de `AGENTS.md` tenía tres huecos:

- **Administrador.** No podía crear cuentas, desactivarlas ni restablecer claves desde el portal: «Usuarios» solo listaba a los estudiantes que aparecían en las matrículas. Para crear un curso había que pegar el UUID del docente.
- **Contraseñas.** Nadie podía cambiar la suya. El JWT dura 8 h y no había forma de cortar las sesiones de una cuenta cuya clave se filtró.
- **Auditoría.** No se registraba quién creaba o desactivaba cuentas (R-1 del threat model).

Además, el equipo pidió revisar si se pueden hacer **pruebas por un tiempo** y luego poner nota. Solo existía un cierre común para todos (`closes_at`). Dos agentes revisaron el código y los permisos entre roles, y encontraron esto en ese flujo:

- Si el tiempo se acababa con el formulario abierto, el estudiante perdía todo lo respondido.
- El plazo se calculaba con el reloj del equipo del estudiante.
- Las notas con respuestas escritas por revisar no se marcaban como provisionales.
- Una sesión de estudiante podía leer evaluaciones en borrador directamente en la base.

## Decisión

1. **Gestión de usuarios solo para el admin del colegio** (`/v1/users`): listar, crear (la contraseña inicial la elige el admin y nunca se devuelve), editar nombre y correo, desactivar o reactivar, y restablecer la clave.
   - El **rol no se cambia**: lo impide un trigger, porque las FK compuestas y el historial de notas dependen de él.
   - El admin no puede desactivarse a sí mismo.
   - No se borra ninguna cuenta: se desactiva.
2. **Cambiar la propia clave** (`POST /v1/me/password`, cualquier rol). Pide la clave actual, con el mismo freno que el login, y entrega un token nuevo. La función `cambiar_mi_clave()` (`SECURITY DEFINER`) solo toca la fila de la sesión.
3. **Revocación por cambio de clave.** Nueva columna `usuarios.sesiones_desde`, que un trigger fija al cambiar el hash. `SESION_VIGENTE` rechaza los JWT con `iat` anterior. Se sigue sin lista de revocación ni estado compartido entre pods (igual que el ADR 0015).
4. **Bitácora** (`auditoria`). Solo admite agregar filas: nadie la edita ni la borra, ni siquiera la API. Solo la lee el admin de su colegio. Se escribe en la misma transacción que la acción y nunca guarda claves ni contenido.
5. **Pruebas con tiempo por intento.**
   - `evaluaciones.duracion_min` (de 1 a 600 minutos). El estudiante empieza con `POST /v1/assessments/{id}/attempts`, y hasta entonces no recibe las preguntas.
   - Su plazo es el inicio más la duración, sin pasar del cierre. Lo calcula y lo hace cumplir la base, que además fija la hora de inicio y la de envío en una sesión de estudiante. Se acepta una respuesta hasta 30 s después del plazo, para cubrir la red.
   - El portal muestra el reloj con la hora del servidor (`server_time`), guarda un borrador local en `sessionStorage` y **entrega solo** 5 s antes del plazo.
   - Un intento vencido se cierra con lo que tenía la próxima vez que alguien lo consulta, y queda con nota.
6. **Correcciones de la revisión:**
   - El estudiante no ve borradores en la base: nueva política RESTRICTIVE.
   - Las notas provisionales se marcan en «Mis notas», en el libro y en «estudiantes en riesgo».
   - Se corrigió la carrera de dos revisiones simultáneas de respuestas escritas.
   - El freno del login reserva el intento antes de verificar la clave.
   - Los números escritos a la chilena se comparan bien: «1.000» es mil.
   - El docente elige qué apuntes del tutor ven los estudiantes como material. Los subidos antes de v1.8 quedan ocultos.

## Consecuencias

**Gana:**

- El administrador opera el colegio desde el portal, sin tocar la base.
- Una clave filtrada se corta en la siguiente petición, sin esperar 8 h.
- Queda registro de quién hizo qué con las cuentas.
- Las pruebas con tiempo son justas: el reloj es el del servidor, lo respondido no se pierde y la base rechaza respuestas fuera de plazo aunque la API se equivoque.

**Pierde / se vuelve más difícil:**

- Dos migraciones nuevas (`13`, `14`) que hay que aplicar en las bases existentes (`npm run db:setup`).
- Cambia un código de respuesta: un estudiante que opera sobre un borrador recibe `404` en vez de `403`. Es coherente con «un borrador no existe para él», pero puede afectar a un cliente que esperaba `403`.
- Cerrar los intentos vencidos de forma perezosa convierte algunas lecturas (libro, resultados, «Mis notas») en transacciones de escritura.
- El margen de 30 s amplía levemente el plazo real.
- La contraseña inicial la elige el admin y la entrega por fuera de la plataforma. Falta un flujo de «primera entrada» que obligue a cambiarla.

## Alternativas descartadas

- **Contraseña inicial generada y devuelta por la API:** quedaría guardada en la tabla de idempotencia (24 h) y en los registros del cliente. El portal la genera en el navegador con `crypto.getRandomValues` y solo envía el hash por TLS.
- **Lista de tokens revocados (Redis):** es estado compartido y un servicio más que operar. `sesiones_desde` basta con una consulta que ya se hacía en cada transacción.
- **Temporizador solo en el portal:** se salta cambiando el reloj del equipo. Por eso el plazo vive en la base.
- **Cerrar los intentos vencidos con un CronJob:** es una pieza más que desplegar. El cierre perezoso da el mismo resultado para quien mira la nota.
- **Ocultar `alternativas.es_correcta` al estudiante con permisos por columna:** el docente y el estudiante usan el mismo rol de base de datos. Sigue siendo defensa en profundidad pendiente; la API nunca la entrega.

## Fecha

2026-11-27

## Autores

Ignacio (DevSecOps), con asistencia de IA. Pendiente de revisión del equipo.
