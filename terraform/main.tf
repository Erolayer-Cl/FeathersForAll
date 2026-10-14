# Infraestructura base de FeathersForAll en Kubernetes (S07).
#
# Terraform crea la "plataforma" del equipo dentro del clúster: namespace con Pod Security "restricted",
# cuotas, límites por defecto y el Secret de la API. La aplicación (Deployments, Ingress, HPA…) la aplica
# Kustomize después:  terraform apply  →  kubectl apply -k k8s/
#
# Uso (ver terraform/README.md):
#   $env:PG_CONN_STR = "postgres://postgres:postgres@localhost:5433/terraform_state?sslmode=disable"
#   terraform init
#   terraform workspace select -or-create dev
#   terraform apply -var-file=envs/dev.tfvars

terraform {
  required_version = ">= 1.6"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
  }

  # State REMOTO con locking: PostgreSQL (el mismo motor del proyecto, ADR 0004).
  # La conexión llega por la variable de entorno PG_CONN_STR (nunca en el repo).
  # El backend "pg" bloquea con advisory locks: dos `apply` a la vez no corrompen el state.
  # Cada workspace (dev, prod…) guarda su propio state.  En AWS: backend "s3" + lock (ADR 0006).
  backend "pg" {
    schema_name = "feathersforall_tfstate"
  }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kube_context
}

module "feathersforall" {
  source = "./modules/app-namespace"

  name        = var.namespace
  environment = terraform.workspace

  quota = {
    requests_cpu    = "2"
    requests_memory = "2Gi"
    limits_cpu      = "6"
    limits_memory   = "4Gi"
    pods            = "30"
  }

  # Secret que la API lee con envFrom (k8s/deployment.yaml). Valores reales por TF_VAR_*, nunca en git.
  secrets = {
    name = "ffa-api-secrets"
    data = {
      DATABASE_URL = var.database_url
      JWT_SECRET   = var.jwt_secret
    }
  }
}
