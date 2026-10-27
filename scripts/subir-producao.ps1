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
  # o compose às vezes deixa um prefixo no nome (3229c7e0af72_orbita-db), então busca por filtro
  $banco = docker ps -q --filter "name=orbita-db" 2>$null | Select-Object -First 1
  $saude = if ($banco) { docker inspect -f "{{.State.Health.Status}}" $banco 2>$null } else { "" }
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

# A voz fica no 127.0.0.1: "localhost:8001" pode cair no Docker do cg_platform, que também usa a 8001.
if (-not (Get-NetTCPConnection -LocalPort 8001 -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue)) {
  $env:VOICE_MODELS_DIR = "$raiz\apps\voice\models_test"
  Start-Process -WindowStyle Hidden -WorkingDirectory "$raiz\apps\voice" -FilePath "$raiz\apps\voice\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001" `
    -RedirectStandardOutput "$logs\voice.log" -RedirectStandardError "$logs\voice.err.log"
}

$ts = "C:\Program Files\Tailscale\tailscale.exe"
if (Test-Path $ts) { & $ts serve --bg 3000 | Out-Null }
