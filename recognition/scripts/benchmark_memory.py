#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Calibration benchmark for the confirmed-memory exemplar retrieval (P0).

Why
---
memory.lookup used a hard-coded 0.80 threshold. SigLIP2 cosine similarity
between DIFFERENT cards concentrates around 0.886 median / 0.940 p95 (full
pt-BR index), so 0.80 sits deep inside the impostor distribution: a random
different card can "confirm" as a memory match. This script measures the
actual positive/impostor distributions and proposes threshold + margin.

Positives: the SAME card under a second, independent degradation (different
rng) — the closest synthetic proxy for "the user photographs the same card
again".
Negatives: every other indexed card (nearest impostor), which includes
same-artwork language twins when present in the calibration catalog.

Outputs data/memory-calibration.json with per-pair rows and a suggestion:
    MEMORY_MIN_SIMILARITY / MEMORY_MARGIN such that false-memory-rate ~ 0.

Usage:
    python scripts/benchmark_memory.py [--model siglip2-base-384]
        [--pairs 120] [--split calibration]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.config import EMBEDDINGS_DIR
from recognizer.normalize import normalize_card

FIXTURES = "data/fixtures"


def load_image(path):
    import cv2
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="siglip2-base-384")
    parser.add_argument("--pairs", type=int, default=120)
    parser.add_argument("--fixtures", default=FIXTURES)
    parser.add_argument("--split", default="calibration",
                        help="fixtures split to use (calibration/validation/all)")
    args = parser.parse_args()

    gt_path = os.path.join(args.fixtures, "ground-truth.json")
    with open(gt_path, encoding="utf-8") as fh:
        fixtures = json.load(fh)
    manifest_path = os.path.join(args.fixtures, "split-manifest.json")
    if args.split != "all":
        if not os.path.exists(manifest_path):
            sys.exit("[memory-bench] run scripts/split_fixtures.py first (no split-manifest.json)")
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)
        allowed = set(manifest.get(args.split, []))
        fixtures = [f for f in fixtures if f["fixtureId"] in allowed]
    print(f"[memory-bench] {len(fixtures)} fixtures (split={args.split})")

    from recognizer.pipeline import VisualIndex
    index = VisualIndex(args.model)

    # import degradation pipeline for the second, independent photo
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
    from make_fixtures import degrade  # same degradations, fresh rng below

    rng = random.Random(987654321)
    rows = []
    for i, fixture in enumerate(fixtures[: args.pairs]):
        img = load_image(os.path.join(args.fixtures, fixture["image"]))
        if img is None:
            continue
        card = normalize_card(img)
        # second degradation of the SAME normalized card = second "photo"
        second_photo = degrade(card.image, "normal", rng)
        second = normalize_card(second_photo)
        query = index.model.embed([second.image])[0]

        scores = (index.matrix @ query.astype(np.float32)).ravel()
        order = np.argsort(-scores)
        truth_key = f"{fixture['language']}|{fixture['cardId']}"
        sim_truth = 0.0
        sim_impostor = 0.0
        impostor_id = ""
        for row in order:  # descending: first non-truth key IS the nearest impostor
            key = index.ids[int(row)]
            if key == truth_key:
                sim_truth = max(sim_truth, float(scores[int(row)]))
            elif sim_impostor == 0.0:
                sim_impostor = float(scores[int(row)])
                impostor_id = key
        rows.append({
            "fixtureId": fixture["fixtureId"], "cardId": fixture["cardId"],
            "simTruth": round(sim_truth, 4), "simImpostor": round(sim_impostor, 4),
            "gap": round(sim_truth - sim_impostor, 4), "impostorId": impostor_id,
        })
        if (i + 1) % 20 == 0:
            print(f"[memory-bench] {i + 1}/{min(len(fixtures), args.pairs)}", flush=True)

    pos = sorted(r["simTruth"] for r in rows)
    imp = sorted(r["simImpostor"] for r in rows)

    def pct(values, p):
        return values[min(len(values) - 1, int(p * len(values)))] if values else 0.0

    print(f"[memory-bench] n={len(rows)} (model={args.model})")
    print(f"  positive (same card, second photo): p05={pct(pos, 0.05):.3f} "
          f"p25={pct(pos, 0.25):.3f} median={pct(pos, 0.5):.3f} p75={pct(pos, 0.75):.3f}")
    print(f"  nearest impostor (different card):  p50={pct(imp, 0.5):.3f} "
          f"p95={pct(imp, 0.95):.3f} max={imp[-1] if imp else 0:.3f}")

    # Proposal: threshold above the impostor max with headroom, margin that
    # separates the positive median from the impostor p95.
    if imp:
        threshold = round(max(pct(imp, 0.99), imp[-1]) + 0.005, 3)
        margin = round(max(0.008, pct(pos, 0.5) - pct(imp, 0.95)), 3)
        false_matches = sum(1 for r in rows if r["simImpostor"] >= threshold)
        print(f"  suggested MEMORY_MIN_SIMILARITY={threshold} MEMORY_MARGIN={margin}")
        print(f"  false-memory matches at that threshold: {false_matches}/{len(rows)}")

    out = "data/memory-calibration.json"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"model": args.model, "split": args.split, "rows": rows}, fh, ensure_ascii=False, indent=1)
    print(f"  -> {out}")


if __name__ == "__main__":
    main()
