output "namespace" {
  description = "Namespace creado; úsalo en kubectl -n."
  value       = module.feathersforall.namespace
}

output "secret_name" {
  description = "Secret que referencia k8s/deployment.yaml (envFrom.secretRef)."
  value       = module.feathersforall.secret_name
}

output "siguiente_paso" {
  value = "kubectl apply -k k8s/   y luego   kubectl get all -n ${module.feathersforall.namespace}"
}
