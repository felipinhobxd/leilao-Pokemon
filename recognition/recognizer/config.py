# -*- coding: utf-8 -*-
"""Central configuration for the local recognition service."""
from __future__ import annotations

import os


def load_local_env(path: str | None = None, environ: dict | None = None) -> list[str]:
    """Apply recognition/.env (KEY=VALUE) without overriding the real env.

    `npm start` (scripts/start-all.mjs) and `npm run recognition:local`
    spawn this process directly — only run-local.ps1 reads recognition/.env,
    so the documented setup silently produced a service with
    authConfigured=false (health.ready=false) and the site fell back to the
    browser pipeline for every photo. Loading the file here makes EVERY
    launch path honor it. setdefault semantics: variables already in the
    process environment (launcher, tests, CI) always win.
    """
    env = os.environ if environ is None else environ
    target = path or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    applied: list[str] = []
    try:
        with open(target, "r", encoding="utf-8") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return applied
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if not name or name in env:
            continue
        env[name] = value
        applied.append(name)
    return applied


load_local_env()

BASE_DIR = os.environ.get(
    "RECOGNITION_HOME",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "card-index"),
)
MODELS_DIR = os.environ.get(
    "RECOGNITION_MODELS",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"),
)

CATALOG_DB = os.path.join(BASE_DIR, "cards.sqlite")
IMAGE_CACHE_DIR = os.path.join(BASE_DIR, "image-cache")
EMBEDDINGS_DIR = os.path.join(BASE_DIR, "embeddings")
os.makedirs(EMBEDDINGS_DIR, exist_ok=True)

# Priority order for multi-language search (user: mostly pt-BR, then en, ja rare)
LANGUAGES = ["pt-BR", "en", "es", "ja"]

# Card geometry (Pokemon TCG standard: 63 x 88 mm)
CARD_ASPECT = 63.0 / 88.0
NORM_W, NORM_H = 600, 840  # normalized card resolution used across the pipeline

# Embedding defaults (bake-off decides the winner)
# 2026-09-14 bake-off (adversarial mini-index, 612 cards, 12 fixtures):
#   dinov3-vits16@224  hard ranks [286,12,118,45,49]   reprint [2,2]
#   dinov2-small@224   hard ranks [169,4,57,10,5]      reprint [5,2]
#   dinov3-vitb16@224  hard ranks [86,1,154,1,55]      reprint [3,2]
#   dinov3-vits16@392  hard ranks [42,1,2,1,7]         reprint [1,1]
#   siglip2-base@384   hard ranks [2,1,1,1,1]          reprint [1,2]
#   + query gammaAuto  hard ranks [1,1,1,1,1]          Top1 11/12
# SigLIP2 won on retrieval rank by a wide margin; DINOv3-S@224 stays as the
# light fallback index (embeddings already built).
DEFAULT_EMBEDDING = os.environ.get("RECOGNITION_EMBEDDING", "siglip2-base-384")

# Per-model fusion calibration. Cosine similarity distributions differ a lot
# between backbones (SigLIP2 concentrates sims in 0.6-0.95; DINOv3 in
# 0.3-0.9), so thresholds must be model-aware, not global constants.
#   floor   : chance-level similarity subtracted before weighting
#   strong  : visual-only evidence strong enough for IDENTIFICADO (with >=2 evidence)
#   medium  : visual similarity that still counts as a retrieval signal
#   weight  : fusion score scale for (sim - floor) * weight
# siglip2-base-384 calibrated on the full pt-BR index (12.588 cards, 106
# fixtures, 2026-09-15): simTruth p25=0.869 median=0.913; best-impostor
# median=0.886 p95=0.940; correct-top1 minSim=0.770 gap p05=+0.005.
# floor=0.89 (impostor median): a chance-level match contributes ~zero
# fusion score, so same-artwork reprints cannot ride the visual term alone.
EMBEDDING_CALIBRATION = {
    "dinov3-vits16": {"floor": 0.55, "strong": 0.82, "medium": 0.72, "weight": 140.0},
    "dinov3-vits16-392": {"floor": 0.55, "strong": 0.82, "medium": 0.72, "weight": 140.0},
    "dinov3-vitb16": {"floor": 0.55, "strong": 0.82, "medium": 0.72, "weight": 140.0},
    "dinov3-vitb16-392": {"floor": 0.55, "strong": 0.82, "medium": 0.72, "weight": 140.0},
    "dinov2-small": {"floor": 0.45, "strong": 0.80, "medium": 0.70, "weight": 140.0},
    "siglip2-base-384": {"floor": 0.89, "strong": 0.91, "medium": 0.87, "weight": 200.0},
}
DEFAULT_CALIBRATION = {"floor": 0.55, "strong": 0.82, "medium": 0.72, "weight": 140.0}

# Retrieval / verification defaults
TOPK = int(os.environ.get("RECOGNITION_TOPK", "50"))
VERIFY_CANDIDATES = int(os.environ.get("RECOGNITION_VERIFY_TOPK", "12"))

# Confirmed-memory exemplar retrieval (P0 recalibration, 2026-09-16).
# SigLIP2 cosine similarity between DIFFERENT cards concentrates around
# 0.886 median / 0.940 p95 on the full pt-BR index (12.7k cards, PR #14
# calibration), so the old 0.80 threshold sat INSIDE the impostor
# distribution. Measured by scripts/benchmark_memory.py on the reduced
# validation environment (2.9k-card index, calibration + validation splits,
# positives = same card under an independent degradation):
#   - nearest impostor: max 0.913 (calib) / 0.888 (validation)
#   - positives: median ~0.87-0.88, p75 ~0.90-0.92 (cross-degradation)
# MEMORY_MIN_SIMILARITY=0.95 clears every measured impostor maximum AND the
# full-index p95 (0.940) with headroom; MEMORY_MARGIN=0.012 additionally
# rejects ambiguous leads over a different card. At these values the
# false-memory rate is 0 on both splits; memory fires only on clean
# re-photographs, which is the intended AUXILIARY behavior (it never
# produces IDENTIFICADO alone — the pipeline enforces that).
MEMORY_MIN_SIMILARITY = float(os.environ.get("RECOGNITION_MEMORY_MIN_SIMILARITY", "0.95"))
MEMORY_MARGIN = float(os.environ.get("RECOGNITION_MEMORY_MARGIN", "0.012"))
MEMORY_MAX_EXAMPLES = int(os.environ.get("RECOGNITION_MEMORY_MAX_EXAMPLES", "500"))

# Service
SERVICE_HOST = "127.0.0.1"
SERVICE_PORT = int(os.environ.get("RECOGNITION_PORT", "8765"))

# Recognition work is CPU/GPU heavy and synchronous: the service executes at
# most RECOGNITION_MAX_CONCURRENCY recognitions at once (the rest wait in an
# in-process queue and are reported as queueMs). 1 is the safe default on CPU;
# a strong GPU can raise it to 2.
RECOGNITION_MAX_CONCURRENCY = max(1, int(os.environ.get("RECOGNITION_MAX_CONCURRENCY", "1")))

# CORS: explicit allow-list, NEVER "*". The wizard on https://<vercel-domain>
# must be added by the operator, e.g.
#   RECOGNITION_ALLOWED_ORIGINS=https://leilao.example.com,https://staging.example.com
# See README ("Painel Vercel + serviço local") for the Private Network Access
# notes: the service stays bound to 127.0.0.1 and answers the PNA preflight.
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3001", "http://127.0.0.1:3001",
]


def allowed_origins() -> list[str]:
    """Parse RECOGNITION_ALLOWED_ORIGINS (comma-separated) over the localhost defaults."""
    raw = os.environ.get("RECOGNITION_ALLOWED_ORIGINS", "")
    if not raw.strip():
        return list(DEFAULT_ALLOWED_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or list(DEFAULT_ALLOWED_ORIGINS)
