#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Precompute embeddings for every catalog card -> local vector index.

Usage:
    python scripts/build_index.py [--model dinov3-vits16] [--languages pt-BR,en]
                                  [--batch 16] [--only-missing]

Output: data/card-index/embeddings/<model>.npz  (matrix + card ids, float32, L2-normalized)
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import ensure_scan, init_db, load_cards
from recognizer.config import EMBEDDINGS_DIR
from recognizer.embed import get_model


def load_scan_bgr(path: str):
    import cv2
    data = np.fromfile(path, dtype=np.uint8)  # unicode-safe read on Windows
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def _checkpoint(out_path: str, matrix: np.ndarray, ids: list[str], next_id: int) -> None:
    """Atomic partial save so interrupted builds resume instead of restarting."""
    partial = matrix[:next_id]
    norms = np.linalg.norm(partial, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    partial = (partial / norms).astype(np.float32)
    tmp = out_path + ".ckpt"
    np.savez_compressed(tmp, matrix=partial, ids=np.array(ids, dtype=object))
    os.replace(tmp + ".npz" if os.path.exists(tmp + ".npz") else tmp, out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="dinov3-vits16")
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--only-missing", action="store_true")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    cards = load_cards(conn, languages)
    model = get_model(args.model)
    out_path = os.path.join(EMBEDDINGS_DIR, f"{args.model}.npz")

    ids: list[str] = []
    existing: dict[str, int] = {}
    if args.only_missing and os.path.exists(out_path):
        data = np.load(out_path, allow_pickle=True)
        ids = list(map(str, data["ids"]))
        existing = {cid: i for i, cid in enumerate(ids)}
        print(f"[index] incremental over {len(ids)} existing embeddings")

    matrix = np.zeros((max(len(existing) + len(cards), 1), model.dim), dtype=np.float32) if existing else \
        np.zeros((len(cards), model.dim), dtype=np.float32)
    if existing:
        data = np.load(out_path, allow_pickle=True)
        matrix[: len(existing)] = data["matrix"][: len(existing)]

    started = time.time()
    batch_images, batch_slots = [], []
    checkpoint_every = int(os.environ.get("INDEX_CHECKPOINT_EVERY", "500"))

    def flush():
        nonlocal batch_images, batch_slots
        if not batch_images:
            return
        embeddings = model.embed(batch_images)
        for slot, embedding in zip(batch_slots, embeddings):
            matrix[slot] = embedding
        batch_images, batch_slots = [], []

    processed = 0
    next_id = len(existing)
    for card in cards:
        key = f"{card.language}|{card.id}"
        if key in existing:
            continue
        path = ensure_scan(card.image_base, "high.webp")
        if not path:
            continue
        image = load_scan_bgr(path)
        if image is None:
            continue
        batch_images.append(image)
        batch_slots.append(next_id)
        ids.append(key)
        next_id += 1
        processed += 1
        if len(batch_images) >= args.batch:
            flush()
            if processed % 200 == 0:
                rate = processed / max(0.001, time.time() - started)
                print(f"[index] {processed} cards ({rate:.1f}/s)", flush=True)
            if processed % checkpoint_every == 0:
                _checkpoint(out_path, matrix, ids, next_id)
                print(f"[index] checkpoint at {next_id} cards", flush=True)
    flush()

    matrix = matrix[:next_id]
    _checkpoint(out_path, matrix, ids, next_id)
    size_mb = os.path.getsize(out_path) / 1e6
    print(f"[index] {args.model}: {len(ids)} cards, dim={matrix.shape[1]}, "
          f"{size_mb:.1f} MB, {time.time()-started:.1f}s -> {out_path}")


if __name__ == "__main__":
    main()
