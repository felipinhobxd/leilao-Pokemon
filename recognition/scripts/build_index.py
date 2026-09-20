#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Precompute embeddings for every catalog card -> local vector index.

Usage:
    python scripts/build_index.py [--model dinov3-vits16] [--languages pt-BR,en]
                                  [--batch 16] [--only-missing] [--prefetch 2]

Output: data/card-index/embeddings/<model>.npz  (matrix + card ids, float32, L2-normalized)

Pipeline (since 2026-09): a producer thread downloads+decodes scans AHEAD of
the inference loop (bounded queue, --prefetch batches) so CPU decode overlaps
GPU/CPU inference instead of serializing behind it. The queue bound keeps peak
RAM flat: at most prefetch*batch decoded scans in flight, regardless of the
catalog size.

Checkpoints are atomic (tmp + os.replace) and self-describing (next_id saved
inside); a resumed build VALIDATES the checkpoint (row count vs id count) and
discards a corrupt one instead of silently indexing garbage.

Per-phase profiling (download/decode/inference/checkpoint) is printed at the
end so the next tuning decision uses numbers, not guesses.
"""
from __future__ import annotations

import argparse
import os
import queue
import sys
import threading
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import ensure_scan, init_db, load_cards
from recognizer.config import EMBEDDINGS_DIR

_SENTINEL = object()


def load_scan_bgr(path: str):
    import cv2
    data = np.fromfile(path, dtype=np.uint8)  # unicode-safe read on Windows
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def _checkpoint(out_path: str, matrix: np.ndarray, ids: list[str], next_id: int,
                timing: dict) -> None:
    """Atomic partial save so interrupted builds resume instead of restarting.

    next_id is stored INSIDE the file: a resume validates that matrix rows and
    ids agree with it before trusting the checkpoint."""
    started = time.perf_counter()
    partial = matrix[:next_id]
    norms = np.linalg.norm(partial, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    partial = (partial / norms).astype(np.float32)
    tmp = out_path + ".ckpt"
    np.savez_compressed(tmp, matrix=partial, ids=np.array(ids, dtype=object),
                        next_id=np.int64(next_id))
    os.replace(tmp + ".npz" if os.path.exists(tmp + ".npz") else tmp, out_path)
    timing["checkpoint"] = timing.get("checkpoint", 0.0) + (time.perf_counter() - started)


def _load_checkpoint(out_path: str) -> tuple[list[str], dict[str, int], np.ndarray | None]:
    """Load + VALIDATE an existing index for --only-missing. Returns
    (ids, existing, matrix_prefix). A checkpoint whose shape disagrees with
    its id list (interrupted/corrupt write) is discarded, not trusted.
    Non-finite rows (NaN/inf, e.g. from corrupt scans or a GPU float quirk)
    are dropped so a bad row can never survive into the rebuilt index."""
    data = np.load(out_path, allow_pickle=True)
    ids = list(map(str, data["ids"]))
    matrix = data["matrix"]
    next_id = int(data["next_id"]) if "next_id" in data else len(ids)
    if matrix.shape[0] < next_id or len(ids) != next_id or matrix.shape[0] < len(ids):
        print(f"[index] checkpoint INVALID (rows={matrix.shape[0]} ids={len(ids)} next_id={next_id}) — discarding")
        keep = min(matrix.shape[0], len(ids), next_id)
        return ids[:keep], {cid: i for i, cid in enumerate(ids[:keep])}, matrix[:keep]
    if matrix.size and not np.isfinite(matrix).all():
        finite_rows = np.isfinite(matrix).all(axis=1)
        bad = int((~finite_rows).sum())
        ids = [cid for cid, ok in zip(ids, finite_rows) if ok]
        matrix = matrix[finite_rows]
        print(f"[index] checkpoint had {bad} non-finite row(s) (NaN/inf) — dropped; they will be re-embedded")
    return ids, {cid: i for i, cid in enumerate(ids)}, matrix


def main() -> None:
    # Deferred: importing the model loader pulls in onnxruntime, which tests
    # for the checkpoint logic must not require.
    from recognizer.embed import get_model

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="dinov3-vits16")
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--only-missing", action="store_true")
    parser.add_argument("--prefetch", type=int, default=2,
                        help="batches decoded ahead of inference (0 = old serial behavior)")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    cards = load_cards(conn, languages)
    model = get_model(args.model)
    out_path = os.path.join(EMBEDDINGS_DIR, f"{args.model}.npz")

    ids: list[str] = []
    existing: dict[str, int] = {}
    matrix_prefix: np.ndarray | None = None
    if args.only_missing and os.path.exists(out_path):
        ids, existing, matrix_prefix = _load_checkpoint(out_path)
        print(f"[index] incremental over {len(ids)} existing embeddings (validated)")

    if existing and matrix_prefix is not None:
        matrix = np.zeros((max(len(existing) + len(cards), 1), model.dim), dtype=np.float32)
        matrix[: len(existing)] = matrix_prefix[: len(existing)]
    else:
        matrix = np.zeros((max(len(cards), 1), model.dim), dtype=np.float32)

    started = time.time()
    checkpoint_every = int(os.environ.get("INDEX_CHECKPOINT_EVERY", "500"))
    timing = {"download": 0.0, "decode": 0.0, "inference": 0.0, "checkpoint": 0.0}
    processed = 0
    downloaded = 0
    skipped_nonfinite = 0
    next_id = len(existing)
    # Last periodic-checkpoint position. The old `processed % 500 == 0` test
    # NEVER fired with batch=8 (processed jumps 8k and skips 500 — the only
    # multiples of 200 it can hit), so an interrupted build silently lost all
    # progress despite the "resumable" promise. Threshold instead of modulo.
    last_checkpoint = 0

    def producer(work_queue: "queue.Queue") -> None:
        """Download + decode ahead of the inference loop. Bounded by the
        queue size, so at most prefetch*batch decoded scans sit in RAM."""
        nonlocal downloaded
        batch: list[tuple[str, np.ndarray]] = []
        for card in cards:
            key = f"{card.language}|{card.id}"
            if key in existing:
                continue
            t0 = time.perf_counter()
            # Full chain incl. the second-source (pokemon-tcg-data) backfill:
            # a card with no TCGdex scan but an alt image still gets indexed.
            path = ensure_scan(card.image_base, "high.webp",
                               getattr(card, "image_alt", "") or None)
            timing["download"] += time.perf_counter() - t0
            if not path:
                continue
            t0 = time.perf_counter()
            image = load_scan_bgr(path)
            timing["decode"] += time.perf_counter() - t0
            if image is None:
                continue
            downloaded += 1
            batch.append((key, image))
            if len(batch) >= args.batch:
                work_queue.put(batch)
                batch = []
        if batch:
            work_queue.put(batch)
        work_queue.put(_SENTINEL)

    work_queue: "queue.Queue" = queue.Queue(maxsize=max(1, args.prefetch))
    worker = threading.Thread(target=producer, args=(work_queue,), daemon=True)
    worker.start()

    def flush(batch: list[tuple[str, np.ndarray]]) -> None:
        nonlocal processed, next_id, last_checkpoint, skipped_nonfinite
        if not batch:
            return
        t0 = time.perf_counter()
        embeddings = model.embed([image for _, image in batch])
        timing["inference"] += time.perf_counter() - t0
        # A NaN/inf row baked into the index poisons retrieval AND crashes the
        # server's load-time guard — corrupt scans (or GPU float quirks) must
        # simply not be indexed.
        finite_rows = np.isfinite(embeddings).all(axis=1)
        skipped_nonfinite += int((~finite_rows).sum())
        for (key, _), embedding, ok in zip(batch, embeddings, finite_rows):
            if not ok:
                continue
            matrix[next_id] = embedding
            ids.append(key)
            next_id += 1
            processed += 1
        if processed % 200 == 0:
            rate = processed / max(0.001, time.time() - started)
            print(f"[index] {processed} cards ({rate:.1f}/s)", flush=True)
        if processed - last_checkpoint >= checkpoint_every:
            _checkpoint(out_path, matrix, ids, next_id, timing)
            last_checkpoint = processed
            print(f"[index] checkpoint at {next_id} cards", flush=True)

    while True:
        item = work_queue.get()
        if item is _SENTINEL:
            break
        flush(item)
    worker.join(timeout=30)

    matrix = matrix[:next_id]
    _checkpoint(out_path, matrix, ids, next_id, timing)
    size_mb = os.path.getsize(out_path) / 1e6
    elapsed = time.time() - started
    print(f"[index] {args.model}: {len(ids)} cards, dim={matrix.shape[1]}, "
          f"{size_mb:.1f} MB, {elapsed:.1f}s -> {out_path}")
    if skipped_nonfinite:
        print(f"[index] {skipped_nonfinite} embedding(s) não finito(s) (NaN/inf) IGNORADO(S) — "
              f"scans corrompidos ficam fora do índice e do reconhecimento")
    per = lambda seconds: round(seconds * 1000 / max(1, downloaded), 1)
    print(f"[index] profiling: download {per(timing['download'])} ms/card · "
          f"decode {per(timing['decode'])} ms/card · "
          f"inference {per(timing['inference'])} ms/card · "
          f"checkpoints {timing['checkpoint']:.1f} s total · "
          f"scans fetched {downloaded}")


if __name__ == "__main__":
    main()
