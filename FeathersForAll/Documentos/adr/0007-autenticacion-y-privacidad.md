# ADR 0007 · Autenticación propia por RBD y privacidad de lectura por usuario

## Estado

Propuesto — 2026-10-16. Etapa 1 (rol estudiante). Pendiente de ratificar en la reunión del equipo.

## Contexto

Hasta la S07 no existía el login:
- Los usuarios demo tenían `password_hash = '!sso'`, un marcador que no valida ninguna contraseña, y los JWT salían de `npm run dev:token`.
- El contrato S05 asumía un SSO institucional que todavía no existe.

Para que cada estudiante vea **sus** asignaturas y **sus** notas en el portal, hace falta:
- un login real;
- que la plataforma pueda demostrar, también en Postman, quién puede ver qué.

Al revisar la base aparecieron dos problemas:
- **Las lecturas no estaban restringidas por rol.** El RLS de `01` aísla por colegio y el de `02` §9 limita las escrituras. Pero dentro de un colegio, cualquier sesión podía leer las notas, respuestas y consultas al tutor de todos los estudiantes, e incluso `password_hash`. Con datos de menores, eso no puede depender solo de que la API no se equivoque.
- **El login habría fallado igual:** `colegio_por_rbd()` tenía el `GRANT EXECUTE` solo en un comentario.

**Fuerzas en juego:**
- Datos de menores: mínimo de datos personales en tokens y logs.
- Multi-tenancy real: el mismo correo puede existir en dos colegios.
- Sin dependencias nuevas, ya que el monolito solo usa express, pg y pino.
- La API corre con varias réplicas (HPA, S07).

## Decisión

1. **Login propio en dos pasos:** `POST /v1/auth/login` con `{ rbd, email, password }`.
   - El RBD identifica al colegio con `colegio_por_rbd()`.
   - Dentro de ese colegio, `credenciales_login(email)` devuelve el hash. Es `SECURITY DEFINER` y filtra por `app_colegio_id()`.
   - Cualquier fallo responde el mismo `401`.
   - Aunque la cuenta no exista, igual se calcula un hash, para que el tiempo de respuesta no revele qué correos existen.
2. **Contraseñas con scrypt de `node:crypto`:** N=2¹⁴, r=8, p=5, que es el mínimo equivalente de OWASP.
   - Sal de 16 bytes y comparación con `timingSafeEqual`.
   - El formato `scrypt$N$r$p$sal$clave` guarda los parámetros, así que se pueden subir más adelante sin invalidar las claves.
3. **JWT HS256 mínimo:** solo `sub`, `tenant_id` y `role`; nombres y correos no van en el token.
   - Duración: 8 h (`JWT_TTL_SECONDS`).
   - El perfil se pide aparte en `GET /v1/me`.
4. **Freno de fuerza bruta:** 5 fallos por (RBD, correo) cada 15 minutos; al pasarse responde `429` con `Retry-After`. Es en memoria y por proceso.
5. **Privacidad de lectura en la base** (`04_privacidad_login.sql`):
   - **Regla de lectura de cursos:** `puede_ver_curso()`. La usan tanto la API como el tutor.
   - **Regla de datos de estudiantes:** `puede_ver_estudiante()`.
   - **Políticas `RESTRICTIVE FOR SELECT`** en matrículas, intentos (y por lo tanto la vista `notas`), respuestas, consultas al tutor, fuentes y usuarios. Fallan cerradas:
     - el estudiante solo ve lo suyo;
     - el docente, solo sus cursos;
     - el admin, su colegio;
     - una sesión sin rol, nada.
6. **El hash no es legible para la API** (`permisos_app.sql`):
   - `SELECT` de `usuarios` por columna, sin `password_hash`;
   - `EXECUTE` explícito de `colegio_por_rbd` y `credenciales_login`.
7. **El estudiante solo lee:** no tiene ningún endpoint que modifique notas, y el RLS de `02` §9 ya impide que cambie evaluaciones o intentos entregados.

## Consecuencias

**Gana:**

- Login real y verificable por cualquier integrante (Postman, portal, curl) con los usuarios demo (`demo1234`).
- Defensa en profundidad: aunque un endpoint se equivoque, la base no entrega datos de otro estudiante ni de otro colegio. Está probado en `test/privacidad.pg.test.js` y en la suite `98` (52/52).
- El tutor y la API de cursos aplican la misma regla (`puede_ver_curso`): si ves un curso, puedes usar su tutor, y viceversa.
- Cero dependencias nuevas.

**Pierde / se vuelve más difícil:**

- **Sin refresh ni revocación:** el token vale 8 h. Si se desactiva una cuenta, `GET /v1/me` responde `401`, pero las rutas que no consultan el perfil siguen aceptando el token hasta que vence.
- **Freno del login por pod:** con varias réplicas, cada pod cuenta lo suyo y un reinicio lo borra. En producción iría en Redis o en el Ingress/WAF.
- **Dueño de las funciones `SECURITY DEFINER`:** en local es el superusuario que corre los scripts; en producción debe ser `feathersforall_plataforma` (BYPASSRLS, sin superusuario).
- **Lecturas sin rol:** cualquier consulta que lea datos de estudiantes necesita `app.rol` (`db.withUser`). `db.withColegio` ya no ve matrículas ni notas.
- **Contraseñas pendientes:** hoy no hay endpoint para cambiarlas ni para recuperarlas.

## Alternativas descartadas

- **Esperar el SSO institucional:** no hay SSO disponible en el taller y bloquea toda la etapa. El SSO queda como evolución: el bounded context ya prevé que el login traduzca el token del SSO a este mismo JWT (Anticorruption Layer).
- **bcrypt o argon2:** requieren dependencias nativas. scrypt viene en Node y cumple con OWASP.
- **`crypt()` de pgcrypto:** la contraseña viajaría a la base y podría quedar en sus logs.
- **Sesión con cookie en el servidor:** la API es stateless con varias réplicas; el JWT ya era el contrato de S05.
- **Privacidad solo en la API:** no aguanta un error en un endpoint, y el proyecto trata datos de menores.

## Fecha

2026-10-16

## Autores

Ignacio (DevSecOps), con asistencia de IA (Claude Code), declarada según el Charter.

> Regla del taller: un ADR nunca se edita una vez aceptado. Si cambia la decisión, se marca como "Reemplazado" y se crea uno nuevo.
