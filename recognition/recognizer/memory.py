# -*- coding: utf-8 -*-
"""Local recognition memory: user-CONFIRMED examples only.

Rules (per project spec):
- Only confirmation/correction by the user creates ground truth.
- Predictions are NEVER auto-saved.
- With few examples: exemplar retrieval (embedding nearest neighbor), no fine-tuning.
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .config import BASE_DIR

MEMORY_FILE = os.path.join(BASE_DIR, "memory.json")
MEMORY_EMBEDDINGS = os.path.join(BASE_DIR, "memory-embeddings.npz")
MEMORY_IMAGES = os.path.join(BASE_DIR, "memory-images")
os.makedirs(MEMORY_IMAGES, exist_ok=True)

_lock = threading.Lock()


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
            "localId": self.local_id,
            "cardNumber": f"{self.local_id}/{self.denominator}" if self.denominator else self.local_id,
            "confirmedAt": self.confirmed_at, "imageFile": self.image_file, "note": self.note,
        }


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
    with _lock:
        with open(MEMORY_FILE, "w", encoding="utf-8") as fh:
            json.dump([e.to_dict() for e in examples], fh, ensure_ascii=False, indent=2)


def add_example(card: dict, image_bytes: bytes, embedding: np.ndarray, note: str = "") -> MemoryExample:
    examples = load_examples()
    example_id = f"mem-{int(time.time() * 1000)}"
    image_file = f"{example_id}.jpg"
    path = os.path.join(MEMORY_IMAGES, image_file)
    with open(path, "wb") as fh:
        fh.write(image_bytes)
    example = MemoryExample(
        id=example_id, card_id=card["cardId"], language=card["language"], name=card["name"],
        set_id=card.get("setId", ""), set_name=card.get("setName", ""),
        local_id=card.get("localId", ""), denominator=card.get("denominator"),
        confirmed_at=time.time(), image_file=image_file, note=note,
    )
    examples.append(example)
    save_examples(examples)
    # append embedding
    ids, matrix = _load_embeddings()
    ids = list(ids) + [example_id]
    matrix = np.vstack([matrix, embedding.astype(np.float32)]) if len(ids) > 1 else embedding.astype(np.float32).reshape(1, -1)
    np.savez_compressed(MEMORY_EMBEDDINGS, ids=np.array(ids, dtype=object), matrix=matrix)
    return example


def _load_embeddings() -> tuple[list[str], np.ndarray]:
    if not os.path.exists(MEMORY_EMBEDDINGS):
        return [], np.zeros((0, 1), dtype=np.float32)
    data = np.load(MEMORY_EMBEDDINGS, allow_pickle=True)
    return list(map(str, data["ids"])), data["matrix"].astype(np.float32)


def lookup(embedding: np.ndarray, threshold: float = 0.80) -> Optional[tuple[MemoryExample, float]]:
    """Nearest confirmed example above threshold."""
    examples = load_examples()
    if not examples:
        return None
    ids, matrix = _load_embeddings()
    if matrix.shape[0] == 0 or matrix.shape[0] != len(ids):
        return None
    scores = (matrix @ embedding.astype(np.float32)).ravel()
    best = int(np.argmax(scores))
    if scores[best] < threshold:
        return None
    by_id = {e.id: e for e in examples}
    example = by_id.get(ids[best])
    if example is None:
        return None
    return example, float(scores[best])
