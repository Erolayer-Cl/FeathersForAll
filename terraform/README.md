# Terraform · plataforma de FeathersForAll en Kubernetes

Crea, dentro del clúster, lo que la aplicación necesita antes de desplegarse:

| Recurso | Para qué |
|---|---|
| `Namespace feathersforall` | Etiquetado con Pod Security `restricted`: el clúster rechaza pods que corran como root o escalen privilegios |
| `ResourceQuota` | Techo de CPU, memoria y pods del equipo. El HPA no puede crecer sin límite (costo) |
| `LimitRange` | Recursos por defecto para contenedores que no los declaren |
| `Secret ffa-api-secrets` | `DATABASE_URL` y `JWT_SECRET` de la API, con valores tomados de `TF_VAR_*`, nunca de git |

Estructura:

```text
terraform/
  main.tf                     # provider kubernetes, backend remoto "pg", llamada al módulo
  variables.tf  outputs.tf
  envs/dev.tfvars             # ambiente dev = kind (sin secretos)
  modules/app-namespace/      # módulo reutilizable: namespace + quota + limits + secret
```

- **State remoto con locking:** backend `pg` en PostgreSQL (`PG_CONN_STR`). Usa un advisory lock, así que dos `apply` simultáneos no corrompen el state. En AWS se cambia a `backend "s3"` con lock.
- **Un workspace por ambiente:** `terraform workspace select -or-create dev` (más adelante `stg` y `prod`, cada uno con su `envs/<ambiente>.tfvars` y su contexto de kubectl).
- **Secretos:** el valor por defecto es un placeholder. Los reales van por `$env:TF_VAR_database_url` y `$env:TF_VAR_jwt_secret`. Como quedan en el state, este nunca se versiona (`.gitignore`) y vive en la base.

Los pasos completos están en [`../k8s/README.md`](../k8s/README.md), paso 2.
