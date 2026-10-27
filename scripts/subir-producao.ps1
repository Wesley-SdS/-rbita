# Sobe a Órbita em modo produção (api sem watch + web com next start) e liga o
# HTTPS do Tailscale. Roda no logon pela tarefa "Orbita Producao" (ver
# instalar-tarefa-producao.ps1). Depois de mudar código: `next build` no
# apps/web e rodar este script de novo (ele só sobe o que está parado).
$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent $PSScriptRoot
$node = "C:\ProgramData\nvm\v22.22.3"
$env:PATH = "$node;$env:PATH"
$logs = Join-Path $env:LOCALAPPDATA "Orbita\logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Porta-Aberta($porta) {
  [bool](Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue)
}

# O Postgres e o GOWA reiniciam sozinhos com o Docker Desktop. Sem o banco o api
# cai ao subir, então espera o contêiner ficar saudável (até ~5 min).
for ($i = 0; $i -lt 60; $i++) {
  $saude = docker inspect -f "{{.State.Health.Status}}" orbita-db 2>$null
  if ($saude -eq "healthy") { break }
  Start-Sleep 5
}

# Um api por vez: dois processos brigam pela porta e rodam os laços em dobro.
if (-not (Porta-Aberta 3010)) {
  $env:NODE_ENV = "production"
  Start-Process -WindowStyle Hidden -WorkingDirectory "$raiz\apps\api" -FilePath "$node\node.exe" `
    -ArgumentList "./node_modules/tsx/dist/cli.mjs", "src/main.ts" `
    -RedirectStandardOutput "$logs\api.log" -RedirectStandardError "$logs\api.err.log"
}

if (-not (Porta-Aberta 3000)) {
  $env:NODE_ENV = "production"
  Start-Process -WindowStyle Hidden -WorkingDirectory "$raiz\apps\web" -FilePath "$node\node.exe" `
    -ArgumentList "./node_modules/next/dist/bin/next", "start", "-p", "3000" `
    -RedirectStandardOutput "$logs\web.log" -RedirectStandardError "$logs\web.err.log"
}

$ts = "C:\Program Files\Tailscale\tailscale.exe"
if (Test-Path $ts) { & $ts serve --bg 3000 | Out-Null }
