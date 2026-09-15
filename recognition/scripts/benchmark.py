#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reproducible recognition benchmark / bake-off.

Methods
-------
- ocr-only            : current architecture's core (OCR gatekeeper -> catalog)
- embed-<model>       : pure global retrieval (Route A without verification)
- embed-<model>+<matcher> : retrieval + geometric verification
- hybrid-<model>+<matcher> : full two-route fusion (Route A + Route B + verification)

Metrics: Top-1/3/5/10 exact card, name/set/number/language accuracy,
decision quality (IDENTIFICADO precision), false-high-confidence, latency avg/p95.

DATA LEAKAGE NOTE: fixtures are degradations of the official scans the index
embeds, so this is a SYNTHETIC REGRESSION benchmark — it detects code
regressions, it does not estimate real-world accuracy. Thresholds must be
calibrated on the `calibration` split (calibrate_thresholds.py --split
calibration) and this benchmark reported on the `validation` split
(--split validation) or on the full set for regression comparison; never
calibrate and report on the same rows. Real-photo sets (dev + held-out) are
reported separately.

Usage:
    python scripts/benchmark.py --fixtures data/fixtures --split validation
        --methods hybrid-siglip2-base-384+sift
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.config import DEFAULT_CALIBRATION, EMBEDDING_CALIBRATION, DEFAULT_EMBEDDING
from recognizer.hints import apply_override, extract_hints
from recognizer.normalize import normalize_card
from recognizer.ocr import PpOcr
from recognizer.pipeline import Candidate, Recognizer
from recognizer.store import CatalogStore


def load_image(path: str) -> np.ndarray:
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def match_metric(pred_card, truth: dict, field: str) -> bool:
    if pred_card is None:
        return False
    if field == "card":
        return pred_card.card_id == truth["cardId"] and pred_card.language == truth["language"]
    if field == "name":
        return pred_card.name.strip().lower() == truth["name"].strip().lower()
    if field == "set":
        return pred_card.set_id == truth.get("set_id") or pred_card.set_name.strip().lower() == str(truth.get("set", "")).strip().lower()
    if field == "number":
        return pred_card.local_id.lstrip("0") == str(truth.get("localId", "")).lstrip("0")
    if field == "language":
        return pred_card.language == truth["language"]
    return False


def evaluate(truth: dict, result) -> dict:
    candidates = result.candidates if hasattr(result, "candidates") else result["candidates"]
    decision = result.decision if hasattr(result, "decision") else result["decision"]
    best = result.best if hasattr(result, "best") else result["best"]
    exact = [match_metric(c, truth, "card") for c in candidates[:10]]
    return {
        "top1": exact[0] if exact else False,
        "top3": any(exact[:3]),
        "top5": any(exact[:5]),
        "top10": any(exact[:10]),
        "name": match_metric(best, truth, "name") if best else False,
        "set": match_metric(best, truth, "set") if best else False,
        "number": match_metric(best, truth, "number") if best else False,
        "language": match_metric(best, truth, "language") if best else False,
        "decision": decision,
        "false_high": decision == "IDENTIFICADO" and not (exact[0] if exact else False),
        "identified": decision == "IDENTIFICADO",
    }


class OcrOnlyMethod:
    """Emulates the current production architecture: OCR -> catalog -> top pick."""

    name = "ocr-only"

    def __init__(self, store: CatalogStore):
        self.store = store
        self.ocr = PpOcr.instance()
        self.last_hints = None

    def recognize(self, image: np.ndarray, ocr_override=None):
        card = normalize_card(image)
        ocr0 = self.ocr.read_card(card.image)
        ocr180 = self.ocr.read_card(card.rotated180)
        s0 = ocr0.confidence_score
        s1 = ocr180.confidence_score
        best = ocr0 if s0 >= s1 else ocr180
        hints = extract_hints(best)
        if ocr_override:
            apply_override(hints, ocr_override)
        candidates = self.store.text_candidates(hints) if (hints.name or hints.local_id) else []
        # emulate the site's decision: needs strong name+number evidence
        decision = "NAO_IDENTIFICADO"
        if candidates:
            top = candidates[0]
            strong = top.ocr_name_similarity >= 0.9 and hints.name_confidence >= 0.6
            medium = top.ocr_name_similarity >= 0.72 or (top.ocr_number_match and hints.number_confidence >= 0.6)
            decision = "IDENTIFICADO" if strong else "PROVAVEL" if medium else "REVISAR"
        class R:  # lightweight result shim
            pass
        r = R()
        r.candidates = candidates
        r.best = candidates[0] if candidates else None
        r.decision = decision
        self.last_hints = hints
        return r


class EmbedOnlyMethod:
    """Pure global retrieval (Route A)."""

    def __init__(self, recognizer: Recognizer):
        self.recognizer = recognizer
        self.name = f"embed-{recognizer.embedding_name}"
        self.cal = EMBEDDING_CALIBRATION.get(recognizer.embedding_name, DEFAULT_CALIBRATION)

    def recognize(self, image: np.ndarray, ocr_override=None):
        card = normalize_card(image)
        candidates, _ = self.recognizer.route_a(card)
        candidates = sorted(candidates, key=lambda c: -c.visual_similarity)
        class R: pass
        r = R()
        r.candidates = candidates
        r.best = candidates[0] if candidates else None
        top = candidates[0] if candidates else None
        sim_gap = 0.0
        if len(candidates) >= 2:
            sim_gap = candidates[0].visual_similarity - candidates[1].visual_similarity
        if top and top.visual_similarity >= self.cal["strong"] and sim_gap >= 0.02:
            r.decision = "IDENTIFICADO"
        elif top and top.visual_similarity >= self.cal["medium"]:
            r.decision = "PROVAVEL"
        elif top:
            r.decision = "REVISAR"
        else:
            r.decision = "NAO_IDENTIFICADO"
        return r


class HybridMethod:
    def __init__(self, recognizer: Recognizer, label: str):
        self.recognizer = recognizer
        self.name = label

    def recognize(self, image: np.ndarray, ocr_override=None):
        return self.recognizer.recognize(image, ocr_override, use_memory=False)


def run_method(method, fixtures: list[dict], fixtures_dir: str) -> dict:
    rows = []
    latencies = []
    for fixture in fixtures:
        path = os.path.join(fixtures_dir, fixture["image"])
        image = load_image(path)
        if image is None:
            continue
        t0 = time.time()
        result = method.recognize(image, fixture.get("ocrOverride"))
        elapsed = (time.time() - t0) * 1000
        latencies.append(elapsed)
        metrics = evaluate(fixture, result)
        metrics["fixtureId"] = fixture["fixtureId"]
        metrics["elapsedMs"] = elapsed
        rows.append(metrics)
    n = max(1, len(rows))
    lat_sorted = sorted(latencies)
    p95 = lat_sorted[int(0.95 * (len(lat_sorted) - 1))] if lat_sorted else 0
    summary = {
        "method": method.name,
        "n": len(rows),
        "top1": 100 * sum(r["top1"] for r in rows) / n,
        "top3": 100 * sum(r["top3"] for r in rows) / n,
        "top5": 100 * sum(r["top5"] for r in rows) / n,
        "top10": 100 * sum(r["top10"] for r in rows) / n,
        "name": 100 * sum(r["name"] for r in rows) / n,
        "set": 100 * sum(r["set"] for r in rows) / n,
        "number": 100 * sum(r["number"] for r in rows) / n,
        "language": 100 * sum(r["language"] for r in rows) / n,
        "identified": 100 * sum(r["identified"] for r in rows) / n,
        "falseHighConfidence": 100 * sum(r["false_high"] for r in rows) / n,
        "latencyAvgMs": statistics.mean(latencies) if latencies else 0,
        "latencyP95Ms": p95,
    }
    return {"summary": summary, "rows": rows}


def load_split(fixtures_dir: str, split: str) -> list[dict]:
    """Load ground truth filtered by the deterministic card-disjoint split."""
    import json as _json
    with open(os.path.join(fixtures_dir, "ground-truth.json"), encoding="utf-8") as fh:
        fixtures = _json.load(fh)
    if split == "all":
        return fixtures
    manifest_path = os.path.join(fixtures_dir, "split-manifest.json")
    if not os.path.exists(manifest_path):
        sys.exit(f"[bench] --split {split} requested but {manifest_path} is missing; "
                 f"run scripts/split_fixtures.py --fixtures {fixtures_dir} first")
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = _json.load(fh)
    allowed = set(manifest.get(split, []))
    selected = [f for f in fixtures if f["fixtureId"] in allowed]
    print(f"[bench] split={split}: {len(selected)}/{len(fixtures)} fixtures "
          f"({len(allowed)} ids in manifest)")
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", default="data/fixtures")
    parser.add_argument("--split", default="all",
                        choices=("all", "calibration", "validation", "heldout"),
                        help="fixtures split (see split_fixtures.py); 'all' = full "
                             "synthetic regression set for apples-to-apples "
                             "comparison with previous runs")
    parser.add_argument("--methods", default="")
    parser.add_argument("--embedding", default=DEFAULT_EMBEDDING)
    parser.add_argument("--matcher", default="sift")
    parser.add_argument("--out", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()

    fixtures_dir = args.fixtures
    fixtures = load_split(fixtures_dir, args.split)
    if args.offset:
        fixtures = fixtures[args.offset:]
    if args.limit:
        fixtures = fixtures[: args.limit]
    print(f"[bench] {len(fixtures)} fixtures (synthetic regression benchmark, "
          f"fixtures={fixtures_dir}, split={args.split})")

    store = CatalogStore()
    methods = []

    method_names = [m.strip() for m in args.methods.split(",") if m.strip()] if args.methods else \
        ["ocr-only", f"embed-{args.embedding}", f"embed-{args.embedding}+{args.matcher}", f"hybrid-{args.embedding}+{args.matcher}"]

    recognizer: Recognizer | None = None
    for name in method_names:
        if name == "ocr-only":
            methods.append(OcrOnlyMethod(store))
        elif name.startswith("embed-") and "+" not in name:
            model = name[len("embed-"):]
            recognizer = Recognizer(embedding_name=model, matcher_name=args.matcher, catalog=store)
            methods.append(EmbedOnlyMethod(recognizer))
        elif name.startswith("embed-") and "+" in name:
            model, matcher = name[len("embed-"):].split("+", 1)
            recognizer = Recognizer(embedding_name=model, matcher_name=matcher, catalog=store)
            methods.append(HybridMethod(recognizer, name))
        elif name.startswith("hybrid-"):
            spec = name[len("hybrid-"):]
            model, matcher = (spec.split("+", 1) + [args.matcher])[:2] if "+" in spec else (spec, args.matcher)
            recognizer = Recognizer(embedding_name=model, matcher_name=matcher, catalog=store)
            methods.append(HybridMethod(recognizer, name))
        else:
            raise ValueError(f"Unknown method {name}")

    all_results = {}
    for method in methods:
        print(f"[bench] running {method.name} …")
        result = run_method(method, fixtures, fixtures_dir)
        s = result["summary"]
        s["split"] = args.split
        s["benchmark"] = "synthetic-regression"
        print(f"  Top1={s['top1']:.1f}% Top5={s['top5']:.1f}% name={s['name']:.1f}% "
              f"set={s['set']:.1f}% lang={s['language']:.1f}% identified={s['identified']:.1f}% "
              f"falseHigh={s['falseHighConfidence']:.2f}% lat={s['latencyAvgMs']:.0f}/{s['latencyP95Ms']:.0f}ms")
        all_results[method.name] = result

    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(all_results, fh, ensure_ascii=False, indent=2)
        print(f"[bench] detailed results -> {args.out}")


if __name__ == "__main__":
    main()
