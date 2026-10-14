variable "name" {
  description = "Nombre del namespace."
  type        = string
}

variable "environment" {
  description = "Ambiente (normalmente terraform.workspace)."
  type        = string
}

variable "quota" {
  description = "Cuota de recursos del namespace."
  type = object({
    requests_cpu    = string
    requests_memory = string
    limits_cpu      = string
    limits_memory   = string
    pods            = string
  })
}

variable "secrets" {
  description = "Secret de la aplicación (nombre y pares clave/valor)."
  type = object({
    name = string
    data = map(string)
  })
  sensitive = true
}
