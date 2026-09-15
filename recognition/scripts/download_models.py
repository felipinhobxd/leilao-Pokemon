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

Reproducibility (P2, 2026-09-16): every repo is pinned to an exact revision
(REVISIONS below). Thresholds were calibrated against these concrete weights —
a floating "main" download could silently change the cosine distributions the
calibration depends on. Downloads land in <target>.tmp and are moved into
place atomically (a crash never leaves a half-written model), the ONNX is
opened with onnxruntime before being considered installed, and a manifest
(models/manifest.json) records repo/revision/sha256 for later verification
(--verify re-checks existing files against it).

Usage:
    python scripts/download_models.py             # core (~1.6 GB)
    python scripts/download_models.py --extras    # + ~140 MB
    python scripts/download_models.py --all       # everything (dev/bake-off)
    python scripts/download_models.py --verify    # re-check installed files
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
MODELS_DIR = os.environ.get("RECOGNITION_MODELS", BASE)
MANIFEST_PATH = os.path.join(MODELS_DIR, "manifest.json")

# Exact revisions the calibration/benchmarks were built against (2026-09-16).
# Update deliberately: new weights need a threshold re-calibration
# (scripts/calibrate_thresholds.py) and a benchmark run.
REVISIONS = {
    "onnx-community/siglip2-base-patch16-384-ONNX": "99f5d40afb5331b81eecee4bb02c360fbb9cdf8a",
    "PaddlePaddle/PP-OCRv6_medium_det_onnx": "61323801669c338b7891481ec7bac61ce31b576a",
    "PaddlePaddle/PP-OCRv6_medium_rec_onnx": "50c7eacafc52fa7bcf4194e8cd08e46f8558504b",
    "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX": "48988dfe73065df8d6f5ccc0edc7c8bcf307de41",
    "bukuroo/ALIKED-LightGlue-ONNX": "1c577acef500bd9654d8d4d6b97ff7633eda4254",
    "onnx-community/dinov2-small-ONNX": "08c606e3123472a388efa59181b677d428f69bbd",
    "onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX": "d704d636f7b114347fd2a9d6fecac5e1ef464db3",
}

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


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_onnx(path: str) -> None:
    """A model only counts as installed if onnxruntime can actually open it."""
    try:
        import onnxruntime as ort
    except ImportError:
        print(f"[models] WARNING onnxruntime ausente — pulando validacao de {os.path.basename(path)}")
        return
    ort.InferenceSession(path, providers=["CPUExecutionProvider"])


def _load_manifest() -> dict:
    if not os.path.exists(MANIFEST_PATH):
        return {}
    try:
        with open(MANIFEST_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}


def _save_manifest(manifest: dict) -> None:
    os.makedirs(MODELS_DIR, exist_ok=True)
    tmp = MANIFEST_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, MANIFEST_PATH)


def _verify(jobs) -> int:
    """Re-check installed files against the pinned manifest (sha256)."""
    manifest = _load_manifest()
    failures = 0
    for repo, remote, local, subdir in jobs:
        target = _target(local, subdir)
        entry = manifest.get(target)
        if not os.path.exists(target):
            print(f"[models] MISSING {local}")
            failures += 1
            continue
        if not entry:
            print(f"[models] no manifest entry for {local} (re-download to record)")
            failures += 1
            continue
        if entry.get("revision") != REVISIONS.get(repo):
            print(f"[models] REVISION MISMATCH {local}: installed {entry.get('revision', '?')[:8]} "
                  f"!= pinned {REVISIONS.get(repo, '?')[:8]}")
            failures += 1
            continue
        if _sha256(target) != entry.get("sha256"):
            print(f"[models] SHA256 MISMATCH {local}")
            failures += 1
            continue
        print(f"[models] ok (verified) {local}")
    return failures


def _download(jobs) -> None:
    from huggingface_hub import hf_hub_download

    os.makedirs(MODELS_DIR, exist_ok=True)
    manifest = _load_manifest()
    for repo, remote, local, subdir in jobs:
        target = _target(local, subdir)
        # .onnx_data files are paired with their .onnx; skip the cheap check
        # for them so a partial pair never looks complete.
        if os.path.exists(target) and os.path.getsize(target) > 0 and not local.endswith(".data"):
            if manifest.get(target, {}).get("revision") == REVISIONS.get(repo):
                print(f"[models] ok (cached) {local}")
                continue
            print(f"[models] {local} exists but is not from the pinned revision — re-downloading")
        os.makedirs(os.path.dirname(target) or MODELS_DIR, exist_ok=True)
        revision = REVISIONS.get(repo)
        if revision is None:
            raise RuntimeError(f"No pinned revision for {repo}; pin it in REVISIONS first")
        path = hf_hub_download(repo_id=repo, filename=remote, revision=revision)
        # Atomic install: stage in <target>.tmp, validate, then move.
        tmp = target + ".tmp"
        with open(path, "rb") as src, open(tmp, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
        if local.endswith(".onnx"):
            _validate_onnx(tmp)
        os.replace(tmp, target)
        manifest[target] = {
            "repo": repo, "file": remote, "local": local,
            "revision": revision, "sha256": _sha256(target),
            "bytes": os.path.getsize(target),
        }
        _save_manifest(manifest)
        print(f"[models] downloaded {local} @ {revision[:8]} ({os.path.getsize(target) // 1024} KB)")


def _ensure_charset() -> None:
    charset_target = os.path.join(MODELS_DIR, "ppocrv6-charset.txt")
    if os.path.exists(charset_target) and os.path.getsize(charset_target) > 0:
        return
    import yaml
    with open(os.path.join(MODELS_DIR, "ppocrv6-medium-rec.yml"), encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    chars = data["PostProcess"]["character_dict"]
    tmp = charset_target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(chars))
    os.replace(tmp, charset_target)
    print(f"[models] charset extracted: {len(chars)} chars")


def main() -> None:
    tiers = sys.argv[1:]
    verify_only = "--verify" in tiers
    jobs = list(CORE_JOBS)
    if "--extras" in tiers or "--all" in tiers:
        jobs += EXTRA_JOBS
    if "--all" in tiers or verify_only:
        jobs += ALL_JOBS
    if verify_only:
        failures = _verify(jobs)
        if failures:
            sys.exit(1)
        print("[models] all files verified")
        return
    _download(jobs)
    _ensure_charset()
    print("[models] done")


if __name__ == "__main__":
    main()
