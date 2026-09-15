# -*- coding: utf-8 -*-
"""Central configuration for the local recognition service."""
from __future__ import annotations

import os

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

# Service
SERVICE_HOST = "127.0.0.1"
SERVICE_PORT = int(os.environ.get("RECOGNITION_PORT", "8765"))
