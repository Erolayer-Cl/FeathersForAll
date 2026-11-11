# ADR 0011 · Cadena de suministro: imágenes firmadas, attestation SLSA, IaC scan, DAST y control en runtime

## Estado

Propuesto — 2026-11-11

## Contexto

Con la S09 (ADR 0010) el pipeline revisa el código, las dependencias y los secretos antes del merge. Quedaba sin cubrir lo que pasa después:

- **Nada probaba que la imagen del clúster fuera la que construyó el CI.** Cualquiera con permiso de escritura en GHCR podía publicar una imagen a mano (`publicar-imagenes.ps1`) y poner su digest en el repo gitops. Es el patrón de SolarWinds y XZ Utils: el código revisado estaba bien, lo que se distribuyó no.
- **La infraestructura no se revisaba.** Terraform y los manifiestos de `k8s/` entraban sin escaneo.
- **No había prueba dinámica.** SAST no ve cabeceras ni configuración del servidor. El threat model ya anotaba la falta de CSP (S-4).
- **Sin visibilidad en runtime.** Si alguien lograba ejecutar algo dentro de un pod, nadie se enteraba.
- **El SBOM duraba 90 días** como artefacto de GitHub (pendiente del ADR 0010).

El sistema guarda notas y conversaciones de menores en un esquema multi-tenant, así que una imagen alterada o un pod comprometido exponen a todos los colegios a la vez.

## Decisión

Firmar cada imagen con **cosign keyless** en `ci.yml`, adjuntarle **provenance SLSA y SBOM como attestations**, y exigir esa firma en el clúster con **Kyverno**. Antes del build corre un **IaC scan** (Checkov), después un **DAST** (ZAP baseline) sobre la imagen firmada, y en runtime vigila **Falco** con 3 reglas propias.

| Tema | Elección |
|---|---|
| Firma | `cosign sign` keyless en `build-and-push`, solo en `main`. La identidad es el propio workflow (`…/.github/workflows/ci.yml@refs/heads/main`) vía OIDC de GitHub: no hay llave que guardar, rotar ni filtrar. Se firma el digest, nunca un tag |
| Attestations | `cosign attest --type slsaprovenance1` con el commit, el workflow y el run que construyeron la imagen, y `--type cyclonedx` con el SBOM de la imagen. Quedan en GHCR junto a la imagen |
| Nivel SLSA | **Build L2**: build en servicio hospedado (runner de GitHub) y provenance firmada con una identidad que el autor del commit no controla. No es L3: la provenance la arma un paso del mismo job, no un builder aislado |
| Verificación en CI | `cosign verify` y `cosign verify-attestation` en el mismo job, con la identidad exacta. El job `dast` vuelve a verificar antes de usar la imagen. La salida queda en el resumen del run |
| Admisión | Kyverno `ImageValidatingPolicy` (`k8s/policies/require-signature.yaml`): en el namespace `feathersforall` toda imagen debe tener firma y attestation SLSA de esa identidad. `Deny` y `failurePolicy: Fail` |
| IaC scan | Checkov 3.4.4, job `iac-scan`, bloquea `build-and-push`. Terraform y la **salida de `kubectl kustomize`** (lo que llega al clúster). Configuración y excepciones en `.checkov.yaml` |
| Container scan | Trivy sobre cada imagen, como desde la S08: falla con High/Critical que tengan arreglo |
| DAST | ZAP baseline, job `dast`, contra un **staging efímero** en el runner (`dast/compose.staging.yaml`) con las imágenes del run, PostgreSQL con datos sintéticos y la cuenta del estudiante demo. Bloquea `promote`. Reglas en `dast/zap-rules.tsv` |
| Runtime | Falco con `falco/rules-custom.yaml`: proceso inesperado, conexión saliente inesperada desde la API y lectura de `/proc/<pid>/environ`. Las tres son Critical y abren incidente (`falco/README.md`) |
| Retención | Firma y attestations viven en GHCR mientras exista la versión de la imagen. Las versiones que llegaron a prod no se borran. Falta un respaldo fuera de GHCR para los 5 años que pide la PPT |

### Hallazgos corregidos en este mismo cambio

| Origen | Hallazgo | Corrección |
|---|---|---|
| Checkov `CKV2_K8S_6` | Ningún pod tenía NetworkPolicy | `k8s/networkpolicy.yaml`: todo cerrado por defecto; entra solo el Ingress, sale solo a DNS, PostgreSQL y Ollama |
| Threat model S-4 (el DAST lo bloquea con las reglas 10038 y 10020) | El frontend no enviaba Content-Security-Policy ni protección anti-clickjacking | `code/frontend/security-headers.conf`: CSP sin `unsafe-inline`, `X-Frame-Options`, `Permissions-Policy` y otras. Se quitó el `<style>` en línea de `portal.html` |

### Excepciones aceptadas

Cada una entra por PR. Se revisan al cerrar el semestre o si cambia lo que las justifica.

| Excepción | Motivo |
|---|---|
| Checkov `CKV_K8S_35` (secretos como variables de entorno) | La API se configura por entorno (12-Factor III, ADR 0006). El riesgo que queda lo cubre la regla Falco 3 |
| Checkov `CKV_K8S_40` (UID ≥ 10000) | El frontend corre como 101, el usuario de `nginx-unprivileged`: sin root, sin capabilities y con sistema de archivos de solo lectura |
| ZAP 90003 (SRI ausente) como WARN | Google Fonts entrega un CSS distinto por navegador y no admite `integrity`. Se cierra sirviendo las fuentes desde el propio sitio |
| ZAP 10021 y 10015 como WARN | Faltan `X-Content-Type-Options` y `Cache-Control: no-store` en las respuestas JSON de la API. Pendiente: cambia el contrato |

## Consecuencias

**Gana:**

- Una imagen publicada a mano, desde otra rama o desde otro repo no entra al namespace: no tiene la firma del workflow.
- De cualquier imagen desplegada se puede decir de qué commit y de qué run salió, y qué componentes trae, sin depender de artefactos que vencen.
- Los errores de configuración de infraestructura se detienen en el PR. El primero ya apareció (pods sin NetworkPolicy).
- Hay una señal si algo corre dentro de un pod aunque haya pasado todos los controles anteriores.
- Se cierra S-4 del threat model.

**Pierde / se vuelve más difícil:**

- `publicar-imagenes.ps1` deja de servir para desplegar en un clúster con la policy: solo valen las imágenes del CI. Es lo buscado, pero el respaldo manual de la S07 desaparece.
- El pipeline de `main` depende de servicios externos (Fulcio y Rekor de Sigstore). Si no responden, no se firma y no se promueve.
- La firma queda en un log público (Rekor) con el nombre del repo y del workflow. El repo ya es público.
- Kyverno consulta GHCR en cada admisión: los paquetes deben ser públicos o hay que darle credenciales, y un GHCR caído impide crear pods nuevos (`failurePolicy: Fail`).
- La CSP obliga a no usar estilos ni scripts en línea en el frontend, y a declarar cada dominio externo nuevo.
- Con la red cerrada por defecto, todo componente nuevo (por ejemplo Prometheus en la S11) necesita su regla en `networkpolicy.yaml`.
- Kyverno, Falco y la NetworkPolicy solo se pueden probar en el clúster kind: CI valida la sintaxis de las reglas Falco, no su comportamiento.
- `k8s/` sigue duplicado con `base/` del repo gitops: `networkpolicy.yaml` hay que copiarlo allá.

## Alternativas descartadas

- **Llave cosign propia (`cosign generate-key-pair`):** es un secreto más que guardar y rotar, y quien la obtenga firma lo que quiera. Keyless ata la firma al workflow.
- **`cosign attest --type slsaprovenance` (la de la PPT):** genera provenance v0.2. Se usa `slsaprovenance1`, el formato vigente de SLSA.
- **`actions/attest-build-provenance` o `slsa-github-generator`:** generan la provenance fuera del job y acercan a L3. Quedan como siguiente paso; la rúbrica pide `cosign attest` y L2.
- **Kyverno `ClusterPolicy` con `verifyImages`:** está deprecada en las versiones actuales de Kyverno en favor de `ImageValidatingPolicy`.
- **Cosign policy-controller / OPA Gatekeeper:** resuelven lo mismo. Kyverno además sirve para políticas generales sin aprender Rego.
- **tfsec / KICS:** tfsec se integró a Trivy. Checkov cubre Terraform y Kubernetes con una sola herramienta, es la de la PPT.
- **Escanear los YAML de `k8s/` sueltos:** da falsos positivos de namespace y de digest, porque esos valores los pone Kustomize.
- **Grype para imágenes:** Trivy ya está en el pipeline desde la S08.
- **DAST contra el clúster kind:** está en un PC y GitHub no lo alcanza. Un runner propio dentro de la red del equipo sería otra pieza que mantener y proteger.
- **`zaproxy/action-baseline`:** abre issues por su cuenta y necesita más permisos. La imagen de ZAP hace lo mismo, igual que el resto de las herramientas del pipeline.
- **ZAP full scan (activo):** más lento y con más falsos positivos. Se parte con el pasivo y se evalúa `zap-api-scan` con el contrato OpenAPI.

## Fecha

2026-11-11

## Autores

Iván (Tech Lead). Pendiente de revisión del equipo.

> Regla del taller: un ADR nunca se edita una vez aceptado. Si cambia la decisión, se marca como "Reemplazado" y se crea uno nuevo. Un archivo por ADR en `Documentos/adr/`, numerados: `NNNN-titulo-corto.md`.
