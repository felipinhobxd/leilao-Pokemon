$ErrorActionPreference = "Stop"
$taskName = "PokemonLeilaoWhatsAppBot"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Host "Solicitando permissão de administrador para instalar a tarefa..."
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`""
  )
  exit
}

Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  throw "Arquivo bot/.env não encontrado. Configure o bot antes de instalar o serviço."
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

if (-not (Test-Path "node_modules\@supabase\supabase-js")) {
  Write-Host "Instalando dependências do bot..."
  & $npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm install falhou." }
}

$runner = Join-Path $PSScriptRoot "run-service.ps1"
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -NodePath `"$node`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$triggers = @(
  New-ScheduledTaskTrigger -AtLogOn -User $currentUser,
  New-ScheduledTaskTrigger -AtStartup
)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask `
  -TaskName $taskName `
  -Description "Leilão Pokémon - supervisor persistente do bot WhatsApp/Baileys" `
  -Action $action `
  -Trigger $triggers `
  -Principal $principal `
  -Settings $settings | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Bot instalado em segundo plano com sucesso." -ForegroundColor Green
Write-Host "Tarefa: $taskName"
Write-Host "Logs: $(Join-Path $PSScriptRoot 'logs\bot-service.log')"
Write-Host "O bot inicia automaticamente após reboot/login e reinicia se o supervisor encerrar." 
