#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deep failure analysis for a benchmark run (cause attribution A-G).

For every fixture the benchmark got wrong at Top-1 — plus correct-Top-1 cases
that were still not decided IDENTIFICADO (under-confidence) — re-run the full
pipeline and dump:

    ground truth | top1 | correct rank | similarities | margin |
    normalization | OCR evidence | geometric verification | photometrics | cause

Causes
------
  A embedding     truth not retrieved even with healthy photo/normalization
  B normalization quad detection failed (aspect-fallback / low confidence)
  C resolution    source photo too blurry/low-res
  D photometry    extreme dark/glare/washed-out and gamma views did not rescue
  E reprint       same artwork, tiny margin between set variants (<= 0.015)
  F fusion        truth competitive (rank 2..K) but fusion picked the twin
  G catalog       truth card absent from the local index/catalog

Usage:
    python scripts/analyze_failures.py --benchmark data/benchmark-after.json \
        --method hybrid-siglip2-base-384+sift
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.normalize import normalize_card
from recognizer.pipeline import Recognizer
from recognizer.store import CatalogStore

FIXTURES = "data/fixtures"
REPRINT_MARGIN = 0.015


def load_image(path: str) -> np.ndarray:
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def photometrics(img: np.ndarray) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return {
        "bright": round(float(gray.mean()), 1),
        "contrast": round(float(gray.std()), 1),
        "blurLap": round(blur, 1),
        "darkFrac": round(float((gray < 40).mean()), 3),
        "glareFrac": round(float((gray > 240).mean()), 3),
    }


def raw_rank(index, card, truth_key: str, topk: int = 300):
    """Rank/similarity of the truth card in raw multi-view retrieval."""
    results = index.search(card.image, topk, [card.image, card.rotated180])
    for i, (language, card_id, sim, _o) in enumerate(results):
        if f"{language}|{card_id}" == truth_key:
            return i + 1, float(sim)
    return 999, 0.0


def attribute(cause_inputs: dict) -> str:
    """Priority-ordered cause attribution (G > B > C > D > A > E > F)."""
    if not cause_inputs["truth_in_index"]:
        return "G"
    rank = cause_inputs["rank_raw"]
    if rank > 50:  # retrieval miss: why did the embedding not see it?
        if cause_inputs["norm_fallback"]:
            return "B"
        if cause_inputs["blur"] < 60:
            return "C"
        if cause_inputs["darkFrac"] > 0.40 or cause_inputs["bright"] < 45 or cause_inputs["contrast"] < 25:
            return "D"
        return "A"
    # truth retrieved (rank <= 50) but fusion did not put it first
    if cause_inputs["same_name"] and cause_inputs["gap"] <= REPRINT_MARGIN:
        return "E"
    return "F"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", default="data/benchmark-after.json")
    parser.add_argument("--method", default="")
    parser.add_argument("--model", default="")
    args = parser.parse_args()

    data = json.load(open(args.benchmark, encoding="utf-8"))
    if not args.method:
        args.method = next(iter(data))
    rows = data[args.method]["rows"]
    gt = {e["fixtureId"]: e for e in json.load(open(f"{FIXTURES}/ground-truth.json", encoding="utf-8"))}

    spec = args.method.split("+")[0].replace("hybrid-", "").replace("embed-", "")
    model = args.model or spec
    print(f"[failures] method={args.method} model={model} n={len(rows)}")

    recognizer = Recognizer(embedding_name=model, matcher_name="sift", catalog=CatalogStore())
    index = recognizer.index

    failures = [r for r in rows if not r["top1"]]
    underconf = [r for r in rows if r["top1"] and not r["identified"]]

    report = {"method": args.method, "model": model, "failures": [], "underconfident": []}
    cause_counts: dict[str, int] = {}

    def describe(c) -> str:
        if c is None:
            return "-"
        v = c.verification
        ver = f"ver={v.score:.2f}/{v.inliers}in" if v else "ver=None"
        return (f"{c.language}|{c.card_id} {c.name!r} #{c.local_id} "
                f"sim={c.visual_similarity:.3f} {ver} score={c.score:.1f}")

    for row in failures + underconf:
        fx = gt[row["fixtureId"]]
        truth_key = f"{fx['language']}|{fx['cardId']}"
        img = load_image(os.path.join(FIXTURES, fx["image"]))
        if img is None:
            continue
        card = normalize_card(img)
        photo = photometrics(img)
        rank_r, sim_truth_raw = raw_rank(index, card, truth_key)
        result = recognizer.recognize(img, fx.get("ocrOverride"), use_memory=False)

        fused_rank = 999
        for i, c in enumerate(result.candidates):
            if f"{c.language}|{c.card_id}" == truth_key:
                fused_rank = i + 1
                break
        top = result.candidates[0] if result.candidates else None
        truth_fused = next((c for c in result.candidates if f"{c.language}|{c.card_id}" == truth_key), None)
        gap = (top.visual_similarity - truth_fused.visual_similarity) if (top and truth_fused) else None
        same_name = bool(top and truth_fused and top.name.strip().lower() == truth_fused.name.strip().lower())

        cause_inputs = {
            "truth_in_index": truth_key in index.id_to_row,
            "rank_raw": rank_r,
            "norm_fallback": card.method in ("aspect-fallback", "aspect") or card.confidence < 0.25,
            "blur": photo["blurLap"],
            "darkFrac": photo["darkFrac"],
            "bright": photo["bright"],
            "contrast": photo["contrast"],
            "same_name": same_name,
            "gap": gap if gap is not None else 1.0,
        }
        cause = attribute(cause_inputs)
        entry = {
            "fixtureId": row["fixtureId"], "kind": "top1-miss" if not row["top1"] else "underconfident",
            "truth": {"language": fx["language"], "cardId": fx["cardId"], "name": fx["name"],
                      "set": fx.get("set", ""), "localId": fx.get("localId", "")},
            "decision": row["decision"],
            "top1": describe(top) if not row["top1"] else None,
            "truthFused": describe(truth_fused) if truth_fused else None,
            "rankRaw": rank_r, "rankFused": fused_rank, "simTruthRaw": round(sim_truth_raw, 4),
            "gap": round(gap, 4) if gap is not None else None,
            "normalization": {"method": card.method, "confidence": round(float(card.confidence), 2)},
            "photometrics": photo,
            "ocr": {"name": result.hints.name if result.hints else "",
                    "localId": result.hints.local_id if result.hints else "",
                    "nameConfidence": round(result.hints.name_confidence, 2) if result.hints else 0},
            "cause": cause,
        }
        (report["failures"] if not row["top1"] else report["underconfident"]).append(entry)
        if not row["top1"]:
            cause_counts[cause] = cause_counts.get(cause, 0) + 1

        print(f"\n--- {row['fixtureId']} [{entry['kind']}] cause={cause}")
        print(f"  truth : {truth_key} {fx['name']!r} #{fx.get('localId')} ({fx.get('set')})")
        if entry["top1"]:
            print(f"  top1  : {entry['top1']}")
        print(f"  truthFused(rank {fused_rank}): {entry['truthFused'] or 'not in fused candidates'}")
        print(f"  raw   : rank={rank_r} simTruth={sim_truth_raw:.3f} gap={entry['gap']}")
        print(f"  norm  : {card.method}/{card.confidence:.2f} | photo: {photo}")
        print(f"  ocr   : name={entry['ocr']['name']!r} ({entry['ocr']['nameConfidence']}) "
              f"num={entry['ocr']['localId']!r}")
        print(f"  decision={result.decision} evidence={result.evidence}")

    print(f"\n[failures] top1-miss={len(report['failures'])} underconfident={len(report['underconfident'])}")
    print(f"[failures] causes: " + " ".join(f"{k}={v}" for k, v in sorted(cause_counts.items())))

    out = f"data/failures-{model}.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(f"[failures] -> {out}")


if __name__ == "__main__":
    main()
