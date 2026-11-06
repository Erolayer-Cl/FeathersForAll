# ADR 0010 · DevSecOps shift-left: SAST, SCA, SBOM y secret scanning en cada PR

## Estado

Propuesto — 2026-11-06

## Contexto

En la S08 (ADR 0009) el pipeline ya tenía Semgrep, `npm audit` y Trivy sobre las imágenes, y esos gates encontraron 3 vulnerabilidades reales (VULN-001 a 003). Faltaba lo que pide la S09:

- **Secret scanning:** nada revisaba si un secreto llegaba al historial. Un token borrado en un commit posterior sigue filtrado.
- **SBOM:** sin inventario de componentes, ante un CVE nuevo (como Log4Shell) no hay forma rápida de saber si lo usamos.
- **Reglas propias:** las reglas genéricas de Semgrep no conocen nuestras reglas de seguridad: JWT solo desde el entorno, colegio y rol solo desde el JWT, logs sin contenido de menores.
- **Escaneo programado:** VULN-001 mostró que un CVE aparece aunque nadie haga push.
- **Threat model:** no había un análisis explícito de amenazas del servicio más sensible, el tutor IA.

FeathersForAll guarda datos de **menores de edad** en un sistema **multi-tenant**: un error de aislamiento o una fuga en logs tiene un impacto alto.

## Decisión

Un workflow aparte, **`.github/workflows/security.yml`**, con cuatro jobs bloqueantes en paralelo: `sast` (Semgrep), `sca` (Trivy fs), `sbom` (CycloneDX + SPDX) y `secrets` (gitleaks sobre todo el historial). Corre en cada PR a `main`, en `main` y cada lunes. Se complementa con `ci.yml` y con un threat model STRIDE del tutor.

Detalle:

| Tema | Elección |
|---|---|
| SAST | Semgrep 1.140.0 en contenedor: `p/owasp-top-ten` + `p/javascript` + `p/nodejs` + 4 reglas propias en `.semgrep/`, cada una con casos de prueba (`semgrep --test`). Falla con severidad ERROR. También corre en `ci.yml` (decisión del equipo: en ambos), donde además frena `build-and-push` |
| Reglas propias | `ffa-jwt-secreto-hardcodeado` (S), `ffa-sql-interpolado` (T), `ffa-log-con-datos-del-estudiante` (I), `ffa-tenant-desde-el-cliente` (E): cada una vuelve automática una amenaza del threat model |
| SCA | Trivy `fs` sobre los lockfiles: High/Critical **con parche** (`--ignore-unfixed`) bloquea; las excepciones van como **OpenVEX** en `.vex/`. `npm audit` sigue en `ci.yml` |
| SBOM | Trivy genera CycloneDX (seguridad, VEX) y SPDX (licencias, ISO/IEC 5962) de backend y frontend desde los lockfiles, más CycloneDX de cada **imagen** en `ci.yml`. Se validan con `jq` (no vacíos) y se publican como artefactos (90 días) |
| Secretos | gitleaks v8.28.0 **por imagen Docker** (no `gitleaks-action`, que pide licencia en organizaciones), `fetch-depth: 0`, reglas por defecto + `.gitleaks.toml` con regex precisas para los fixtures sintéticos. Hook opcional en `.pre-commit-config.yaml` |
| Triage | No solo por CVSS: explotabilidad + dato expuesto. SLA Critical < 7 días, High < 30, Medium < 90. Guía: `Documentos/seguridad/triage-y-excepciones.md` |
| Threat model | STRIDE ligero del módulo `tutor`: `Documentos/seguridad/threat-model.md`, revisado en cada release mayor |

## Consecuencias

**Gana:**

- Los secretos, las dependencias vulnerables y los patrones peligrosos se detectan en el PR, no en producción.
- Las reglas del proyecto (`AGENTS.md`) dejan de depender de la memoria del revisor: Semgrep las exige.
- El SBOM permite responder en minutos "¿usamos el paquete X?".
- Las excepciones quedan escritas, versionadas y con vencimiento (VEX), en vez de un `ignore` silencioso.

**Pierde / se vuelve más difícil:**

- Un PR tarda un poco más y puede ponerse rojo por un CVE recién publicado sin que el PR tenga la culpa: se resuelve con la guía de triage.
- Las reglas propias hay que mantenerlas: cada falso positivo exige un PR a la regla.
- Los artefactos de GitHub duran como máximo 90 días. La PPT pide conservar el SBOM 5 años (auditorías Mineduc): eso queda para la S10, adjuntándolo a la imagen en GHCR como attestation firmada con cosign.
- Semgrep corre dos veces por PR (`ci.yml` y `security.yml`): unos 30 s más de CI a cambio de que `build-and-push` siga dependiendo de él.

## Alternativas descartadas

- **`returntocorp/semgrep-action@v1` (la de la PPT):** está deprecada; se usa la imagen oficial `semgrep/semgrep`, como en la S08.
- **`gitleaks/gitleaks-action@v2`:** pide `GITLEAKS_LICENSE` en repos de organizaciones; la imagen hace lo mismo sin licencia.
- **Snyk / SonarQube / CodeQL:** requieren cuenta, token o GitHub Advanced Security en repos privados. Trivy + Semgrep cubren lo que pide la rúbrica sin credenciales nuevas.
- **`cyclonedx-npm` / Syft para el SBOM:** sirven, pero agregan otra herramienta; Trivy ya está en el pipeline y genera ambos formatos.
- **`.trivyignore`:** no deja motivo ni vencimiento; se usa VEX.
- **Todo dentro de `ci.yml`:** la PPT pide `security.yml`, y separarlo permite el escaneo semanal sin reconstruir imágenes.

## Fecha

2026-11-06

## Autores

Ignacio (DevSecOps), con asistencia de IA. Pendiente de revisión del equipo.

> Regla del taller: un ADR nunca se edita una vez aceptado. Si cambia la decisión, se marca como "Reemplazado" y se crea uno nuevo. Un archivo por ADR en `Documentos/adr/`, numerados: `NNNN-titulo-corto.md`.
