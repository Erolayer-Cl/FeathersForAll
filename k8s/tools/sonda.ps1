<#
Sonda del game day (Documentos/resiliencia/game-day.md). Mientras corre, en otra ventana se provoca la falla.

Cada segundo consulta, a través del Ingress, como lo haría un usuario:
  web    GET /            portal (NGINX)
  api    GET /v1/me       API con token: pasa por el JWT y por PostgreSQL
  health GET /health      estado de la BD y de Ollama según la API (solo informativo, no cuenta para el SLO)

Guarda cada medición en un CSV y al final imprime disponibilidad, p95 y la caída más larga.

  .\k8s\tools\sonda.ps1 -Experimento E1-matar-pod
  .\k8s\tools\sonda.ps1 -Experimento E4-bd-caida -Segundos 300
#>
param(
    [Parameter(Mandatory = $true)][string]$Experimento,
    [int]$Segundos = 180,
    [string]$Url = "http://localhost:8088",
    [string]$Correo = "camila@demo-a.cl",
    [string]$Clave = "demo1234",
    [string]$Carpeta = (Join-Path $HOME "ffa-gameday")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$csv = Join-Path $Carpeta ("{0}-{1}.csv" -f $Experimento, (Get-Date -Format "yyyyMMdd-HHmmss"))

$login = Invoke-RestMethod -Method Post -Uri "$Url/v1/auth/login" -ContentType "application/json" `
    -Body (@{ email = $Correo; password = $Clave } | ConvertTo-Json)
$auth = @{ Authorization = "Bearer $($login.access_token)" }

function Medir([string]$objetivo, [string]$ruta, [hashtable]$headers) {
    $reloj = [Diagnostics.Stopwatch]::StartNew()
    $detalle = ""
    try {
        $r = Invoke-WebRequest -Uri "$Url$ruta" -Headers $headers -UseBasicParsing -TimeoutSec 5
        $codigo = [int]$r.StatusCode
        if ($objetivo -eq "health") {
            $h = $r.Content | ConvertFrom-Json
            $detalle = "db=$($h.db) llm=$($h.llm)"
        }
    } catch {
        # Sin respuesta (timeout, conexión rechazada) queda como 0.
        $resp = $_.Exception.Response
        $codigo = if ($resp) { [int]$resp.StatusCode } else { 0 }
    }
    [pscustomobject]@{
        hora     = (Get-Date).ToString("HH:mm:ss")
        objetivo = $objetivo
        codigo   = $codigo
        ms       = [int]$reloj.Elapsed.TotalMilliseconds
        ok       = ($codigo -ge 200 -and $codigo -lt 400)
        detalle  = $detalle
    }
}

Write-Host "Sonda '$Experimento' por $Segundos s contra $Url. Provoca la falla en otra ventana. (Ctrl+C corta)"
$fin = (Get-Date).AddSeconds($Segundos)
$datos = New-Object System.Collections.Generic.List[object]
while ((Get-Date) -lt $fin) {
    $inicio = Get-Date
    foreach ($m in @((Medir "web" "/" @{}), (Medir "api" "/v1/me" $auth), (Medir "health" "/health" @{}))) {
        $datos.Add($m)
        $m | Export-Csv -Path $csv -Append -NoTypeInformation -Encoding UTF8
        if (-not $m.ok -or $m.objetivo -eq "health") {
            $color = if ($m.ok) { "DarkGray" } else { "Red" }
            Write-Host ("{0} {1,-6} {2,3} {3,5} ms {4}" -f $m.hora, $m.objetivo, $m.codigo, $m.ms, $m.detalle) -ForegroundColor $color
        }
    }
    $espera = 1000 - ((Get-Date) - $inicio).TotalMilliseconds
    if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }
}

Write-Host ""
Write-Host "Resultado de $Experimento (CSV: $csv)"
foreach ($objetivo in "web", "api") {
    $serie = @($datos | Where-Object { $_.objetivo -eq $objetivo })
    $buenas = @($serie | Where-Object { $_.ok }).Count
    $ms = @($serie | Where-Object { $_.ok } | ForEach-Object { $_.ms } | Sort-Object)
    $p95 = if ($ms.Count) { $ms[[math]::Min($ms.Count - 1, [math]::Ceiling($ms.Count * 0.95) - 1)] } else { "-" }
    # Caída más larga: mediciones malas seguidas (una por segundo).
    $racha = 0; $peor = 0
    foreach ($m in $serie) { if ($m.ok) { $racha = 0 } else { $racha++; if ($racha -gt $peor) { $peor = $racha } } }
    "{0,-4} disponibilidad {1,6:P2}  ({2}/{3})  p95 {4} ms  caída más larga ~{5} s" -f `
        $objetivo, ($buenas / [math]::Max(1, $serie.Count)), $buenas, $serie.Count, $p95, $peor | Write-Host
}
