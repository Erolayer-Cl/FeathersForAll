variable "kubeconfig_path" {
  description = "Ruta del kubeconfig (kind lo actualiza al crear el clúster)."
  type        = string
  default     = "~/.kube/config"
}

variable "kube_context" {
  description = "Contexto de kubectl donde se aplica (kind crea 'kind-feathersforall')."
  type        = string
}

variable "namespace" {
  description = "Namespace del equipo. Debe coincidir con `namespace:` de k8s/kustomization.yaml."
  type        = string
  default     = "feathersforall"
}

# --- Secretos: pasar por variables de entorno TF_VAR_database_url / TF_VAR_database_admin_url / TF_VAR_jwt_secret ---
# El valor por defecto es un PLACEHOLDER: la API arranca, pero /readyz falla hasta poner el real.

variable "database_url" {
  description = "Conexión de la API (usuario feathersforall_app, sin BYPASSRLS)."
  type        = string
  sensitive   = true
  default     = "postgres://feathersforall_app:CAMBIAR@host.docker.internal:5433/feathersforall"
}

variable "database_admin_url" {
  description = "Conexión de plataforma para los jobs (purga de conversaciones, ADR 0008). En producción: feathersforall_plataforma."
  type        = string
  sensitive   = true
  default     = "postgres://postgres:CAMBIAR@host.docker.internal:5433/feathersforall"
}

variable "jwt_secret" {
  description = "Secreto HS256 de los JWT (mínimo 32 caracteres)."
  type        = string
  sensitive   = true
  default     = "placeholder-cambiar-placeholder-cambiar"

  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "jwt_secret debe tener al menos 32 caracteres."
  }
}
