# Post-mortem: CI bloqueado por un CVE en la imagen base (libzstd1)

| | |
|---|---|
| Fecha | 25-11-2026 |
| Severidad | Media: sin impacto en usuarios; bloqueó la integración y el despliegue de cambios |
| Estado | Mitigado con excepción VEX; cierre definitivo cuando distroless publique la imagen parchada |
| Registro | [VULN-005](../../seguridad/vulnerabilidades.md#vuln-005--libzstd1-en-la-imagen-base-de-la-api) · [`.vex/2026-001-libzstd1.openvex.json`](../../../../.vex/2026-001-libzstd1.openvex.json) |

Formato sin culpables: se analiza el sistema y el proceso, no a las personas.

## Resumen

El gate de Trivy del job `build-and-push (api)` empezó a fallar en todos los PR por **CVE-2026-124851** (High) en `libzstd1` 1.5.7+dfsg-1. Ese paquete viene en la imagen base `gcr.io/distroless/nodejs22-debian13`. Debian ya había publicado el arreglo, así que `--ignore-unfixed` no lo filtraba. Pero distroless todavía no había reconstruido su imagen, y nosotros no podemos parchar un paquete de Debian dentro de distroless: no tiene `apt`.

Mientras duró, no se pudo integrar nada en `main`, así que tampoco se publicaron ni firmaron imágenes nuevas. Producción siguió con el digest anterior: los usuarios no notaron nada.

## Línea de tiempo (25-11-2026)

| Momento | Qué pasó |
|---|---|
| Al abrir el PR de `feat/tutor-v1.7` | `build-and-push (api)` falla: Trivy reporta CVE-2026-124851 High con arreglo disponible |
| Después | Los PR abiertos esa tarde quedan con el mismo check en rojo, aunque no tocan la imagen |
| Durante el análisis | Se descarta parchar desde el Dockerfile: distroless no tiene gestor de paquetes |
| Durante el análisis | Se comprueba que ningún proceso carga `libzstd.so.1`: el binario oficial de Node trae zstd y OpenSSL compilados por dentro (`node_shared_zstd=false`, `node_shared_openssl=false`), y `ldd` solo muestra libc, libm, libdl, libpthread y libgcc_s. La imagen no tiene shell ni otros programas |
| 15:00 (18:00 UTC) | Se publica la excepción VEX `not_affected` / `vulnerable_code_not_in_execute_path`, con vencimiento el 23-02-2027. `ci.yml` y `security.yml` le pasan los `.vex/*.openvex.json` a Trivy |
| Después | El check vuelve a verde; se integra el PR #27 (tutor v1.7) |

## Impacto

- **Usuarios:** ninguno. El gate funcionó como debía: bloqueó antes de publicar.
- **Equipo:** integración detenida durante el análisis, en la semana de la entrega final.
- **SLO:** no se gastó presupuesto de error (S1–S3 miden el servicio, no el CI).

## Causas

1. **Directa:** un CVE High en una dependencia de la imagen base, con arreglo en Debian pero todavía no en distroless.
2. **De proceso:** el gate bloquea por cualquier CVE High con arreglo, sin distinguir si el arreglo está a nuestro alcance o si el código se ejecuta. Eso está bien como valor por defecto. Lo que faltaba era un camino documentado y rápido para el caso "no nos afecta y no podemos parcharlo".
3. **De visibilidad:** nadie vigila las actualizaciones de la imagen base. Nos enteramos por el CI, no antes.

## Qué salió bien

- El gate detuvo la imagen antes de que llegara al clúster.
- La excepción quedó auditable (OpenVEX en el repo, con justificación, autor y vencimiento) en vez de un `.trivyignore` sin explicación.
- El análisis dejó evidencia verificable: las variables de `process.config` y la salida de `ldd`.

## Qué salió mal

- Se perdió tiempo buscando cómo parchar dentro de distroless, cosa que no se puede.
- El vencimiento de la excepción depende de que alguien se acuerde del 23-02-2027.

## Acciones

| # | Acción | Responsable | Estado |
|---|---|---|---|
| A1 | Documentar el procedimiento para CVE de la imagen base ([runbook R8](../runbook.md#r8--el-ci-falla-por-un-cve-en-la-imagen-base)) | Tech Lead | Hecho |
| A2 | Proceso de excepciones VEX con plantilla y reglas ([`.vex/README.md`](../../../../.vex/README.md)) | DevSecOps | Hecho |
| A3 | Dependabot (ecosistema `docker`) para que abra un PR cuando cambie el digest de la imagen base. Así se ve el parche sin esperar al CI | DevSecOps | Pendiente |
| A4 | Paso del CI que falle si una excepción VEX está vencida | DevSecOps | Pendiente |
| A5 | Al salir la imagen parchada: actualizar la base, borrar la excepción y cerrar VULN-005 | DevSecOps | Pendiente |
