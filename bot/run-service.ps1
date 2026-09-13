param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir "bot-service.log"
$previousLog = Join-Path $logDir "bot-service.previous.log"

if (Test-Path $logPath) {
  $size = (Get-Item $logPath).Length
  if ($size -gt 10MB) {
    if (Test-Path $previousLog) { Remove-Item $previousLog -Force }
    Move-Item $logPath $previousLog -Force
  }
}

"[$(Get-Date -Format o)] Iniciando supervisor do WhatsApp." | Out-File -FilePath $logPath -Append -Encoding utf8

& $NodePath "--env-file=.env" "service.mjs" *>> $logPath
$exitCode = $LASTEXITCODE

"[$(Get-Date -Format o)] Supervisor encerrou com código $exitCode." | Out-File -FilePath $logPath -Append -Encoding utf8
exit $exitCode
