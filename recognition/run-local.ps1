# Inicia o servico local de reconhecimento (PowerShell / Windows).
# Uso: powershell -ExecutionPolicy Bypass -File recognition\run-local.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path ".venv")) {
    Write-Error "Ambiente nao instalado. Rode primeiro: recognition\install-windows.ps1"
    exit 1
}

# Carrega modelos no startup para a primeira foto ja ser rapida.
& .\.venv\Scripts\python.exe recognition_server.py --preload
