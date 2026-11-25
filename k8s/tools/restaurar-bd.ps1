<#
Restaura un respaldo de respaldo-bd.ps1 (plan de recuperación: Documentos/resiliencia/plan-dr.md).

Por defecto es un SIMULACRO: restaura en una base aparte (feathersforall_simulacro), compara la cantidad de
filas con la base real y mide cuánto tardó. La base real no se toca.

  .\k8s\tools\restaurar-bd.ps1                                  # simulacro con el respaldo más reciente
  .\k8s\tools\restaurar-bd.ps1 -Respaldo $HOME\ffa-respaldos\20261125-183000
  .\k8s\tools\restaurar-bd.ps1 -Base feathersforall -Reemplazar # recuperación real: BORRA la base actual
  .\k8s\tools\restaurar-bd.ps1 -Base feathersforall -Roles      # volumen nuevo y vacío: recrea también los roles

Para una recuperación real, primero sacar la API de servicio:
  kubectl scale deployment/ffa-api -n feathersforall --replicas=0   (el HPA la vuelve a 2 después)
#>
param(
    [string]$Respaldo,
    [string]$Contenedor = "ffa-db",
    [string]$Base = "feathersforall_simulacro",
    [switch]$Reemplazar,
    [switch]$Roles
)

$ErrorActionPreference = "Stop"

function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "falló: docker $($args -join ' ')" }
}
function Invoke-Sql([string]$db, [string]$sql) {
    $r = & docker exec $Contenedor psql -U postgres -d $db -v ON_ERROR_STOP=1 -tAc $sql
    if ($LASTEXITCODE -ne 0) { throw "falló la consulta en ${db}: $sql" }
    return "$r".Trim()
}

if (-not $Respaldo) {
    $raiz = Join-Path $HOME "ffa-respaldos"
    $Respaldo = (Get-ChildItem $raiz -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
        Sort-Object Name -Descending | Select-Object -First 1).FullName
    if (-not $Respaldo) { throw "No hay respaldos en $raiz. Corre antes .\k8s\tools\respaldo-bd.ps1" }
}
$dump = Join-Path $Respaldo "feathersforall.dump"
if (-not (Test-Path $dump)) { throw "No existe $dump" }

$simulacro = $Base -ne "feathersforall"
$existe = (Invoke-Sql "postgres" "SELECT count(*) FROM pg_database WHERE datname = '$Base'") -eq "1"
if ($existe -and -not $simulacro -and -not $Reemplazar) {
    throw "La base $Base existe. Para borrarla y restaurar encima, agrega -Reemplazar."
}

Write-Host "Respaldo: $Respaldo"
Write-Host "Destino:  $Base en $Contenedor $(if ($simulacro) { '(simulacro)' } else { '(RECUPERACION REAL)' })"
$reloj = [Diagnostics.Stopwatch]::StartNew()

Invoke-Docker cp $dump "${Contenedor}:/tmp/restaurar.dump"

if ($Roles) {
    # Sin ON_ERROR_STOP: "role postgres already exists" es esperable; lo que importa es que quede feathersforall_app.
    Invoke-Docker cp (Join-Path $Respaldo "roles.sql") "${Contenedor}:/tmp/roles.sql"
    & docker exec $Contenedor psql -U postgres -d postgres -q -f /tmp/roles.sql | Out-Null
    Invoke-Docker exec $Contenedor rm -f /tmp/roles.sql
}

if ($existe) { Invoke-Docker exec $Contenedor dropdb -U postgres --force $Base }
Invoke-Docker exec $Contenedor createdb -U postgres $Base
Invoke-Docker exec $Contenedor pg_restore -U postgres -d $Base --exit-on-error /tmp/restaurar.dump
Invoke-Docker exec $Contenedor rm -f /tmp/restaurar.dump
$segundos = [math]::Round($reloj.Elapsed.TotalSeconds, 1)

# Comprobaciones: filas por tabla, RLS activo y permisos del usuario de la API.
$tablas = "colegios", "usuarios", "cursos", "evaluaciones", "intentos_evaluacion", "conversaciones_tutor", "mensajes_tutor", "apuntes_embeddings"
$filas = foreach ($t in $tablas) {
    $restaurada = Invoke-Sql $Base "SELECT count(*) FROM $t"
    $actual = if ($simulacro) { Invoke-Sql "feathersforall" "SELECT count(*) FROM $t" } else { "-" }
    [pscustomobject]@{ Tabla = $t; Restaurada = $restaurada; Actual = $actual }
}
$filas | Format-Table -AutoSize

$sinRls = Invoke-Sql $Base "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('usuarios','cursos','mensajes_tutor','intentos_evaluacion') AND NOT (c.relrowsecurity AND c.relforcerowsecurity)"
$permiso = Invoke-Sql $Base "SELECT has_function_privilege('feathersforall_app', 'cuentas_por_correo(citext)', 'execute')"
if ($sinRls -ne "0") { throw "Hay tablas restauradas sin RLS forzado: revisar antes de usar esta base." }
if ($permiso -ne "t") { throw "feathersforall_app no tiene sus permisos: falta el rol (usa -Roles) o permisos_app.sql." }

if ($simulacro) {
    $distintas = @($filas | Where-Object { $_.Restaurada -ne $_.Actual }).Count
    Write-Host "Simulacro OK en $segundos s. Tablas con distinta cantidad de filas que la base actual: $distintas (normal si hubo cambios después del respaldo)."
    Write-Host "Borrar la base del simulacro:  docker exec $Contenedor dropdb -U postgres $Base"
} else {
    Write-Host "Base restaurada en $segundos s. Volver a levantar la API:"
    Write-Host "  kubectl scale deployment/ffa-api -n feathersforall --replicas=2"
}
