# Ambiente dev = clúster local kind (k8s/cluster/kind.yaml). Workspace: dev
kube_context = "kind-feathersforall"
namespace    = "feathersforall"
# database_url, database_admin_url y jwt_secret NO van aquí: $env:TF_VAR_database_url / $env:TF_VAR_database_admin_url / $env:TF_VAR_jwt_secret
