# Registro de vulnerabilidades

Vulnerabilidades encontradas en el código o en las dependencias de FeathersForAll: qué son, si nos afectaban y cómo se cerraron.
Las detectan los gates de CI (S08, ADR 0009): SCA con `npm audit --omit=dev --audit-level=high`, SAST con Semgrep y Trivy sobre las imágenes.
Un hallazgo **High o Critical** bloquea el pipeline hasta que se corrige o se acepta aquí con justificación.

| ID | Componente | CVE | CWE | CVSS | Estado |
|---|---|---|---|---|---|
| [VULN-001](#vuln-001--dos-en-body-parser-con-cuerpos-comprimidos) | `body-parser` 2.3.0 (vía `express` 5.2.1) | CVE-2026-111181 | CWE-248 | 7.5 High | Corregida (26-10-2026) |
| [VULN-002](#vuln-002--openssl-desactualizado-en-la-imagen-base-de-la-api) | Imagen base API `distroless/nodejs22-debian12` (`libssl3`) | CVE-2026-31789 y 6 más | CWE-787, CWE-416, CWE-476, CWE-125, CWE-825 | 9.8 Critical (máx.) | Corregida (26-10-2026) |
| [VULN-003](#vuln-003--imagen-base-del-frontend-sin-parches) | Imagen base web `nginx-unprivileged:1.27-alpine` | CVE-2026-31789 y 42 más | CWE-787 (máx.) y otros | 9.8 Critical (máx.) | Corregida (26-10-2026) |

---

## VULN-001 · DoS en body-parser con cuerpos comprimidos

| Campo | Valor |
|---|---|
| **CVE** | [CVE-2026-111181](https://nvd.nist.gov/vuln/detail/CVE-2026-111181) |
| **Advisory** | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828), publicado el 23-10-2026 |
| **CWE** | [CWE-248](https://cwe.mitre.org/data/definitions/248.html): Uncaught Exception |
| **CVSS v3.1** | **7.5 (High)**: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` |
| **Componente** | `body-parser` 2.3.0, dependencia transitiva de `express` 5.2.1 (`code/backend`) |
| **Versiones afectadas** | `>= 2.0.0, < 2.4.0` y `< 1.20.9` |
| **Detectada por** | Gate SCA de CI (`npm audit --omit=dev --audit-level=high`), primera corrida local del pipeline S08 |
| **Detectada** | 26-10-2026 |
| **Corregida** | 26-10-2026: `body-parser` 2.4.0 |
| **Responsable** | Ignacio (DevSecOps) |

### Cómo leer el CVSS

| Métrica | Valor | Qué significa para nosotros |
|---|---|---|
| AV:N | Red | Se explota con un request HTTP desde internet |
| AC:L | Baja complejidad | Basta un cuerpo armado a mano; no hay condiciones especiales |
| PR:N | Sin privilegios | No hace falta token: el parser corre **antes** de `requireAuth` y del ruteo |
| UI:N | Sin interacción | Ningún usuario tiene que hacer nada |
| S:U | Alcance sin cambio | Afecta solo al proceso de la API |
| C:N / I:N | Sin impacto en confidencialidad ni integridad | No filtra notas ni conversaciones y no modifica datos (el RLS no se ve afectado) |
| A:H | Disponibilidad alta | Termina el proceso de Node |

### Qué pasaba

Con un request con `Content-Encoding` (por ejemplo `gzip`), `body-parser` descomprime el cuerpo con un stream de `zlib` y, al terminar de leerlo, deja ese stream conectado **sin listener de errores**. Si después del bloque comprimido válido llegan bytes extra, el decompresor emite un error que nadie captura y que termina el proceso (`uncaughtException`).

### ¿Nos afectaba?

**Sí.** `src/app.js` monta `express.json({ limit: '100kb' })` para toda la API y `rag.routes.js` monta `express.json({ limit: '2mb' })`, ambos con `inflate: true` (el valor por defecto). Cualquiera podía botar un pod de la API con un request sin autenticar a cualquier ruta.

Kubernetes mitigaba en parte: la liveness probe y la política de reinicio levantan el pod de nuevo, y el HPA mantiene al menos 2 réplicas (PDB: mínimo 1). Aun así, repitiendo el request se podían botar todas las réplicas una y otra vez. Para los estudiantes eso significa que el portal y el tutor se caen, justo en horario de clases o de evaluaciones.

### Cómo se corrigió

- `npm audit fix --omit=dev` en `code/backend`: subió `body-parser` 2.3.0 → **2.4.0** dentro del rango que pide `express` 5.2.1. Solo cambió `package-lock.json`; `package.json` sigue igual.
- Pruebas después del cambio: 241/241 (incluidas las de integración con PostgreSQL) y Newman sin Ollama, 69/69 aserciones.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades.

**Prueba de concepto:** no se logró reproducir el crash en local con 2.3.0 (un gzip, un deflate o un brotli válido seguido de bytes extra en el mismo request devuelven error 400 u "ok", sin botar el proceso). El advisory no publica el payload exacto; es probable que dependa de que los bytes extra lleguen en otro fragmento TCP, después de que el decompresor ya terminó. Por eso no se agregó una prueba de regresión: una prueba que pasa también con la versión vulnerable no protege nada. La protección contra una regresión es el gate SCA, que vuelve a fallar si el lockfile baja de 2.4.0.

### Alternativa evaluada y no aplicada

`express.json({ inflate: false })`: la API no necesita recibir cuerpos comprimidos (el frontend nunca los manda), así que también cerraría el problema y reduciría superficie. Se deja como propuesta para el equipo, porque cambia el comportamiento (un cuerpo comprimido pasaría a responder 415) y tendría que ir en el contrato OpenAPI.

---

## VULN-002 · OpenSSL desactualizado en la imagen base de la API

| Campo | Valor |
|---|---|
| **Componente** | `gcr.io/distroless/nodejs22-debian12:nonroot` (Debian 12.13), paquete `libssl3` 3.0.18-1~deb12u2 |
| **Detectada por** | Gate Trivy de CI (`--severity HIGH,CRITICAL --ignore-unfixed`), 26-10-2026 |
| **Corregida** | 26-10-2026: runtime cambiado a `gcr.io/distroless/nodejs22-debian13:nonroot` (Debian 13.7): **0** High/Critical |
| **Responsable** | Ignacio (DevSecOps) |

| CVE | Severidad | CWE | CVSS v3.1 | Vector | Arreglada en |
|---|---|---|---|---|---|
| CVE-2026-31789 | **Critical** | CWE-787 Out-of-bounds Write | **9.8** | `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` | 3.0.19-1~deb12u2 |
| CVE-2026-28387 | High | CWE-416 Use After Free | 8.1 | `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H` | 3.0.19-1~deb12u2 |
| CVE-2026-45447 | High | CWE-416, CWE-825 | 8.1 | `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H` | 3.0.20-1~deb12u2 |
| CVE-2026-28388 | High | CWE-476 NULL Pointer Dereference | 7.5 | `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` | 3.0.19-1~deb12u2 |
| CVE-2026-28389 | High | CWE-476 | 7.5 | `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` | 3.0.19-1~deb12u2 |
| CVE-2026-28390 | High | CWE-476 | 7.5 | `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` | 3.0.19-1~deb12u2 |
| CVE-2026-84782 | High | CWE-125 Out-of-bounds Read | 7.4 | `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:H` | 3.0.22-1~deb12u2 |

**¿Nos afectaba?** En parte. La API usa TLS de OpenSSL para salir hacia PostgreSQL gestionado y hacia un proveedor LLM externo, así que el código vulnerable sí se carga. CVE-2026-31789 solo es explotable en sistemas de 32 bits (los nodos son amd64/arm64), pero el gate no distingue arquitecturas y el resto aplica igual. En una imagen distroless no se puede correr `apt upgrade` (no hay gestor de paquetes): se arregla cambiando de base.

**Por qué Debian 13:** la variante `debian12` de distroless todavía no se había reconstruido con los parches de OpenSSL. `nodejs22-debian13` es la línea vigente de distroless, mantiene Node 22 (misma versión mayor que en desarrollo) y sale limpia. El ADR 0006 sigue vigente: misma familia (distroless, nonroot); solo cambia la versión de Debian.

**Costo:** la imagen de la API pasó de ~204 MB a 211 MB (la base debian13 pesa 203 MB contra 196 MB). La meta de < 200 MB del ADR 0006 ya no se cumplía con debian12; queda como pendiente.

---

## VULN-003 · Imagen base del frontend sin parches

| Campo | Valor |
|---|---|
| **Componente** | `nginxinc/nginx-unprivileged:1.27-alpine` (Alpine 3.21.3, línea 1.27 sin soporte) |
| **Detectada por** | Gate Trivy de CI, 26-10-2026: **43** CVE únicos con arreglo (1 Critical, 42 High) en OpenSSL, curl, c-ares, brotli y otros |
| **Corregida** | 26-10-2026: `nginx-unprivileged:1.30-alpine` (stable actual, Alpine 3.24.2) + `apk upgrade --no-cache` en el Dockerfile: **0** High/Critical |
| **Responsable** | Ignacio (DevSecOps) |

Peor hallazgo: **CVE-2026-31789** (OpenSSL `libcrypto3`/`libssl3` 3.3.3-r0 → 3.3.7-r0), CWE-787, CVSS 3.1 **9.8** `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`.

Con solo subir a `1.30-alpine` quedaban dos High que Alpine ya había parchado pero la imagen todavía no incluía:

| CVE | Paquete | CWE | CVSS v3.1 | Vector | Arreglada en |
|---|---|---|---|---|---|
| CVE-2026-111497 | `brotli-libs` 1.2.0-r1 | CWE-252, CWE-787 | 8.1 | `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H` | 1.2.1-r0 |
| CVE-2026-92392 | `curl`, `libcurl` 8.22.0-r0 | CWE-416 | 8.1 | `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H` | 8.23.0-r0 |

Por eso el Dockerfile corre `apk upgrade --no-cache` como root y vuelve a `USER 101`. El contenedor sigue corriendo como uid 101 con el sistema de archivos en solo lectura (verificado con `docker run --read-only`).

**¿Nos afectaba?** Poco: NGINX solo sirve archivos estáticos públicos y no usa curl. Pero OpenSSL sí está en el camino si el Ingress termina TLS dentro del pod (hoy no), y la regla del gate es no aceptar High/Critical con arreglo sin justificarlo aquí.

---

### Lección para el pipeline

La vulnerabilidad se publicó el 23-10-2026 y el gate la encontró tres días después, en la primera corrida. Sin el gate habría seguido en el lockfile hasta la próxima actualización manual de dependencias. Para que no dependa de que alguien haga un push, en S09 se propone Dependabot o una corrida programada (`schedule`) del job de SCA.
