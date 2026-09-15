#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Data-driven threshold calibration for one embedding model.

Runs pure retrieval (Route A only, multi-view query) over all fixtures and
records, per fixture:
  - sim(truth)  : similarity of the ground-truth card (or 0/absent)
  - sim(best impostor)
  - rank of truth

Then proposes calibration values (floor / strong / medium / weight) that keep
false-high-confidence at zero while maximizing honest identification.

Usage: python scripts/calibrate_thresholds.py [--model siglip2-base-384] [--embedding-model X]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.normalize import normalize_card

FIXTURES = "data/fixtures"


def load_image(path):
    import cv2
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="siglip2-base-384")
    parser.add_argument("--topk", type=int, default=50)
    args = parser.parse_args()

    fixtures = json.load(open(f"{FIXTURES}/ground-truth.json"))
    from recognizer.pipeline import VisualIndex
    index = VisualIndex(args.model)

    rows = []
    for i, fx in enumerate(fixtures):
        print(f"[calibrate] {i+1}/{len(fixtures)} {fx['fixtureId']}", flush=True)
        img = load_image(os.path.join(FIXTURES, fx["image"]))
        if img is None:
            continue
        card = normalize_card(img)
        results = index.search(card.image, args.topk, [card.image, card.rotated180])
        truth_key = f"{fx['language']}|{fx['cardId']}"
        sim_truth = 0.0
        sim_impostor = 0.0
        rank = 999
        for i, (language, card_id, sim, _o) in enumerate(results):
            if f"{language}|{card_id}" == truth_key:
                sim_truth = max(sim_truth, sim)
                rank = min(rank, i + 1)
            else:
                sim_impostor = max(sim_impostor, sim)
        rows.append({
            "fixtureId": fx["fixtureId"], "level": fx.get("level", "?"),
            "rank": rank, "simTruth": round(sim_truth, 4),
            "simImpostor": round(sim_impostor, 4),
            "gap": round(sim_truth - sim_impostor, 4),
            "normMethod": card.method, "normConf": round(float(card.confidence), 2),
        })

    correct = [r for r in rows if r["rank"] == 1]
    missed = [r for r in rows if r["rank"] != 1]
    pos_sims = sorted(r["simTruth"] for r in rows)
    imp_sims = sorted(r["simImpostor"] for r in rows)

    def pct(values, p):
        if not values:
            return 0.0
        return values[min(len(values) - 1, int(p * len(values)))]

    print(f"[calibrate] model={args.model} fixtures={len(rows)}")
    print(f"  top1={len(correct)}/{len(rows)} ({100*len(correct)/len(rows):.1f}%)")
    print(f"  simTruth:  p05={pct(pos_sims,0.05):.3f} p25={pct(pos_sims,0.25):.3f} "
          f"median={pct(pos_sims,0.5):.3f} p75={pct(pos_sims,0.75):.3f}")
    print(f"  simImpostor: median={pct(imp_sims,0.5):.3f} p95={pct(imp_sims,0.95):.3f} "
          f"max={imp_sims[-1] if imp_sims else 0:.3f}")
    print("  misses:")
    for r in missed:
        print(f"    {r['fixtureId']:<38} rank={r['rank']:<4} simTruth={r['simTruth']:.3f} "
              f"simImpostor={r['simImpostor']:.3f} gap={r['gap']:+.3f} norm={r['normMethod']}")

    # propose thresholds: strong should separate correct-top1 (with gap) from impostors
    if correct:
        min_correct = min(r["simTruth"] for r in correct)
        gaps = sorted(r["gap"] for r in correct)
        print(f"\n  correct top1: minSim={min_correct:.3f} gap p05={pct(gaps,0.05):+.3f} "
              f"gap median={pct(gaps,0.5):+.3f}")
    # candidate strong = median of correct sims - safety, or value that keeps all correct above
    strong_candidates = [pct(pos_sims, p) for p in (0.25, 0.4, 0.5)]
    print(f"  suggested: floor={pct(imp_sims, 0.5):.2f} strong={strong_candidates[-1]:.2f} "
          f"medium={pct(pos_sims, 0.25):.2f}")

    out = f"data/calibrate-{args.model}.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"model": args.model, "rows": rows}, fh, ensure_ascii=False, indent=1)
    print(f"  -> {out}")


if __name__ == "__main__":
    main()
