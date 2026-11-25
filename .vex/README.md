# `.vex/` — excepciones de vulnerabilidades (VEX)

Aquí van los documentos **OpenVEX** (`*.openvex.json`) con los que el equipo declara que un CVE **no nos afecta**.
El job `sca` de `.github/workflows/security.yml` y el escaneo de imágenes de `ci.yml` (`build-and-push`) se los pasan a Trivy (`--vex`) y Trivy deja de bloquear por ese CVE.

Excepciones vigentes:

| Archivo | CVE | Paquete | Vence |
|---|---|---|---|
| `2026-001-libzstd1.openvex.json` | CVE-2026-124851 | `libzstd1` de la imagen base de la API ([VULN-005](../FeathersForAll/Documentos/seguridad/vulnerabilidades.md#vuln-005--libzstd1-en-la-imagen-base-de-la-api)) | Cuando distroless traiga el parche, o 23-02-2027 |

**Proceso completo** (cuándo se acepta una excepción, quién la aprueba y SLA): [`Documentos/seguridad/triage-y-excepciones.md`](../FeathersForAll/Documentos/seguridad/triage-y-excepciones.md).

## Plantilla

Copia esto en `.vex/AAAA-NNN-<paquete>.openvex.json` (un archivo por excepción) y completa:

```json
{
  "@context": "https://openvex.dev/ns/v0.2.0",
  "@id": "https://github.com/Erolayer-Cl/feathersforall/.vex/2026-001",
  "author": "Ignacio (DevSecOps)",
  "timestamp": "2026-11-06T12:00:00Z",
  "version": 1,
  "statements": [
    {
      "vulnerability": { "name": "CVE-AAAA-NNNNN" },
      "products": [ { "@id": "pkg:npm/nombre-del-paquete@1.2.3" } ],
      "status": "not_affected",
      "justification": "vulnerable_code_not_in_execute_path",
      "impact_statement": "Por qué no nos afecta, en una o dos frases (ej.: solo se usa en el build, no llega a la imagen)."
    }
  ]
}
```

Valores de `justification` permitidos por OpenVEX:
`component_not_present`, `vulnerable_code_not_present`, `vulnerable_code_not_in_execute_path`,
`vulnerable_code_cannot_be_controlled_by_adversary`, `inline_mitigations_already_exist`.

Reglas:

- Una excepción **vence**: se revisa cuando sale el parche o, como máximo, en 90 días.
- Se aprueba en el PR que la agrega (2 revisores, uno de ellos DevSecOps).
- Nunca se usa `.trivyignore` ni `# nosemgrep` sin dejar el motivo registrado aquí o en el PR que corrige la regla.
