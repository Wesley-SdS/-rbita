<#
.SYNOPSIS
  Instala ou remove as mãos da Órbita no Windows (apps/maos, PRD-COMPUTADOR-E-NAVEGADOR A1).

.DESCRIPTION
  Instalar (padrão):
    1. recusa rodar como administrador: a tarefa precisa nascer no nível NORMAL do usuário;
    2. gera o MAOS_TOKEN aleatório no .env da raiz, só se ainda não existir (nunca troca
       um token que já está lá, e nunca mostra o valor);
    3. registra a tarefa "Orbita Maos" no Agendador de Tarefas, disparada ao fazer logon
       DESTE usuário, rodando o pythonw do venv (sem janela de console), com nível de
       execução Limitado (nunca o mais alto) e prioridade NORMAL (4);
    4. sobe a tarefa agora e confere o /health com o token, esperando até -EsperarSeg
       (padrão 180 s) e dizendo o andamento.
  Rodar de novo é seguro: a tarefa é regravada igual e o token fica o mesmo.

  Prioridade: o Agendador cria tarefa com prioridade 7 (abaixo do normal) quando ninguém
  diz outra. Com a máquina ocupada, o processo das mãos ficou minutos sem CPU (1 s de CPU
  em 11 min, thread pronta e nunca escalada) e o instalador desistia antes de ele subir.
  Por isso a tarefa nasce com prioridade 4, a de um programa aberto à mão.

  Atalho de parar: o padrão é Ctrl+Alt+Esc (chave controle.atalhoParar, em Ajustes,
  Controle do PC). O atalho global engole o Esc, mas o Ctrl+Alt chega ao app em primeiro
  plano e pode deixá-lo no modo de teclas de acesso (o Bloco de Notas fica com o menu
  sublinhado, e a ação seguinte da Órbita dá "a tela mudou"). Se isso atrapalhar, troque
  por um atalho sem Alt sozinho no fim, como Ctrl+Alt+F12 ou Ctrl+Shift+F12. O padrão
  não muda sozinho: trocar é decisão do dono.

  Seco (-Seco): mostra o que seria registrado (usuário, comando, nível, prioridade) e
  sai sem tocar em nada: não gera token, não registra nem sobe a tarefa.

  Remover (-Remover): tira a tarefa e encerra o processo das mãos. Com -ApagarToken,
  tira também a linha MAOS_TOKEN do .env (o apps/api passa a mostrar "maos: nao_usado"
  ou "mal_configurado" no /api/health).

  Por que tarefa de logon e não serviço do Windows: serviço roda na sessão 0, que não
  enxerga a área de trabalho, e as mãos precisam da tela do dono.

.PARAMETER Remover
  Desfaz a instalação.
.PARAMETER ApagarToken
  Com -Remover: apaga também o MAOS_TOKEN do .env da raiz.
.PARAMETER NaoIniciar
  Instala sem subir agora (sobe no próximo logon).
.PARAMETER EsperarSeg
  Quanto esperar o /health depois de subir a tarefa (padrão 180 s).
.PARAMETER Seco
  Só mostra o que faria; não muda nada.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\maos\scripts\instalar.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\maos\scripts\instalar.ps1 -Remover
#>
[CmdletBinding()]
param(
  [switch]$Remover,
  [switch]$ApagarToken,
  [switch]$NaoIniciar,
  [ValidateRange(10, 1800)][int]$EsperarSeg = 180,
  [switch]$Seco
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

$NomeDaTarefa = 'Orbita Maos'
$PastaMaos = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Raiz = (Resolve-Path (Join-Path $PastaMaos '..\..')).Path
$ArquivoEnv = Join-Path $Raiz '.env'
$Pythonw = Join-Path $PastaMaos '.venv\Scripts\pythonw.exe'
$Servir = Join-Path $PastaMaos 'servir.py'
$Utf8SemBom = New-Object System.Text.UTF8Encoding $false

function Test-Elevado {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LinhasDoEnv {
  if (-not (Test-Path -LiteralPath $ArquivoEnv)) { return @() }
  # lido como UTF-8 de propósito: o 5.1 leria como ANSI e estragaria acento de outras chaves ao regravar
  $texto = [IO.File]::ReadAllText($ArquivoEnv, $Utf8SemBom)
  if ($texto.Length -eq 0) { return @() }
  return ($texto -split "`r?`n")
}

function Set-LinhasDoEnv([string[]]$Linhas) {
  # LF e UTF-8 sem BOM, como o arquivo já está (o dotenv do api e o config.py das mãos leem assim)
  $texto = ($Linhas -join "`n").TrimEnd("`n") + "`n"
  [IO.File]::WriteAllText($ArquivoEnv, $texto, $Utf8SemBom)
}

function Get-ValorDoEnv([string]$Chave) {
  foreach ($l in (Get-LinhasDoEnv)) {
    if ($l -match "^\s*(export\s+)?$Chave\s*=\s*(.*)$") {
      return $Matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

function Set-TokenSeFaltar {
  $atual = Get-ValorDoEnv 'MAOS_TOKEN'
  if ($atual) {
    Write-Host 'MAOS_TOKEN já existe no .env da raiz: mantido como está.'
    return
  }
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $linhas = @(Get-LinhasDoEnv)
  $trocou = $false
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    # a chave existe mas está vazia: preenche no mesmo lugar
    if ($linhas[$i] -match '^\s*(export\s+)?MAOS_TOKEN\s*=') {
      $linhas[$i] = "MAOS_TOKEN=$token"
      $trocou = $true
    }
  }
  if (-not $trocou) {
    $linhas = @($linhas | Where-Object { $_ -ne $null }) + @('# mãos do Windows (apps/maos): gerado por apps/maos/scripts/instalar.ps1', "MAOS_TOKEN=$token")
  }
  Set-LinhasDoEnv $linhas
  Remove-Variable token
  Write-Host 'MAOS_TOKEN gerado no .env da raiz (o valor não é mostrado). Reinicie o apps/api para ele passar a usar.'
}

function Remove-Token {
  $linhas = @(Get-LinhasDoEnv)
  $antes = $linhas.Count
  $linhas = @($linhas | Where-Object { $_ -notmatch '^\s*(export\s+)?MAOS_TOKEN\s*=' -and $_ -notmatch '^# mãos do Windows \(apps/maos\): gerado por' })
  if ($linhas.Count -eq $antes) {
    Write-Host 'Não havia MAOS_TOKEN no .env da raiz.'
    return
  }
  Set-LinhasDoEnv $linhas
  Write-Host 'MAOS_TOKEN apagado do .env da raiz.'
}

function Get-ProcessosDasMaos {
  # o caminho completo do servir.py vai no argumento da tarefa, então ele identifica o processo
  # (o pythonw do venv é um lançador que abre o pythonw de verdade, e os dois têm a mesma linha)
  $alvo = $Servir.ToLowerInvariant()
  @(Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($alvo) })
}

function Stop-Maos {
  $ps = @(Get-ProcessosDasMaos)
  foreach ($p in $ps) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($ps.Count) { Write-Host "Mãos encerradas ($($ps.Count) processo(s))." }
}

function Get-Saude {
  $token = Get-ValorDoEnv 'MAOS_TOKEN'
  $porta = Get-ValorDoEnv 'MAOS_PORTA'
  if (-not $porta) { $porta = '8003' }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$porta/health" -Headers @{ 'x-orbita-maos' = $token }
    return ($r.Content | ConvertFrom-Json)
  } catch {
    return $null
  }
}

if (Test-Elevado) {
  throw 'Este script não roda como administrador: as mãos têm de nascer no nível normal do usuário. Abra um PowerShell comum e rode de novo.'
}

if ($Remover) {
  $tarefa = Get-ScheduledTask -TaskName $NomeDaTarefa -ErrorAction SilentlyContinue
  if ($Seco) {
    Write-Host "[seco] nada foi alterado. Removeria: a tarefa '$NomeDaTarefa' ($(if ($tarefa) { 'instalada' } else { 'não instalada' })), $(@(Get-ProcessosDasMaos).Count) processo(s) das mãos$(if ($ApagarToken) { ' e o MAOS_TOKEN do .env da raiz' })."
    return
  }
  if ($tarefa) {
    Stop-ScheduledTask -TaskName $NomeDaTarefa -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $NomeDaTarefa -Confirm:$false
    Write-Host "Tarefa '$NomeDaTarefa' removida do Agendador de Tarefas."
  } else {
    Write-Host "A tarefa '$NomeDaTarefa' não estava instalada."
  }
  Stop-Maos
  if ($ApagarToken) { Remove-Token }
  return
}

if (-not (Test-Path -LiteralPath $Pythonw)) {
  throw "Não achei $Pythonw. Crie o venv antes (apps/maos/README.md, seção Instalar)."
}

# a prioridade de uma tarefa do Agendador vai de 0 (tempo real) a 10 (ociosa); 4 é a de um programa
# aberto à mão. O padrão do Agendador (7, abaixo do normal) deixava as mãos sem CPU na máquina ocupada
$PrioridadeDaTarefa = 4

$usuario = "$env:USERDOMAIN\$env:USERNAME"
# os New-ScheduledTask* só montam os objetos: nada é gravado até o Register-ScheduledTask
$acao = New-ScheduledTaskAction -Execute $Pythonw -Argument "`"$Servir`"" -WorkingDirectory $PastaMaos
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $usuario
# Limited: o nível normal do usuário. As mãos também recusam subir elevadas (servir.py), mas a trava começa aqui
$quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
# sem teto de duração (o padrão do Agendador mata a tarefa em 72 h), uma instância só e prioridade normal
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -Priority $PrioridadeDaTarefa
$descricao = 'Órbita: as mãos no Windows (apps/maos). Sobe no logon, sem janela, no nível normal do usuário. Remover: apps\maos\scripts\instalar.ps1 -Remover'

$AvisoDoAtalho = 'Atalho de parar: o padrão é Ctrl+Alt+Esc. O Ctrl+Alt chega ao app em primeiro plano e pode deixá-lo no modo de teclas de acesso (menu sublinhado); se atrapalhar, troque em Ajustes, Controle do PC (controle.atalhoParar), por exemplo para Ctrl+Alt+F12.'

if ($Seco) {
  $temToken = [bool](Get-ValorDoEnv 'MAOS_TOKEN')
  Write-Host "[seco] nada foi alterado. Seria registrada a tarefa '$NomeDaTarefa':"
  Write-Host "[seco]   usuário: $usuario, ao fazer logon"
  Write-Host "[seco]   comando: $Pythonw `"$Servir`" (em $PastaMaos)"
  Write-Host "[seco]   nível: $($quem.RunLevel); prioridade: $($ajustes.Priority); limite de duração: $($ajustes.ExecutionTimeLimit); instâncias: $($ajustes.MultipleInstances)"
  Write-Host "[seco]   MAOS_TOKEN no .env da raiz: $(if ($temToken) { 'já existe (seria mantido)' } else { 'não existe (seria gerado)' })"
  Write-Host "[seco]   espera do /health depois de subir: $EsperarSeg s"
  Write-Host "[seco] $AvisoDoAtalho"
  return
}

Set-TokenSeFaltar

Register-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' -Action $acao -Trigger $gatilho -Principal $quem -Settings $ajustes -Description $descricao -Force | Out-Null
Write-Host "Tarefa '$NomeDaTarefa' registrada: ao fazer logon de $usuario, nível Limitado, prioridade $PrioridadeDaTarefa (normal)."

if ($NaoIniciar) {
  Write-Host $AvisoDoAtalho
  return
}

$saude = Get-Saude
if ($saude) {
  Write-Host "As mãos já estavam de pé (versão $($saude.versao)). Para pegar código novo: -Remover e instalar de novo."
} else {
  Start-ScheduledTask -TaskName $NomeDaTarefa
  # a primeira subida importa UIA, captura e o parser: numa máquina carregada passa de um minuto
  Write-Host "Tarefa iniciada. Esperando as mãos responderem (até $EsperarSeg s; a primeira subida é lenta com a máquina ocupada)..."
  $comeco = Get-Date
  $ultimoAviso = 0
  while (-not $saude) {
    $passou = [int]((Get-Date) - $comeco).TotalSeconds
    if ($passou -ge $EsperarSeg) { break }
    if ($passou - $ultimoAviso -ge 15) {
      $ultimoAviso = $passou
      $vivos = @(Get-ProcessosDasMaos).Count
      Write-Host ("  ainda subindo: {0} s de {1} ({2})" -f $passou, $EsperarSeg, $(if ($vivos) { "processo das mãos vivo" } else { "o processo ainda não apareceu" }))
    }
    Start-Sleep -Milliseconds 1000
    $saude = Get-Saude
  }
}
if (-not $saude) {
  throw "A tarefa subiu mas o /health não respondeu em $EsperarSeg s. Veja o log em $env:LOCALAPPDATA\Orbita\maos\maos.log (a tarefa continua instalada; rode de novo com -EsperarSeg maior, ou -Remover)."
}
Write-Host ("Mãos de pé: versão {0}, elevado={1}, integridade={2}, sessão do Windows {3}." -f $saude.versao, $saude.elevado, $saude.integridade, $saude.sessao_windows)
if ($saude.elevado) { throw 'As mãos estão elevadas, e isso não pode acontecer. Rode -Remover.' }
Write-Host $AvisoDoAtalho
