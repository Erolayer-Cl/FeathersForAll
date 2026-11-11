# Triage de hallazgos y excepciones (VEX)

> S09 · DevSecOps I (ADR 0010). Qué hacer cuando un gate de `.github/workflows/security.yml` (o el `sast` / Trivy de `ci.yml`) se pone rojo.

## 1. Qué gate falló y qué significa

| Job | Herramienta | Falla cuando… | Dónde ver el detalle |
|---|---|---|---|
| `sast` | Semgrep (`p/owasp-top-ten`, `p/javascript`, `p/nodejs` y `.semgrep/`) | Hay un hallazgo de severidad ERROR en `code/`, o una regla propia no pasa sus pruebas | Log del job: archivo, línea, id de la regla y CWE |
| `sca` | Trivy `fs` | Un lockfile tiene un CVE **High/Critical con parche disponible** | Log del job: paquete, versión instalada, versión con arreglo |
| `sbom` | Trivy (CycloneDX + SPDX) | No se pudo generar el SBOM o quedó vacío | Artefacto `sbom` del run |
| `secrets` | gitleaks | Hay algo con forma de secreto en **cualquier** commit del historial | Log del job (el valor sale como `REDACTED`): commit, archivo, regla |
| `build-and-push` (ci.yml) | Trivy `image` | La imagen tiene un CVE High/Critical con parche | Log del job |

## 2. Cómo priorizar (no solo por CVSS)

El CVSS mide qué tan grave es la vulnerabilidad **en general**. Para decidir qué tan urgente es **para nosotros** se suman dos preguntas:

1. **¿Es explotable aquí?** ¿Se llega desde internet sin token? ¿El código vulnerable se ejecuta (o solo está en el build o en las pruebas)?
2. **¿Qué dato expone?** Conversaciones del tutor y notas de menores > apuntes del docente > datos públicos.

| Situación | Prioridad real |
|---|---|
| Explotable desde internet **y** toca datos de estudiantes | Sube un nivel (High → Critical) |
| Explotable, pero solo con token de docente/admin, o sin datos sensibles | Se mantiene |
| El código vulnerable no se ejecuta en producción (dependencia de build, función que no usamos) | Candidato a VEX `not_affected` |

## 3. SLA de remediación

Plazos desde que el gate lo detecta:

| Severidad (ya ajustada) | Plazo |
|---|---|
| Critical | < 7 días |
| High | < 30 días |
| Medium | < 90 días |
| Low | Se arregla junto con otro cambio |

Los gates bloquean High y Critical. Un Medium no bloquea, pero se registra igual en [`vulnerabilidades.md`](vulnerabilidades.md).

## 4. Qué hacer, según el caso

### a) Es real y tiene arreglo → se corrige

1. Se sube la versión (`npm audit fix --omit=dev`, otra imagen base) o se corrige el código.
2. Se registra en [`vulnerabilidades.md`](vulnerabilidades.md) con CVE, CWE y CVSS, como VULN-001 a 003.
3. El PR que lo corrige debe dejar el gate en verde.

### b) Es real pero no nos afecta → excepción VEX

1. Se crea `.vex/AAAA-NNN-<paquete>.openvex.json` con la [plantilla de `.vex/README.md`](../../../.vex/README.md), con `status: not_affected`, una `justification` válida y el motivo en `impact_statement`.
2. La excepción se aprueba en el PR (2 revisores, uno de ellos DevSecOps) y vence en 90 días o cuando salga el parche.
3. **Si aparece un hallazgo High en un PR, su descripción debe incluir el plan de remediación o la justificación VEX** (regla de la PPT S09).

### c) Es un falso positivo de Semgrep → se arregla la regla

- **Regla del taller:** cada falso positivo se resuelve con un PR que mejora la regla (`.semgrep/<regla>.yaml` + un caso `// ok:` en su `.js` de pruebas), **no** con un `// nosemgrep` silencioso.
- Si la regla es del registry (`p/...`) y no la controlamos, se permite `// nosemgrep: <id-de-la-regla>` **con el motivo en la misma línea** y se menciona en el PR.

### d) gitleaks encontró algo

1. **Si es un secreto real:** se **rota primero** (nuevo `JWT_SECRET`, nueva contraseña, revocar el token) y después se limpia. Borrarlo en un commit nuevo **no basta**: sigue en el historial.
2. **Si es un fixture sintético** (token falso de pruebas, hash de la clave demo): se agrega una regex **precisa** a `.gitleaks.toml` con un comentario que explique por qué no es secreto. Nunca se excluye una carpeta completa.

### e) CVE sin parche disponible

Trivy corre con `--ignore-unfixed`, así que no bloquea. Se anota en `vulnerabilidades.md` como "Abierta: sin parche" y se revisa en el escaneo semanal (lunes).

## 5. Correr los gates en local antes del PR

Desde la raíz del repo (requiere Docker):

```bash
# SAST + pruebas de las reglas propias
# (se copian a una carpeta sin punto: semgrep --test no busca pruebas dentro de carpetas ocultas)
docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep:1.140.0 sh -c "cp -r .semgrep /tmp/reglas && semgrep --test /tmp/reglas"
docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep:1.140.0 semgrep scan \
  --config p/owasp-top-ten --config p/javascript --config p/nodejs --config .semgrep/ \
  --severity ERROR --error --metrics=off code

# SCA y SBOM
docker run --rm -v "$PWD:/repo" -w /repo aquasec/trivy:0.76.1 fs --scanners vuln \
  --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
docker run --rm -v "$PWD:/repo" -w /repo aquasec/trivy:0.76.1 fs --format cyclonedx \
  --output sbom-backend.cdx.json code/backend

# Secretos (todo el historial)
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo \
  --config /repo/.gitleaks.toml --redact --verbose
```

Además, el hook de `.pre-commit-config.yaml` detiene un secreto **antes** del commit: `pipx install pre-commit && pre-commit install`.

## 6. Ante un CVE nuevo: ¿lo usamos?

Esta es la razón de tener un SBOM. Se descarga el artefacto `sbom` (o `sbom-api-image`) del último run de `main` y se busca el paquete:

```bash
jq -r '.components[] | select(.name == "body-parser") | "\(.name) \(.version)"' feathersforall-backend.cdx.json
```

Si aparece, se sigue esta guía desde el punto 2.
