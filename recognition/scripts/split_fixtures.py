#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Split the synthetic fixtures into calibration / validation / held-out sets.

Why
---
calibrate_thresholds.py used to run on data/fixtures — the SAME set the
benchmark reports on. Fixtures are degradations of the very scans the index
embeds, so the synthetic benchmark is a regression tool, not an independent
accuracy estimate; calibrating on it AND reporting on it is data leakage.

The split is deterministic (hash of language|cardId, fixed seed) and DISJOINT
BY CARD: a card used for calibration never appears in validation or held-out,
so no printing can leak between the sets. Same-artwork twins (same cardId in
two languages) always land in the same split — the hash keys on cardId only,
so pt-BR/en twins move together.

Writes <fixtures>/split-manifest.json:
    {"calibration": [...fixtureIds], "validation": [...], "heldout": [...],
     "seed": ..., "generatedAt": ...}

Usage:
    python scripts/split_fixtures.py [--fixtures data/fixtures]
        [--calibration-frac 0.6] [--validation-frac 0.25]   # rest -> heldout
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SPLIT_SEED = "postmerge-2026-09-16"


def split_of(card_id: str, language: str, seed: str,
             calibration_frac: float, validation_frac: float) -> str:
    digest = hashlib.sha256(f"{seed}|{card_id}".encode()).hexdigest()
    point = int(digest[:8], 16) / 0xFFFFFFFF
    if point < calibration_frac:
        return "calibration"
    if point < calibration_frac + validation_frac:
        return "validation"
    return "heldout"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", default="data/fixtures")
    parser.add_argument("--calibration-frac", type=float, default=0.6)
    parser.add_argument("--validation-frac", type=float, default=0.25)
    args = parser.parse_args()

    gt_path = os.path.join(args.fixtures, "ground-truth.json")
    with open(gt_path, encoding="utf-8") as fh:
        fixtures = json.load(fh)

    buckets: dict[str, list[str]] = {"calibration": [], "validation": [], "heldout": []}
    cards_per_bucket: dict[str, set[str]] = {k: set() for k in buckets}
    for fixture in fixtures:
        bucket = split_of(fixture["cardId"], fixture["language"], SPLIT_SEED,
                          args.calibration_frac, args.validation_frac)
        buckets[bucket].append(fixture["fixtureId"])
        cards_per_bucket[bucket].add(fixture["cardId"])

    for name, ids in buckets.items():
        print(f"[split] {name:<12} {len(ids):>4} fixtures / {len(cards_per_bucket[name]):>4} cards")

    all_cards = set()
    for cards in cards_per_bucket.values():
        assert not (all_cards & cards), "card leaked across splits"
        all_cards |= cards

    manifest = {
        "seed": SPLIT_SEED,
        "fractions": {"calibration": args.calibration_frac,
                      "validation": args.validation_frac,
                      "heldout": round(1 - args.calibration_frac - args.validation_frac, 4)},
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        **buckets,
    }
    out = os.path.join(args.fixtures, "split-manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print(f"[split] manifest -> {out}")
    print("[split] use: calibrate_thresholds.py --split calibration | benchmark.py --split validation")


if __name__ == "__main__":
    main()
