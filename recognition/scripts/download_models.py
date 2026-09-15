#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download the ONNX models used by the recognition service (idempotent).

Tiers
-----
- core   (default): runtime essentials only
    * siglip2-base-384              (primary embedding, bake-off winner)
    * ppocrv6 medium det+rec        (OCR route)
- extras (--extras): optional components
    * dinov3-vits16                 (light fallback embedding)
    * aliked-n16 + lightglue        (learned local matcher; default is SIFT,
                                     which ships with OpenCV)
- all    (--all): bake-off/baseline backbones not needed at runtime
    * dinov2-small, dinov3-vitb16

Usage:
    python scripts/download_models.py             # core (~1.6 GB)
    python scripts/download_models.py --extras    # + ~140 MB
    python scripts/download_models.py --all       # everything (dev/bake-off)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
MODELS_DIR = os.environ.get("RECOGNITION_MODELS", BASE)

# (repo_id, remote_file, local_name, subdir) -- subdir None => models/ root
CORE_JOBS = [
    # Primary embedding (bake-off winner: hard ranks [1,1,1,1,1] with gammaAuto)
    ("onnx-community/siglip2-base-patch16-384-ONNX", "onnx/model.onnx", "siglip2-base-384.onnx", None),
    # OCR route (PP-OCRv6 medium: det + rec + charset)
    ("PaddlePaddle/PP-OCRv6_medium_det_onnx", "inference.onnx", "ppocrv6-medium-det.onnx", None),
    ("PaddlePaddle/PP-OCRv6_medium_det_onnx", "inference.yml", "ppocrv6-medium-det.yml", None),
    ("PaddlePaddle/PP-OCRv6_medium_rec_onnx", "inference.onnx", "ppocrv6-medium-rec.onnx", None),
    ("PaddlePaddle/PP-OCRv6_medium_rec_onnx", "inference.yml", "ppocrv6-medium-rec.yml", None),
]

EXTRA_JOBS = [
    # Light fallback embedding (DINOv3-S @224)
    ("onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX", "onnx/model.onnx", "model.onnx", "d3s"),
    ("onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX", "onnx/model.onnx_data", "model.onnx_data", "d3s"),
    # Learned local matcher (optional; SIFT is the default and needs no download)
    ("bukuroo/ALIKED-LightGlue-ONNX", "aliked-n16rot-top1k-640.onnx", "aliked-n16-top1k-640.onnx", None),
    ("bukuroo/ALIKED-LightGlue-ONNX", "lightglue_for_aliked.onnx", "lightglue-aliked.onnx", None),
]

ALL_JOBS = [
    # Bake-off / baseline backbones (dev tooling only, not used at runtime)
    ("onnx-community/dinov2-small-ONNX", "onnx/model.onnx", "dinov2-small.onnx", None),
    ("onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX", "onnx/model.onnx", "model.onnx", "d3b"),
    ("onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX", "onnx/model.onnx_data", "model.onnx_data", "d3b"),
]


def _target(local: str, subdir: str | None) -> str:
    return os.path.join(MODELS_DIR, subdir, local) if subdir else os.path.join(MODELS_DIR, local)


def _download(jobs) -> None:
    from huggingface_hub import hf_hub_download
    import shutil

    os.makedirs(MODELS_DIR, exist_ok=True)
    for repo, remote, local, subdir in jobs:
        target = _target(local, subdir)
        # .onnx_data files are paired with their .onnx; skip the cheap check
        # for them so a partial pair never looks complete.
        if os.path.exists(target) and os.path.getsize(target) > 0 and not local.endswith(".data"):
            print(f"[models] ok (cached) {local}")
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        path = hf_hub_download(repo_id=repo, filename=remote)
        shutil.copyfile(path, target)
        print(f"[models] downloaded {local} ({os.path.getsize(target) // 1024} KB)")


def _ensure_charset() -> None:
    charset_target = os.path.join(MODELS_DIR, "ppocrv6-charset.txt")
    if os.path.exists(charset_target) and os.path.getsize(charset_target) > 0:
        return
    import yaml
    with open(os.path.join(MODELS_DIR, "ppocrv6-medium-rec.yml"), encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    chars = data["PostProcess"]["character_dict"]
    with open(charset_target, "w", encoding="utf-8") as fh:
        fh.write("\n".join(chars))
    print(f"[models] charset extracted: {len(chars)} chars")


def main() -> None:
    tiers = sys.argv[1:]
    jobs = list(CORE_JOBS)
    if "--extras" in tiers or "--all" in tiers:
        jobs += EXTRA_JOBS
    if "--all" in tiers:
        jobs += ALL_JOBS
    _download(jobs)
    _ensure_charset()
    print("[models] done")


if __name__ == "__main__":
    main()
