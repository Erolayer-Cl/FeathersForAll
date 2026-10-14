# Construye las imágenes, las publica en GHCR y deja sus DIGEST en k8s/kustomization.yaml.
#   (antes, una vez)  docker login ghcr.io -u <tu-usuario-github>     # clave = token con write:packages
#   .\k8s\tools\publicar-imagenes.ps1                                  # desde la raíz del repo
#   .\k8s\tools\publicar-imagenes.ps1 -Owner kypp3rv1l                 # si no tienes permiso en la organización
param(
  [string]$Owner = "erolayer-cl",
  [string]$Tag = "s07"
)
$ErrorActionPreference = "Stop"
$sha = (git rev-parse --short HEAD).Trim()
$kustom = (Resolve-Path "k8s/kustomization.yaml").Path

foreach ($app in @(@{ name = "api"; dir = "code/backend" }, @{ name = "web"; dir = "code/frontend" })) {
  $repo = "ghcr.io/$Owner/feathersforall-$($app.name)"
  Write-Host "==> $repo ($($app.dir))" -ForegroundColor Cyan
  docker build -t "${repo}:$Tag" -t "${repo}:$sha" $app.dir
  if ($LASTEXITCODE) { throw "falló docker build de $($app.name)" }
  foreach ($t in @($Tag, $sha)) {
    docker push "${repo}:$t"
    if ($LASTEXITCODE) { throw "falló docker push de $($app.name) (¿docker login ghcr.io?)" }
  }

  $ref = docker inspect --format "{{index .RepoDigests 0}}" "${repo}:$Tag"   # ghcr.io/...@sha256:...
  $digest = $ref.Split("@")[1]
  $size = docker image inspect --format "{{.Size}}" "${repo}:$Tag"
  Write-Host ("    digest {0}   tamaño {1:N0} MB" -f $digest, ($size / 1MB))

  # Reemplaza newName + digest de esta imagen en kustomization.yaml
  # ReadAllText/WriteAllText: UTF-8 sin BOM (Get-Content/Set-Content de PowerShell 5.1 rompen las tildes)
  $yaml = [IO.File]::ReadAllText($kustom)
  $pattern = "(?ms)(- name: feathersforall-$($app.name)\s+newName: )\S+(\s+digest: )\S+"
  $yaml = [regex]::Replace($yaml, $pattern, "`${1}$repo`${2}$digest")
  [IO.File]::WriteAllText($kustom, $yaml)
}
Write-Host "`nListo. Revisa los digest:  git diff k8s/kustomization.yaml" -ForegroundColor Green
Write-Host "Si el paquete es nuevo, hazlo público en GitHub → Packages → Package settings → Change visibility."
