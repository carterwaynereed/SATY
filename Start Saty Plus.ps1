$ErrorActionPreference = 'Stop'
$satyRoot = $PSScriptRoot
$satyUrl = 'http://127.0.0.1:8765'
New-Item -ItemType Directory -Path (Join-Path $satyRoot 'data') -Force | Out-Null
try { $satyStatus = Invoke-WebRequest -Uri "$satyUrl/api/snapshot" -UseBasicParsing -TimeoutSec 2 } catch { $satyStatus = $null }
if (-not $satyStatus) {
    Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $satyRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $satyRoot 'data\server.log') -RedirectStandardError (Join-Path $satyRoot 'data\server-error.log')
    Start-Sleep -Seconds 1
}
Start-Process $satyUrl
