$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "Atualizando Leilão Pokémon..." -ForegroundColor Cyan
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "git pull falhou. Resolva as alterações locais/conflitos e tente novamente." }

Set-Location (Join-Path (Get-Location) "bot")
& npm.cmd install --omit=dev
if ($LASTEXITCODE -ne 0) { throw "npm install falhou." }

$task = Get-ScheduledTask -TaskName "PokemonLeilaoWhatsAppBot" -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName "PokemonLeilaoWhatsAppBot" -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName "PokemonLeilaoWhatsAppBot"
  Write-Host "Bot reiniciado: PokemonLeilaoWhatsAppBot" -ForegroundColor Green
} else {
  Write-Host "A tarefa PokemonLeilaoWhatsAppBot não existe. Execute install-service.ps1 uma vez." -ForegroundColor Yellow
}

Write-Host "Atualização concluída." -ForegroundColor Green
