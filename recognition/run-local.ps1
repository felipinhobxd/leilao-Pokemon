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

# Opcionalmente carrega recognition\.env. Nunca versionar esse arquivo.
$envFile = Join-Path $here ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*) no startup para a primeira foto ja ser rapida.
& .\.venv\Scripts\python.exe recognition_server.py --preload
) {
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

if ([string]::IsNullOrWhiteSpace($env:RECOGNITION_SERVICE_SHARED_SECRET) -or $env:RECOGNITION_SERVICE_SHARED_SECRET.Length -lt 32) {
    Write-Error "Defina RECOGNITION_SERVICE_SHARED_SECRET (>= 32 caracteres) no ambiente ou em recognition\.env. Use o MESMO valor no servidor Next.js/Vercel."
    exit 1
}

# Carrega modelos no startup para a primeira foto ja ser rapida.
& .\.venv\Scripts\python.exe recognition_server.py --preload
