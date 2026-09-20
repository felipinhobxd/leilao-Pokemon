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
import time
from typing import Optional

import numpy as np
import onnxruntime as ort

from .config import MODELS_DIR
from .ort_session import (OrtSession, demote_provider, demoted_providers,
                           preferred_providers)

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
HALF_MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32)
HALF_STD = np.array([0.5, 0.5, 0.5], dtype=np.float32)

# A healthy transformer embedding row has an L2 norm far above this (SigLIP2
# image_embeds pre-normalization sit around 10-30). A norm at/below the
# epsilon means the model output is degenerate garbage (all-zero or denormal
# rows): normalizing it would silently fabricate a "valid" direction.
EMBEDDING_NORM_EPS = 1e-6

# Consecutive invalid outputs on a non-CPU provider before that provider is
# demoted for this process (and via the marker file, for future ones).
_PROVIDER_DEMOTION_AFTER = max(1, int(os.environ.get("RECOGNITION_PROVIDER_DEMOTION_AFTER", "1")))


class InvalidEmbeddingError(RuntimeError):
    """An embedding failed numerical validation and MUST NOT propagate.

    Raised instead of letting NaN/inf reach cosine similarity, retrieval,
    ranking, fusion, memory or SIFT. The payload carries the diagnostics the
    spec asks for (stage, model, provider, shapes, dtype, min/max/mean/norm,
    NaN/inf counts) so the failure is explainable without dumping image data.
    """

    def __init__(self, stage: str, model: str, provider: str, detail: dict):
        self.stage = stage
        self.model = model
        self.provider = provider
        self.detail = detail
        rendered = ", ".join(f"{k}={v}" for k, v in detail.items())
        super().__init__(f"invalid embedding at {stage} (model={model}, provider={provider}): {rendered}")


def _array_stats(array: np.ndarray) -> dict:
    """Finite-safe statistics for diagnostics (never raises, never warns)."""
    with np.errstate(invalid="ignore", divide="ignore"):
        finite = array[np.isfinite(array)]
        return {
            "shape": tuple(int(v) for v in array.shape),
            "dtype": str(array.dtype),
            "min": float(finite.min()) if finite.size else None,
            "max": float(finite.max()) if finite.size else None,
            "mean": float(finite.mean()) if finite.size else None,
            "nanCount": int(np.isnan(array).sum()),
            "infCount": int(np.isinf(array).sum()),
        }

_SESSION_OPTS = ort.SessionOptions()
_SESSION_OPTS.intra_op_num_threads = max(1, (os.cpu_count() or 2))
_SESSION_OPTS.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL


def _providers() -> list[str]:
    return preferred_providers()


class EmbeddingModel:
    """Shared interface: embed(batch of BGR uint8 images) -> L2-normalized float32 [N, D]."""

    def __init__(self, name: str, size: int, kind: str, dim: int):
        self.name, self.size, self.kind, self.dim = name, size, kind, dim
        self._session: Optional[OrtSession] = None
        self._lock = threading.Lock()
        # Stability accounting (surfaced on /health): invalid outputs seen so
        # far and provider demotions performed by THIS process.
        self.invalid_outputs = 0
        self.demotions: list[dict] = []

    @property
    def loaded(self) -> bool:
        """True once the ONNX session exists (readiness reporting)."""
        return self._session is not None

    @property
    def provider(self) -> str:
        """Actual execution provider of the loaded session ("" if lazy)."""
        if self._session is None:
            return ""
        return self._session.provider

    def warm(self) -> None:
        """Load the ONNX session eagerly. ready=true must mean the NEXT photo
        can be served without a multi-second first-inference stall."""
        self._ensure()

    def _ensure(self) -> OrtSession:
        if self._session is not None:
            return self._session
        with self._lock:
            if self._session is not None:
                return self._session
            path = self._model_path()
            # OrtSession: DML-safe options (no mem patterns, sequential
            # execution) and serialized Run when the session really runs on
            # DML — see recognizer/ort_session.py and the official DirectML
            # EP documentation.
            self._session = OrtSession(path, intra_threads=max(1, (os.cpu_count() or 2)))
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
        change the output values (no cross-image interaction in the graph).

        Raises InvalidEmbeddingError when the model output fails numerical
        validation (NaN/inf/zero-norm): garbage never continues to cosine
        similarity, retrieval, fusion or memory."""
        if not images:
            return np.zeros((0, self.dim), dtype=np.float32)
        chunk = int(os.environ.get("RECOGNITION_EMBED_CHUNK", "2"))
        outputs = []
        for i in range(0, len(images), chunk):
            current = images[i:i + chunk]
            for attempt in range(2):
                try:
                    outputs.append(self._embed_chunk(current))
                    break
                except InvalidEmbeddingError as error:
                    # A non-CPU provider that returns NaN/inf is demoted immediately.
                    # Rebuild the session and retry the same images once on the
                    # remaining provider (normally CPU). This prevents one bad GPU
                    # kernel/provider from aborting an entire index build/request.
                    if (
                        attempt == 0
                        and error.provider not in ("", "CPUExecutionProvider", "unknown")
                        and self._session is None
                    ):
                        continue
                    raise
        return np.concatenate(outputs, axis=0)

    def _note_invalid(self, error: InvalidEmbeddingError) -> None:
        """Count the failure and demote a repeatedly-invalid provider.

        Demotion: rebuild the session on CPU for the rest of this process and
        write the marker file so future processes skip the provider in `auto`
        mode too. CPU itself is never demoted (there is nowhere left to go)."""
        self.invalid_outputs += 1
        provider = self.provider
        if provider in ("", "CPUExecutionProvider", "unknown"):
            return
        if self.invalid_outputs >= _PROVIDER_DEMOTION_AFTER:
            reason = f"{self.name}: {self.invalid_outputs} invalid outputs (last: {error.detail.get('reason', 'unknown')})"
            demote_provider(provider, reason)
            self.demotions.append({"model": self.name, "from": provider,
                                   "to": "CPUExecutionProvider", "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
            with self._lock:
                if self._session is not None and self._session.provider == provider:
                    self._session = None  # next _ensure() rebuilds on the (now filtered) provider list

    def _embed_chunk(self, images: list[np.ndarray]) -> np.ndarray:
        session = self._ensure()
        provider = session.provider
        batch = np.concatenate([self._preprocess(img) for img in images], axis=0)
        if self.kind in ("dinov2", "dinov3"):
            outs = session.run(["last_hidden_state"], {"pixel_values": batch})
            tokens = outs[0]
            embedding = tokens[:, 0, :]  # CLS token
        else:  # siglip2 full multimodal: feed dummy text, use image_embeds
            dummy_ids = np.zeros((1, 1), dtype=np.int64)
            outs = session.run(["image_embeds"], {"input_ids": dummy_ids, "pixel_values": batch})
            embedding = outs[0]
        embedding = np.asarray(embedding, dtype=np.float32)
        # --- numerical validation (P0): garbage must never become a score ---
        if embedding.ndim != 2 or embedding.shape[0] != len(images) or embedding.shape[1] < 1:
            error = InvalidEmbeddingError("model-output", self.name, provider,
                                          {"reason": "bad-shape", **_array_stats(embedding),
                                           "inputShape": tuple(int(v) for v in batch.shape)})
            self._note_invalid(error)
            raise error
        if not np.isfinite(embedding).all():
            error = InvalidEmbeddingError("model-output", self.name, provider,
                                          {"reason": "nan-or-inf", **_array_stats(embedding),
                                           "inputShape": tuple(int(v) for v in batch.shape)})
            self._note_invalid(error)
            raise error
        with np.errstate(invalid="ignore", divide="ignore"):
            norms = np.linalg.norm(embedding, axis=1, keepdims=True)
        if not np.isfinite(norms).all() or float(norms.min()) <= EMBEDDING_NORM_EPS:
            error = InvalidEmbeddingError("normalization", self.name, provider,
                                          {"reason": "zero-or-invalid-norm", **_array_stats(embedding),
                                           "minNorm": float(norms.min()) if norms.size else None,
                                           "maxNorm": float(norms.max()) if norms.size else None})
            self._note_invalid(error)
            raise error
        normalized = (embedding / norms).astype(np.float32)
        if not np.isfinite(normalized).all():
            error = InvalidEmbeddingError("normalization", self.name, provider,
                                          {"reason": "post-normalize-nan-or-inf", **_array_stats(normalized)})
            self._note_invalid(error)
            raise error
        return normalized

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
