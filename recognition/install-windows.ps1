# Instala o servico local de reconhecimento no Windows (PowerShell).
# Uso:  powershell -ExecutionPolicy Bypass -File recognition\install-windows.ps1
#
# Passos:
#   1. Cria venv em recognition\.venv
#   2. Instala dependencias (onnxruntime-gpu com CUDA, DirectML, ou CPU)
#   3. Baixa os modelos ONNX core (SigLIP2 + PP-OCRv6; ~1.6 GB)
#   4. Construi catalogo TCGdex local (SQLite, todos os idiomas) + scans pt-BR + en
#   5. Construi o indice de embeddings SigLIP2 (pt-BR primeiro, en em seguida)
#
# Todas as etapas sao idempotentes/retomaveis: se a instalacao for interrompida,
# rodar o script de novo continua de onde parou (catalogo, scans e indice tem
# checkpoint).
#
# Depois: npm run recognition:local  (ou recognition\run-local.ps1)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "== [1/5] Ambiente Python ==" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { Write-Error "Falha ao criar venv (Python 3.10+ instalado?)"; exit 1 }
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip -q

Write-Host "== [2/5] Dependencias (GPU auto-detected) ==" -ForegroundColor Cyan
$gpu = $false
try { nvidia-smi | Out-Null; $gpu = $true } catch { }
if ($gpu) {
    Write-Host "GPU NVIDIA detectada: instalando onnxruntime-gpu (CUDA)" -ForegroundColor Green
    & .\.venv\Scripts\python.exe -m pip install -q onnxruntime-gpu opencv-python numpy pillow fastapi uvicorn python-multipart requests huggingface_hub PyYAML tqdm
} else {
    Write-Host "Sem GPU NVIDIA: usando onnxruntime-directml (accel via GPU qualquer)" -ForegroundColor Yellow
    & .\.venv\Scripts\python.exe -m pip install -q onnxruntime-directml opencv-python numpy pillow fastapi uvicorn python-multipart requests huggingface_hub PyYAML tqdm
}
if ($LASTEXITCODE -ne 0) { Write-Error "Falha ao instalar dependencias"; exit 1 }

Write-Host "== [3/5] Modelos ONNX (core) ==" -ForegroundColor Cyan
& .\.venv\Scripts\python.exe scripts\download_models.py
if ($LASTEXITCODE -ne 0) { Write-Error "Falha ao baixar modelos"; exit 1 }

Write-Host "== [4/5] Catalogo TCGdex local + scans ==" -ForegroundColor Cyan
# Catalogo: todos os idiomas (metadados sao pequenos e uteis para OCR).
# Scans: pt-BR (acervo principal do usuario) + en; es/ja ficam apenas no
# catalogo (scans pesam ~3 GB e raramente sao usados).
& .\.venv\Scripts\python.exe scripts\build_catalog.py --languages pt-BR,en,es,ja
if ($LASTEXITCODE -ne 0) { Write-Error "Falha ao construir catalogo"; exit 1 }
& .\.venv\Scripts\python.exe scripts\download_scans.py --languages pt-BR,en --workers 16

Write-Host "== [5/5] Indice de embeddings SigLIP2 ==" -ForegroundColor Cyan
# batch=8 foi validado (16/32 causam OOM em maquinas com pouca RAM).
# --only-missing torna o build retomavel: pode interromper e rodar de novo.
# pt-BR primeiro para o servico ficar util cedo; en em seguida no mesmo arquivo.
& .\.venv\Scripts\python.exe scripts\build_index.py --model siglip2-base-384 --batch 8 --languages pt-BR --only-missing
if ($LASTEXITCODE -ne 0) { Write-Error "Falha no indice pt-BR"; exit 1 }
Write-Host "Indice pt-BR pronto. Construindo en (pode interromper e retomar)..." -ForegroundColor Cyan
& .\.venv\Scripts\python.exe scripts\build_index.py --model siglip2-base-384 --batch 8 --languages pt-BR,en --only-missing
if ($LASTEXITCODE -ne 0) { Write-Error "Falha no indice en"; exit 1 }

Write-Host ""
Write-Host "Instalacao concluida. Inicie o servico com:" -ForegroundColor Green
Write-Host "  npm run recognition:local"
Write-Host "  (ou powershell -File recognition\run-local.ps1)"
Write-Host ""
Write-Host "Opcional: modelos extras (fallback DINOv3-S + matcher ALIKED/LightGlue):"
Write-Host "  .\.venv\Scripts\python.exe scripts\download_models.py --extras"
