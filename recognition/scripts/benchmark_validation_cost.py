#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Micro-benchmark: the cost of the embedding numerical validation.

The 2026-09 stability round added explicit NaN/inf/norm checks to every
embedded chunk. This measures what that guard costs on VALID outputs (the
hot path), so the "speed not at the cost of accuracy" rule can be audited
with a number instead of a feeling.

Method: time the validation block (finite checks + norm + normalize + finite
re-check) on typical SigLIP2 chunk shapes ((2, 768) with chunk=2) versus the
pre-round code (norm with zero-guard + normalize). Inference itself is NOT
simulated: the comparison is validation-only cost, N=20000 iterations.

Run: python scripts/benchmark_validation_cost.py
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.embed import EMBEDDING_NORM_EPS


def old_path(embedding: np.ndarray) -> np.ndarray:
    """Pre-round normalization (PR #17/18 behavior)."""
    norms = np.linalg.norm(embedding, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (embedding / norms).astype(np.float32)


def new_path(embedding: np.ndarray) -> np.ndarray:
    """Stability-round validation + normalization (recognizer/embed.py)."""
    if not np.isfinite(embedding).all():
        raise ValueError("nan-or-inf")
    with np.errstate(invalid="ignore", divide="ignore"):
        norms = np.linalg.norm(embedding, axis=1, keepdims=True)
    if not np.isfinite(norms).all() or float(norms.min()) <= EMBEDDING_NORM_EPS:
        raise ValueError("zero-or-invalid-norm")
    normalized = (embedding / norms).astype(np.float32)
    if not np.isfinite(normalized).all():
        raise ValueError("post-normalize")
    return normalized


def bench(fn, array, iterations=20_000):
    started = time.perf_counter()
    for _ in range(iterations):
        fn(array)
    return (time.perf_counter() - started) / iterations * 1e6  # us/call


def main() -> None:
    rng = np.random.default_rng(11)
    for shape in [(1, 768), (2, 768), (4, 768)]:
        embedding = rng.normal(18.0, 4.0, size=shape).astype(np.float32)
        old_us = bench(old_path, embedding)
        new_us = bench(new_path, embedding)
        # Results must be bit-identical on valid inputs.
        np.testing.assert_array_equal(old_path(embedding), new_path(embedding))
        print(f"[validation-cost] chunk {shape}: old {old_us:.1f} us -> new {new_us:.1f} us "
              f"(delta {new_us - old_us:+.1f} us per chunk)")
    print("[validation-cost] outputs are bit-identical on valid inputs")
    print("[validation-cost] context: one SigLIP2 chunk inference is ~150-600 ms;")
    print("[validation-cost] the guard is 3-5 orders of magnitude below inference cost.")


if __name__ == "__main__":
    main()
