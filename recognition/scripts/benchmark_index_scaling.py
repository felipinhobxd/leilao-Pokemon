#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Index scaling measurement: retrieval + verification latency vs catalog size.

The catalog grows from ~26k (en+pt of the previous round) to ~66k rows
(en+ja+pt+es+ptcg inserts). Route A is a brute-force cosine search over the
whole matrix, so the whole question of 'does the big catalog destroy the
latency' reduces to numbers: how does search() scale with matrix rows?

Measured here on SYNTHETIC matrices (random unit vectors, same dimension as
SigLIP2-base-384) at the real catalog sizes, with the real query path shape
(2 orientations x N photometric views per request). No models are loaded —
this isolates the retrieval arithmetic, which is what scales with the catalog.
"""
from __future__ import annotations

import time

import numpy as np

DIM = 768  # siglip2-base-384
VIEWS = 4  # 2 orientations x 2 photometric variants (the real request shape)


def bench(rows: int, repeats: int = 30) -> dict:
    rng = np.random.default_rng(42)
    matrix = rng.normal(size=(rows, DIM)).astype(np.float32)
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
    query = rng.normal(size=(VIEWS, DIM)).astype(np.float32)
    query /= np.linalg.norm(query, axis=1, keepdims=True)
    # warmup
    for _ in range(3):
        scores = query @ matrix.T
        best = np.argmax(scores, axis=0)
        order = np.argsort(-scores[best, np.arange(scores.shape[1])])[:50]
    times = []
    for _ in range(repeats):
        t0 = time.perf_counter()
        scores = query @ matrix.T                      # [n_views, N]
        best_view = np.argmax(scores, axis=0)          # winning view per card
        columns = np.arange(scores.shape[1])
        best_scores = scores[best_view, columns]
        order = np.argsort(-best_scores)[:50]          # Top-50 (TOPK default)
        times.append((time.perf_counter() - t0) * 1000)
    times = sorted(times)
    return {"rows": rows, "meanMs": float(np.mean(times)),
            "p95Ms": times[int(0.95 * (len(times) - 1))]}


def main() -> None:
    print(f"{'rows':>8} {'meanMs':>8} {'p95Ms':>8}   (Top-50 of {VIEWS} views, dim={DIM})")
    # Real catalog sizes: previous round (en+pt with scans), the full current
    # catalog with scans (en+ja+pt+es), and a 2x headroom point.
    for rows in (25412, 49565, 66047, 100000, 150000):
        r = bench(rows)
        print(f"{r['rows']:>8} {r['meanMs']:>8.1f} {r['p95Ms']:>8.1f}")


if __name__ == "__main__":
    main()
