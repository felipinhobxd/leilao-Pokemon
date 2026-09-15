# Inicia o servico local de reconhecimento (PowerShell / Windows).
# Uso: powershell -ExecutionPolicy Bypass -File recognition\run-local.ps1
#
# Opcional: liberar o painel publicado (Vercel) para usar este servico local.
# Lista explicita de origens (nunca "*"); o servico continua so em 127.0.0.1.
#   $env:RECOGNITION_ALLOWED_ORIGINS = "https://seu-dominio.vercel.app"
#   powershell -File recognition\run-local.ps1
#
# Concorrencia de reconhecimento (lotes grandes): default 1 (CPU).
#   $env:RECOGNITION_MAX_CONCURRENCY = "2"   # so se a GPU sobrar folga
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path ".venv")) {
    Write-Error "Ambiente nao instalado. Rode primeiro: recognition\install-windows.ps1"
    exit 1
}

# Carrega modelos no startup para a primeira foto ja ser rapida.
& .\.venv\Scripts\python.exe recognition_server.py --preload
