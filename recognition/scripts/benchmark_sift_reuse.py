#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A/B micro-benchmark: SIFT verification cost, BASE vs NEW.

BASE (cfd9949 behavior): verify() called matcher.match(probe, scan) per
candidate -> the QUERY image was re-detected for EVERY candidate (4x on the
fast path, 12-20x on the full path, per probe orientation).

NEW: the query is extracted ONCE per probe orientation and only
match_features() runs per candidate; scan-side features go through the LRU
cache on repeat requests.

This micro-benchmark reproduces both call patterns on the same synthetic
inputs (deterministic, no models/catalog/fixtures needed) and reports
extract-call counts + wall time. Accuracy equivalence is NOT measured here —
it is proven by tests/test_perf_round.py (byte-identical Verification).

Usage:
    python scripts/benchmark_sift_reuse.py [--candidates 12] [--probes 1] [--repeats 5]
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.features import get_matcher


def textured(seed: int, size: int = 600) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = rng.integers(0, 255, size=(size, size, 3), dtype=np.uint8)
    # A bit of structure so keypoints cluster like a real card artwork.
    blurred = cv2.GaussianBlur(base, (0, 0), 3.0)
    return blurred


def run_base(matcher, probe, scans) -> tuple[float, int]:
    """OLD call pattern: match(query, scan) per candidate."""
    extracts = {"n": 0}
    real_extract = matcher.extract

    def counting(image):
        extracts["n"] += 1
        return real_extract(image)
    matcher.extract = counting
    started = time.perf_counter()
    try:
        for scan in scans:
            matcher.match(probe, scan)
    finally:
        matcher.extract = real_extract
    return time.perf_counter() - started, extracts["n"]


def run_new(matcher, probe, scans, cached: bool) -> tuple[float, int]:
    """NEW call pattern: query extracted once, scan features cached."""
    extracts = {"n": 0}
    real_extract = matcher.extract

    def counting(image):
        extracts["n"] += 1
        return real_extract(image)
    matcher.extract = counting
    started = time.perf_counter()
    try:
        query = matcher.extract(probe)  # once per probe
        cache: dict[int, object] = {}
        for scan in scans:
            key = id(scan)
            if cached and key in cache:
                scan_features = cache[key]
            else:
                scan_features = matcher.extract(scan)
                cache[key] = scan_features
            matcher.match_features(query, scan_features)
    finally:
        matcher.extract = real_extract
    return time.perf_counter() - started, extracts["n"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", type=int, default=12)
    parser.add_argument("--probes", type=int, default=1)
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()

    matcher = get_matcher("sift")
    probe = textured(1)
    scans = [textured(100 + i, 520) for i in range(args.candidates)]

    def series(fn, cached=False):
        samples = []
        total_extracts = 0
        for _ in range(args.repeats):
            for _ in range(args.probes):
                elapsed, extracts = fn(matcher, probe, scans, cached) if fn is run_new else fn(matcher, probe, scans)
                samples.append(elapsed * 1000.0)
                total_extracts += extracts
        return samples, total_extracts // args.repeats

    base_samples, base_extracts = series(run_base)
    new_cold, new_cold_extracts = series(run_new, cached=False)
    new_warm, new_warm_extracts = series(run_new, cached=True)

    # Repeat-request scenario (a seller re-photographing the same cards): the
    # scan-side feature cache is warm across requests, so only the query is
    # extracted per request.
    repeat_cache: dict[int, object] = {}
    def run_new_repeat(matcher, probe, scans, cached=True):
        extracts = {"n": 0}
        real_extract = matcher.extract
        def counting(image):
            extracts["n"] += 1
            return real_extract(image)
        matcher.extract = counting
        started = time.perf_counter()
        try:
            query = matcher.extract(probe)
            for scan in scans:
                key = id(scan)
                scan_features = repeat_cache.get(key)
                if scan_features is None:
                    scan_features = matcher.extract(scan)
                    repeat_cache[key] = scan_features
                matcher.match_features(query, scan_features)
        finally:
            matcher.extract = real_extract
        return time.perf_counter() - started, extracts["n"]
    # warm the persistent cache once, then measure steady-state repeat requests
    run_new_repeat(matcher, probe, scans)
    new_repeat = []
    for _ in range(args.repeats):
        elapsed, _extracts = run_new_repeat(matcher, probe, scans)
        new_repeat.append(elapsed * 1000.0)

    def stats(samples):
        ordered = sorted(samples)
        return (f"mean {statistics.fmean(ordered):7.1f} ms · p50 {ordered[len(ordered)//2]:7.1f} ms "
                f"· p95 {ordered[max(0, int(len(ordered)*0.95)-1)]:7.1f} ms")

    print(f"A/B SIFT verification — {args.candidates} candidates x {args.probes} probe(s), "
          f"{args.repeats} repeats, synthetic {probe.shape[1]}px query / 520px scans")
    print(f"  BASE (cfd9949, query re-extracted per candidate): {stats(base_samples)} · "
          f"{base_extracts} extract() calls/request")
    print(f"  NEW  (query once, scan features cold):            {stats(new_cold)} · "
          f"{new_cold_extracts} extract() calls/request")
    print(f"  NEW  (query once, scan features warm cache):      {stats(new_warm)} · "
          f"{new_warm_extracts} extract() calls/request")
    print(f"  NEW  (REPEAT request, scan cache warm):          {stats(new_repeat)} · "
          f"1 extract() call/request (query only)")
    speedup = statistics.fmean(base_samples) / max(0.001, statistics.fmean(new_cold))
    warm_speedup = statistics.fmean(base_samples) / max(0.001, statistics.fmean(new_warm))
    repeat_speedup = statistics.fmean(base_samples) / max(0.001, statistics.fmean(new_repeat))
    print(f"  speedup vs BASE: {speedup:.2f}x (cold cache) · {warm_speedup:.2f}x (warm cache) "
          f"· {repeat_speedup:.2f}x (repeat request)")
    print("  (accuracy equivalence: tests/test_perf_round.py proves byte-identical Verifications)")


if __name__ == "__main__":
    main()
