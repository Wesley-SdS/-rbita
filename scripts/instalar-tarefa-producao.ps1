# Registra a tarefa "Orbita Producao": roda subir-producao.ps1 no logon do
# usuário atual, sem janela e sem administrador. `-Remover` desfaz.
param([switch]$Remover)
$nome = "Orbita Producao"
if ($Remover) { Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue; return }

$script = Join-Path $PSScriptRoot "subir-producao.ps1"
$acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config -Principal $principal -Force | Out-Null
Get-ScheduledTask -TaskName $nome | Select-Object TaskName, State
