# ADR 0015 · Login por correo, revocación de sesión y freno por IP

## Estado

Aceptado — 2026-11-24. Reemplaza parcialmente el [ADR 0007](0007-autenticacion-y-privacidad.md) (puntos 1 y 4 y la falta de revocación) y el login en dos pasos del [ADR 0004](0004-datos-y-eventos.md). Implementado en el PR #26.

## Contexto

Con el ADR 0007 el login pedía RBD, correo y contraseña. En la práctica:

- Un estudiante pertenece a un solo colegio y su cuenta ya está enlazada a él. Pedirle que escriba el RBD no aporta nada y le permite intentar con otro colegio.
- Una auditoría de seguridad de la API y de la base encontró además:
  - Una cuenta desactivada seguía operando con su JWT hasta que vencía (8 h). Solo `/v1/me` la rechazaba.
  - Cualquiera podía dejar afuera a un estudiante: 5 claves malas con su correo lo bloqueaban 15 min.
  - Sin tope por IP: se podía probar una misma clave contra todos los correos de un colegio.
  - Con sesión de estudiante, la base dejaba guardar `puntaje = 100` o una respuesta mala como correcta. La API no lo hace, pero el RLS prometía impedirlo.

## Decisión

1. **Login por correo para estudiantes y docentes.** `POST /v1/auth/login` acepta el RBD como opcional. Sin RBD, `cuentas_por_correo()` (`08_login_por_correo.sql`, `SECURITY DEFINER`) busca el correo en los colegios activos. La clave se verifica contra cada cuenta y el colegio sale de la que coincide. Si el mismo correo y la misma clave existen en dos colegios, responde `409` y pide el RBD. Administración sigue pidiendo el RBD.
2. **Revocación de sesión.** `db.withUser` revisa, al abrir cada transacción, que la cuenta siga activa, con el mismo rol y en un colegio activo. Si no, `401`.
3. **Freno en tres llaves.** IP + correo (5 fallos), IP (50) y correo (50) en 15 min. La IP real la entrega el Ingress (`TRUST_PROXY=1`).
4. **La base corrige.** `09_integridad_evaluaciones.sql`: cuando escribe un estudiante, `es_correcta` sale de la alternativa elegida y `puntaje` del porcentaje de respuestas correctas.

## Consecuencias

**Gana:**

- El estudiante entra con correo y clave, igual que en cualquier sistema.
- Desactivar una cuenta o cambiarle el rol corta su sesión en la siguiente petición.
- Un tercero ya no deja afuera al dueño de la cuenta desde otro equipo.
- Las notas se defienden en la base, no solo en la API.

**Pierde / se vuelve más difícil:**

- Una consulta extra por petición autenticada (`SESION_VIGENTE`).
- Una sala de computación sale con una sola IP: 50 fallos en 15 min la frenan entera.
- El freno sigue en memoria por pod (como en el ADR 0007).
- Mismo correo y misma clave en dos colegios obliga a usar el RBD.

## Alternativas descartadas

- **Colegio por subdominio (`colegio.feathersforall.cl`):** necesita DNS y certificados por colegio. Fuera del alcance del piloto.
- **Selector de colegio en el login:** el estudiante vería la lista de colegios y podría elegir uno que no es suyo.
- **Correo único global:** obliga a migrar cuentas y rompe el caso del docente que trabaja en dos colegios (ADR 0004).
- **Refresh tokens o lista de revocación:** más piezas y estado compartido entre pods. Revisar la cuenta en la base ya da revocación inmediata.
- **Freno en Redis:** contador compartido entre pods, pero un servicio más que operar. Queda para producción.
- **Corrección solo en la API:** no aguanta un error en un endpoint, y son notas de menores.

## Fecha

2026-11-24

## Autores

Iván (Tech Lead)
