# -*- coding: utf-8 -*-
"""ONNX global embedding models with a shared interface.

Models (bake-off candidates)
---------------------------
- dinov2-small        (224, CLS, 384-d)   — current project baseline
- dinov3-vits16       (var, CLS, 384-d)   — modern SSL backbone
- dinov3-vitb16       (var, CLS, 768-d)
- siglip2-base-384    (384, image_embeds, 768-d)

DINOv3 supports dynamic input resolution (RoPE); we evaluate at several sizes.
"""
from __future__ import annotations

import os
import threading
from typing import Optional

import numpy as np
import onnxruntime as ort

from .config import MODELS_DIR

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
HALF_MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32)
HALF_STD = np.array([0.5, 0.5, 0.5], dtype=np.float32)

_SESSION_OPTS = ort.SessionOptions()
_SESSION_OPTS.intra_op_num_threads = max(1, (os.cpu_count() or 2))
_SESSION_OPTS.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL


def _providers() -> list[str]:
    available = ort.get_available_providers()
    preferred = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    return [p for p in preferred if p in available]


class EmbeddingModel:
    """Shared interface: embed(batch of BGR uint8 images) -> L2-normalized float32 [N, D]."""

    def __init__(self, name: str, size: int, kind: str, dim: int):
        self.name, self.size, self.kind, self.dim = name, size, kind, dim
        self._session: Optional[ort.InferenceSession] = None
        self._lock = threading.Lock()

    def _ensure(self) -> ort.InferenceSession:
        if self._session is not None:
            return self._session
        with self._lock:
            if self._session is not None:
                return self._session
            path = self._model_path()
            self._session = ort.InferenceSession(path, sess_options=_SESSION_OPTS, providers=_providers())
            return self._session

    def _model_path(self) -> str:
        if self.name.startswith("dinov3-vits16"):
            return os.path.join(MODELS_DIR, "d3s", "model.onnx")
        if self.name.startswith("dinov3-vitb16"):
            return os.path.join(MODELS_DIR, "d3b", "model.onnx")
        if self.name == "dinov2-small":
            return os.path.join(MODELS_DIR, "dinov2-small.onnx")
        if self.name == "siglip2-base-384":
            return os.path.join(MODELS_DIR, "siglip2-base-384.onnx")
        raise ValueError(f"Unknown embedding model {self.name}")

    def _preprocess(self, bgr: np.ndarray) -> np.ndarray:
        import cv2
        resized = cv2.resize(bgr, (self.size, self.size), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        if self.kind in ("dinov2", "dinov3"):
            rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
        else:  # siglip2
            rgb = (rgb - HALF_MEAN) / HALF_STD
        chw = np.transpose(rgb, (2, 0, 1))
        return np.ascontiguousarray(chw[np.newaxis, ...], dtype=np.float32)

    def embed(self, images: list[np.ndarray]) -> np.ndarray:
        """Embed a batch. Processed in chunks (default 2) to keep peak
        activation memory low on RAM-constrained machines; chunking does not
        change the output values (no cross-image interaction in the graph)."""
        chunk = int(os.environ.get("RECOGNITION_EMBED_CHUNK", "2"))
        outputs = [self._embed_chunk(images[i:i + chunk]) for i in range(0, len(images), chunk)]
        return np.concatenate(outputs, axis=0)

    def _embed_chunk(self, images: list[np.ndarray]) -> np.ndarray:
        session = self._ensure()
        batch = np.concatenate([self._preprocess(img) for img in images], axis=0)
        if self.kind in ("dinov2", "dinov3"):
            outs = session.run(["last_hidden_state"], {"pixel_values": batch})
            tokens = outs[0]
            embedding = tokens[:, 0, :]  # CLS token
        else:  # siglip2 full multimodal: feed dummy text, use image_embeds
            dummy_ids = np.zeros((1, 1), dtype=np.int64)
            outs = session.run(["image_embeds"], {"input_ids": dummy_ids, "pixel_values": batch})
            embedding = outs[0]
        norms = np.linalg.norm(embedding, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return (embedding / norms).astype(np.float32)

    def embed_one(self, image: np.ndarray) -> np.ndarray:
        return self.embed([image])[0]


MODELS: dict[str, EmbeddingModel] = {
    "dinov2-small": EmbeddingModel("dinov2-small", 224, "dinov2", 384),
    "dinov3-vits16": EmbeddingModel("dinov3-vits16", 224, "dinov3", 384),
    "dinov3-vits16-392": EmbeddingModel("dinov3-vits16-392", 392, "dinov3", 384),
    "dinov3-vitb16": EmbeddingModel("dinov3-vitb16", 224, "dinov3", 768),
    "dinov3-vitb16-392": EmbeddingModel("dinov3-vitb16-392", 392, "dinov3", 768),
    "siglip2-base-384": EmbeddingModel("siglip2-base-384", 384, "siglip2", 768),
}


def get_model(name: str) -> EmbeddingModel:
    if name not in MODELS:
        raise ValueError(f"Unknown embedding model {name}; known: {list(MODELS)}")
    return MODELS[name]
