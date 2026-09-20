# -*- coding: utf-8 -*-
"""Local recognition memory: user-CONFIRMED examples only.

Rules (per project spec):
- Only confirmation/correction by the user creates ground truth.
- Predictions are NEVER auto-saved.
- With few examples: exemplar retrieval (embedding nearest neighbor), no fine-tuning.

Calibration (P0, 2026-09-16): SigLIP2 cosine similarity between DIFFERENT cards
concentrates around 0.886 median / 0.940 p95 (full pt-BR index, 12.7k cards),
so a match threshold near 0.80 is unsafely below the impostor distribution and
would produce false memories. Threshold and margin come from config.py and are
calibrated by scripts/benchmark_memory.py (positives: same card under different
degradations; negatives: different, visually similar cards). Memory is AUXILIARY
evidence: it must never, by itself, produce an IDENTIFICADO decision.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .config import (BASE_DIR, MEMORY_MARGIN, MEMORY_MAX_EXAMPLES,
                     MEMORY_MIN_SIMILARITY)

MEMORY_FILE = os.path.join(BASE_DIR, "memory.json")
MEMORY_EMBEDDINGS = os.path.join(BASE_DIR, "memory-embeddings.npz")
MEMORY_IMAGES = os.path.join(BASE_DIR, "memory-images")
os.makedirs(MEMORY_IMAGES, exist_ok=True)

_lock = threading.Lock()
# add_example is load -> append -> save on THREE files; a plain per-save lock
# still loses updates between the load and the save. The write lock covers the
# whole read-modify-write so two simultaneous confirmations cannot clobber
# each other.
_write_lock = threading.Lock()

# Read cache for the REQUEST path: lookup() used to json.load + np.load
# (compressed) BOTH files on EVERY call — twice per /recognize (two
# orientations) — even with zero confirmed examples. The files only change
# through add/remove (atomic tmp+replace) or manual edits; the signature
# (mtime_ns + size of both files) makes any change a guaranteed miss, and
# add/remove also invalidate explicitly so even a same-nanosecond rewrite
# cannot serve a stale view.
_read_lock = threading.Lock()
_read_cache: Optional[tuple[list[MemoryExample], list[str], np.ndarray]] = None
_read_cache_sig: Optional[tuple] = None


def _file_signature() -> tuple:
    sig = []
    for path in (MEMORY_FILE, MEMORY_EMBEDDINGS):
        try:
            st = os.stat(path)
            sig.append((st.st_mtime_ns, st.st_size))
        except OSError:
            sig.append(None)
    return tuple(sig)


def _invalidate_read_cache() -> None:
    global _read_cache, _read_cache_sig
    with _read_lock:
        _read_cache = None
        _read_cache_sig = None


def _load_state() -> tuple[list[MemoryExample], list[str], np.ndarray]:
    """(examples, ids, matrix) with the process-level read cache."""
    global _read_cache, _read_cache_sig
    sig = _file_signature()
    with _read_lock:
        if _read_cache is not None and _read_cache_sig == sig:
            return _read_cache[0], list(_read_cache[1]), _read_cache[2]
    examples = load_examples()
    if not examples:
        ids, matrix = [], np.zeros((0, 1), dtype=np.float32)
    else:
        ids, matrix = _load_embeddings()
    with _read_lock:
        _read_cache = (examples, ids, matrix)
        _read_cache_sig = sig
    return examples, list(ids), matrix


@dataclass
class MemoryExample:
    id: str
    card_id: str
    language: str
    name: str
    set_id: str
    set_name: str
    local_id: str
    denominator: Optional[int]
    confirmed_at: float
    image_file: str
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id, "cardId": self.card_id, "language": self.language,
            "name": self.name, "setId": self.set_id, "setName": self.set_name,
            "localId": self.local_id, "denominator": self.denominator,
            "cardNumber": f"{self.local_id}/{self.denominator}" if self.denominator else self.local_id,
            "confirmedAt": self.confirmed_at, "imageFile": self.image_file, "note": self.note,
        }


@dataclass
class MemoryMatch:
    """A calibrated nearest-confirmed-example hit."""
    example: MemoryExample
    similarity: float
    runner_up_similarity: float  # best DIFFERENT-card example (0.0 when none)

    @property
    def margin(self) -> float:
        if self.runner_up_similarity <= 0.0:
            return 1.0
        return self.similarity - self.runner_up_similarity


def load_examples() -> list[MemoryExample]:
    if not os.path.exists(MEMORY_FILE):
        return []
    with open(MEMORY_FILE, encoding="utf-8") as fh:
        raw = json.load(fh)
    return [MemoryExample(
        id=item["id"], card_id=item["cardId"], language=item["language"], name=item["name"],
        set_id=item.get("setId", ""), set_name=item.get("setName", ""), local_id=item.get("localId", ""),
        denominator=item.get("denominator"), confirmed_at=item.get("confirmedAt", 0),
        image_file=item.get("imageFile", ""), note=item.get("note", ""),
    ) for item in raw]


def save_examples(examples: list[MemoryExample]) -> None:
    """Atomic write: readers never observe a truncated memory.json."""
    tmp = MEMORY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump([e.to_dict() for e in examples], fh, ensure_ascii=False, indent=2)
    os.replace(tmp, MEMORY_FILE)


def _atomic_savez(path: str, **arrays) -> None:
    # numpy appends ".npz" to string paths that lack it, which would defeat
    # the tmp+replace dance — pass an open file handle instead.
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        np.savez_compressed(fh, **arrays)
    os.replace(tmp, path)


def add_example(card: dict, image_bytes: bytes, embedding: np.ndarray, note: str = "") -> MemoryExample:
    """Store a USER-CONFIRMED example. Idempotent on identical image content.

    - dedupe: the same image bytes confirmed again for the same card return the
      existing example (no duplicate rows/embeddings);
    - atomic: memory.json / embeddings npz / image file all move into place
      with os.replace, so a crash never leaves a partial state;
    - bounded: beyond MEMORY_MAX_EXAMPLES the oldest entries are evicted.
    """
    digest = hashlib.sha256(image_bytes).hexdigest()
    with _write_lock:
        examples = load_examples()
        existing = next((e for e in examples
                         if e.card_id == card["cardId"] and e.language == card["language"]
                         and _example_digest(e) == digest), None)
        if existing is not None:
            return existing
        # Collision-proof id: the old time-based id collided when two
        # confirmations landed in the same millisecond (batch UI), which made
        # remove_example() delete BOTH examples at once.
        example_id = f"mem-{int(time.time() * 1000)}-{os.urandom(5).hex()}"
        image_file = f"{example_id}.jpg"
        path = os.path.join(MEMORY_IMAGES, image_file)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(image_bytes)
        os.replace(tmp, path)
        example = MemoryExample(
            id=example_id, card_id=card["cardId"], language=card["language"], name=card["name"],
            set_id=card.get("setId", ""), set_name=card.get("setName", ""),
            local_id=card.get("localId", ""), denominator=card.get("denominator"),
            confirmed_at=time.time(), image_file=image_file, note=note,
        )
        examples.append(example)
        while len(examples) > MEMORY_MAX_EXAMPLES:
            oldest = examples[0]
            examples = examples[1:]
            _try_remove(os.path.join(MEMORY_IMAGES, oldest.image_file))
        save_examples(examples)
        # append embedding (rebuild without evicted examples)
        ids, matrix = _load_embeddings()
        keep_ids = [e.id for e in examples if e.id in set(ids)]
        if keep_ids:
            keep = [ids.index(i) for i in keep_ids]
            matrix = matrix[keep]
            ids = keep_ids
        ids = list(ids) + [example_id]
        matrix = (np.vstack([matrix, embedding.astype(np.float32)])
                  if matrix.size and matrix.shape[0] == len(ids) - 1
                  else embedding.astype(np.float32).reshape(1, -1))
        _atomic_savez(MEMORY_EMBEDDINGS, ids=np.array(ids, dtype=object), matrix=matrix)
        _invalidate_read_cache()
        return example


def remove_example(example_id: str) -> int:
    """Atomically remove a confirmed example from ALL three stores
    (memory.json, memory-embeddings.npz, memory-images/) under the write lock.

    Returns the number of remaining examples; raises KeyError when the id is
    unknown. The lock + atomic saves keep concurrent confirm/delete pairs
    consistent: a delete can never resurrect an example that a concurrent
    confirm just removed, and the embeddings file is never left half-written
    (tmp + os.replace on both files).
    """
    with _write_lock:
        examples = load_examples()
        if not any(e.id == example_id for e in examples):
            raise KeyError(example_id)
        remaining = [e for e in examples if e.id != example_id]
        save_examples(remaining)
        ids, matrix = _load_embeddings()
        keep = [i for i, mid in enumerate(ids) if mid != example_id]
        _atomic_savez(MEMORY_EMBEDDINGS,
                      ids=np.array([ids[i] for i in keep], dtype=object),
                      matrix=matrix[keep])
        for example in examples:
            if example.id == example_id:
                _try_remove(os.path.join(MEMORY_IMAGES, example.image_file))
        _invalidate_read_cache()
        return len(remaining)


def _example_digest(example: MemoryExample) -> Optional[str]:
    path = os.path.join(MEMORY_IMAGES, example.image_file)
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


def _try_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _load_embeddings() -> tuple[list[str], np.ndarray]:
    if not os.path.exists(MEMORY_EMBEDDINGS):
        return [], np.zeros((0, 1), dtype=np.float32)
    data = np.load(MEMORY_EMBEDDINGS, allow_pickle=True)
    return list(map(str, data["ids"])), data["matrix"].astype(np.float32)


def lookup(embedding: np.ndarray, threshold: Optional[float] = None,
           margin: Optional[float] = None) -> Optional[MemoryMatch]:
    """Nearest confirmed example above the calibrated threshold AND margin.

    The margin compares the best example against the best example of a
    DIFFERENT card: with few confirmed examples an impostor can still sit
    above the absolute threshold, and an ambiguous 0.001 lead must not become
    a "memory match".
    """
    threshold = MEMORY_MIN_SIMILARITY if threshold is None else threshold
    margin = MEMORY_MARGIN if margin is None else margin
    examples, ids, matrix = _load_state()
    if not examples:
        return None
    if matrix.shape[0] == 0 or matrix.shape[0] != len(ids):
        return None
    scores = (matrix @ embedding.astype(np.float32)).ravel()
    by_id = {e.id: e for e in examples}
    order = np.argsort(-scores)
    best_idx = int(order[0])
    example = by_id.get(ids[best_idx])
    if example is None:
        return None
    similarity = float(scores[best_idx])
    if similarity < threshold:
        return None
    runner_up = 0.0
    for idx in order[1:]:
        other = by_id.get(ids[int(idx)])
        if other is None or (other.card_id, other.language) == (example.card_id, example.language):
            continue  # more examples of the SAME card are not competition
        runner_up = float(scores[int(idx)])
        break
    if runner_up > 0.0 and (similarity - runner_up) < margin:
        return None  # ambiguous against a different card
    return MemoryMatch(example=example, similarity=similarity, runner_up_similarity=runner_up)
