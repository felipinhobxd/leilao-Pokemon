# Inicia o servico local de reconhecimento (PowerShell / Windows).
# Uso: powershell -ExecutionPolicy Bypass -File recognition\run-local.ps1
#
# O segredo compartilhado fica em recognition\.env ou no ambiente do processo.
# O MESMO valor deve existir no servidor Next.js/Vercel.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path ".venv")) {
    Write-Error "Ambiente nao instalado. Rode primeiro: recognition\install-windows.ps1"
    exit 1
}

# Carrega recognition\.env quando presente. Esse arquivo é ignorado pelo Git.
$envFile = Join-Path $here ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line -split "=", 2
        if ($parts.Count -ne 2) { return }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (($value.Length -ge 2) -and (($value[0] -eq [char]34) -and ($value[$value.Length - 1] -eq [char]34) -or
            ($value[0] -eq [char]39) -and ($value[$value.Length - 1] -eq [char]39))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

if ([string]::IsNullOrWhiteSpace($env:RECOGNITION_SERVICE_SHARED_SECRET) -or $env:RECOGNITION_SERVICE_SHARED_SECRET.Length -lt 32) {
    Write-Error "Defina RECOGNITION_SERVICE_SHARED_SECRET (>= 32 caracteres) no ambiente ou em recognition\.env. Use o MESMO valor no servidor Next.js/Vercel."
    exit 1
}

# Opcional: liberar o painel publicado (Vercel) para usar este serviço local.
# Exemplo: RECOGNITION_ALLOWED_ORIGINS=https://leilaopokemon.vercel.app
# O servidor continua ligado apenas em 127.0.0.1.
& .\.venv\Scripts\python.exe recognition_server.py --preload
