# Módulo reutilizable: el "espacio" de un equipo/aplicación dentro de un clúster.
# Lo mismo sirve para dev (kind) y para un clúster administrado (EKS) cambiando solo el provider.

resource "kubernetes_namespace_v1" "this" {
  metadata {
    name = var.name
    labels = {
      "app.kubernetes.io/part-of"    = var.name
      "app.kubernetes.io/managed-by" = "terraform"
      "environment"                  = var.environment
      # Pod Security Admission: rechaza pods que corran como root, escalen privilegios, etc.
      "pod-security.kubernetes.io/enforce" = "restricted"
      "pod-security.kubernetes.io/warn"    = "restricted"
    }
  }
}

# Techo de recursos del namespace: el HPA no puede escalar sin límite (control de costo).
resource "kubernetes_resource_quota_v1" "this" {
  metadata {
    name      = "${var.name}-quota"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"    = var.quota.requests_cpu
      "requests.memory" = var.quota.requests_memory
      "limits.cpu"      = var.quota.limits_cpu
      "limits.memory"   = var.quota.limits_memory
      "pods"            = var.quota.pods
    }
  }
}

# Valores por defecto para contenedores que no declaren recursos (la cuota los exige).
resource "kubernetes_limit_range_v1" "this" {
  metadata {
    name      = "${var.name}-limits"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  spec {
    limit {
      type = "Container"
      default_request = {
        cpu    = "50m"
        memory = "64Mi"
      }
      default = {
        cpu    = "250m"
        memory = "128Mi"
      }
    }
  }
}

resource "kubernetes_secret_v1" "this" {
  metadata {
    name      = var.secrets.name
    namespace = kubernetes_namespace_v1.this.metadata[0].name
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
  type = "Opaque"
  data = var.secrets.data
}
