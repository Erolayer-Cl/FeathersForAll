<#
Respaldo de PostgreSQL (plan de recuperación: Documentos/resiliencia/plan-dr.md).

Respalda las bases feathersforall y terraform_state (si existe) del contenedor de PostgreSQL, más los roles,
en una carpeta con fecha. Verifica que cada archivo se pueda leer y borra los respaldos más antiguos.

  .\k8s\tools\respaldo-bd.ps1                      # contenedor ffa-db, carpeta $HOME\ffa-respaldos, guarda 14
  .\k8s\tools\respaldo-bd.ps1 -Contenedor feathersforall-db-1   # si la base se levantó con compose.yaml

Los archivos quedan FUERA del repo: traen datos de estudiantes y los hash de las claves de los roles.
Los dumps se generan dentro del contenedor y se copian con docker cp, porque PowerShell 5.1 corrompe
la salida binaria si se redirige con ">".
#>
param(
    [string]$Contenedor = "ffa-db",
    [string]$Destino = (Join-Path $HOME "ffa-respaldos"),
    [int]$Conservar = 14
)

$ErrorActionPreference = "Stop"

function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "falló: docker $($args -join ' ')" }
}

$reloj = [Diagnostics.Stopwatch]::StartNew()
# En Windows PowerShell 5.1, "2>$null" con ErrorActionPreference=Stop lanza error si docker escribe en stderr.
try { $estado = (& docker inspect -f "{{.State.Running}}" $Contenedor 2>$null) } catch { $estado = $null }
if ($estado -ne "true") { throw "El contenedor '$Contenedor' no existe o no está corriendo (docker ps)." }

$fecha = Get-Date -Format "yyyyMMdd-HHmmss"
$carpeta = Join-Path $Destino $fecha
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null

$bases = @("feathersforall")
$hayTf = (& docker exec $Contenedor psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'terraform_state'")
if ("$hayTf".Trim() -eq "1") { $bases += "terraform_state" }

$resumen = @()
foreach ($base in $bases) {
    $tmp = "/tmp/$base.dump"
    Invoke-Docker exec $Contenedor pg_dump -U postgres -Fc -f $tmp $base
    # pg_restore --list lee el índice completo: si el archivo está truncado, falla aquí y no mañana.
    Invoke-Docker exec $Contenedor pg_restore --list $tmp | Out-Null
    Invoke-Docker cp "${Contenedor}:$tmp" (Join-Path $carpeta "$base.dump")
    Invoke-Docker exec $Contenedor rm -f $tmp
    $archivo = Get-Item (Join-Path $carpeta "$base.dump")
    $resumen += [pscustomobject]@{
        Archivo = $archivo.Name
        KB      = [math]::Round($archivo.Length / 1KB)
        SHA256  = (Get-FileHash $archivo.FullName -Algorithm SHA256).Hash
    }
}

# Roles (postgres y feathersforall_app). pg_dump no los incluye; hacen falta si se pierde el volumen completo.
Invoke-Docker exec $Contenedor pg_dumpall -U postgres --roles-only -f /tmp/roles.sql
Invoke-Docker cp "${Contenedor}:/tmp/roles.sql" (Join-Path $carpeta "roles.sql")
Invoke-Docker exec $Contenedor rm -f /tmp/roles.sql

$filas = (& docker exec $Contenedor psql -U postgres -d feathersforall -tAc "SELECT (SELECT count(*) FROM usuarios) || ' usuarios, ' || (SELECT count(*) FROM intentos_evaluacion) || ' intentos, ' || (SELECT count(*) FROM mensajes_tutor) || ' mensajes del tutor'")

$resumen | Format-Table -AutoSize | Out-String | Set-Content (Join-Path $carpeta "respaldo.txt")
Add-Content (Join-Path $carpeta "respaldo.txt") "Contenedor: $Contenedor`r`nContenido: $filas`r`nDuración: $([math]::Round($reloj.Elapsed.TotalSeconds, 1)) s"

# Rotación: solo carpetas con el formato de fecha de este script.
$viejos = Get-ChildItem $Destino -Directory |
    Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
    Sort-Object Name -Descending |
    Select-Object -Skip $Conservar
$viejos | Remove-Item -Recurse -Force

$resumen | Format-Table -AutoSize
Write-Host "Respaldo OK en $carpeta ($filas). $(@($viejos).Count) respaldo(s) antiguo(s) borrado(s). $([math]::Round($reloj.Elapsed.TotalSeconds, 1)) s"
