# Decisiones de arquitectura (ADR)

Un archivo por decisión, con el formato de [`template.md`](template.md). Una decisión aceptada no se edita: si cambia, se marca como reemplazada y se escribe un ADR nuevo.

| ADR | Decisión | Estado |
|---|---|---|
| [0001](0001-eleccion-iniciativa.md) | Elección de la iniciativa AulaViva | Aceptado |
| [0002](0002-estilo-arquitectonico.md) | Monolito modular, multi-tenant con RLS | Aceptado. D2 y D3 reemplazadas por 0012; frontend por 0005 |
| [0003](0003-cloud.md) | Nube híbrida Vercel + Render + AWS | Reemplazado por 0013 |
| [0004](0004-datos-y-eventos.md) | PostgreSQL + pgvector, RLS, outbox y SQS | Aceptado. Broker y outbox reemplazados por 0012; login en dos pasos por 0014 |
| [0005](0005-frontend-react.md) | Frontend con React + Vite | Aceptado |
| [0006](0006-plataforma-k8s.md) | Contenedores, kind, Kustomize y Terraform | Aceptado |
| [0007](0007-autenticacion-y-privacidad.md) | Login propio y privacidad de lectura en la base | Aceptado. Login con RBD, freno y revocación reemplazados por 0014 |
| [0008](0008-conversaciones-del-tutor.md) | Conversaciones del tutor privadas del estudiante | Aceptado |
| [0009](0009-ci-cd-y-gitops.md) | CI con GitHub Actions y GitOps con Argo CD | Aceptado |
| [0010](0010-devsecops-shift-left.md) | SAST, SCA, SBOM y secret scanning en cada PR | Aceptado |
| [0011](0011-supply-chain.md) | Firma, SLSA, IaC scan, DAST y Falco | Aceptado |
| [0012](0012-tutor-sincrono-en-el-monolito.md) | Tutor IA síncrono en el monolito, sin worker ni cola | Aceptado |
| [0013](0013-despliegue-real.md) | Kubernetes (kind) con Argo CD; Vercel solo para el portal | Aceptado |
| [0014](0014-login-por-correo-y-revocacion.md) | Login por correo, revocación de sesión y freno por IP | Aceptado |
