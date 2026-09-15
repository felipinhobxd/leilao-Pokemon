# -*- coding: utf-8 -*-
"""PP-OCRv6 Medium OCR (det + rec) running fully on ONNX Runtime.

Region-based multi-pass OCR for normalized cards:
- name strip   (top-left, upscaled)     -> card name
- hp strip     (top-right, upscaled)    -> HP
- footer strip (bottom, upscaled)       -> collector number / set / language hints
- body pass    (language detection only, downscaled)

Every read produces (text, confidence); partial reads never become hard facts.
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
import onnxruntime as ort

from .config import MODELS_DIR

_SESSION_OPTS = ort.SessionOptions()
_SESSION_OPTS.intra_op_num_threads = max(1, (os.cpu_count() or 2))

DET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
DET_MAX_SIDE = 800
REC_HEIGHT = 48
REC_MAX_WIDTH = 480
REC_WIDTH_BUCKETS = (160, 320, 480)


@dataclass
class OcrLine:
    text: str
    confidence: float
    box: np.ndarray  # 4x2 quad in the region's coordinate space
    region: str = ""

    def to_dict(self) -> dict:
        return {"text": self.text, "confidence": round(float(self.confidence), 4), "region": self.region}


@dataclass
class OcrResult:
    lines: list[OcrLine] = field(default_factory=list)
    elapsed_ms: int = 0
    backend: str = "onnxruntime"
    error: Optional[str] = None

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def confidence_score(self) -> float:
        return float(sum(line.confidence for line in self.lines))


class PpOcr:
    _instance = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._det: Optional[ort.InferenceSession] = None
        self._rec: Optional[ort.InferenceSession] = None
        self._charset: list[str] = []
        self._lock = threading.Lock()

    @classmethod
    def instance(cls) -> "PpOcr":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _ensure(self):
        if self._det is not None:
            return
        with self._lock:
            if self._det is not None:
                return
            providers = [p for p in ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")
                         if p in ort.get_available_providers()]
            self._det = ort.InferenceSession(os.path.join(MODELS_DIR, "ppocrv6-medium-det.onnx"),
                                             sess_options=_SESSION_OPTS, providers=providers)
            self._rec = ort.InferenceSession(os.path.join(MODELS_DIR, "ppocrv6-medium-rec.onnx"),
                                             sess_options=_SESSION_OPTS, providers=providers)
            charset_path = os.path.join(MODELS_DIR, "ppocrv6-charset.txt")
            with open(charset_path, encoding="utf-8") as fh:
                chars = [line.rstrip("\n") for line in fh]
            # CTC convention: index 0 = blank, 1..len(charset) = characters, last = space
            self._charset = [""] + chars + [" "]

    # ------------------------------------------------------------------ detect
    def _det_preprocess(self, bgr: np.ndarray):
        h, w = bgr.shape[:2]
        scale = min(1.0, DET_MAX_SIDE / max(h, w))
        nh = max(32, int(h * scale) // 32 * 32)
        nw = max(32, int(w * scale) // 32 * 32)
        resized = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        norm = (resized.astype(np.float32)[:, :, ::-1] / 255.0 - DET_MEAN) / DET_STD  # BGR->RGB
        chw = np.ascontiguousarray(np.transpose(norm, (2, 0, 1))[np.newaxis], dtype=np.float32)
        return chw, scale, (h, w)

    def _detect_boxes(self, bgr: np.ndarray) -> list[np.ndarray]:
        x, scale, _ = self._det_preprocess(bgr)
        prob = self._det.run(None, {"x": x})[0][0, 0]
        bitmap = (prob > 0.3).astype(np.uint8) * 255
        contours, _ = cv2.findContours(bitmap, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for contour in contours:
            if cv2.contourArea(contour) < 8:
                continue
            rect = cv2.minAreaRect(contour)
            poly = cv2.boxPoints(rect)
            poly = _unclip_quad(poly, 1.7)
            if poly is None:
                continue
            poly = poly / scale
            if cv2.contourArea(poly.astype(np.float32)) < 12:
                continue
            boxes.append(poly.astype(np.float32))
        boxes.sort(key=lambda b: (b[:, 1].min(), b[:, 0].min()))
        return boxes

    # --------------------------------------------------------------- recognize
    def _rec_preprocess(self, bgr: np.ndarray) -> Optional[np.ndarray]:
        h, w = bgr.shape[:2]
        if h < 6 or w < 6:
            return None
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
        ratio = REC_HEIGHT / h
        nw = min(REC_MAX_WIDTH, max(16, int(round(w * ratio))))
        resized = cv2.resize(gray, (nw, REC_HEIGHT), interpolation=cv2.INTER_CUBIC)
        resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
        norm = (resized.astype(np.float32) / 255.0 - 0.5) / 0.5
        return np.ascontiguousarray(np.transpose(norm, (2, 0, 1))[np.newaxis], dtype=np.float32)

    def _ctc_decode(self, probs: np.ndarray) -> tuple[str, float]:
        best = probs.argmax(axis=1)
        confs = probs.max(axis=1)
        chars: list[str] = []
        confidences: list[float] = []
        prev = 0
        for idx, conf in zip(best, confs):
            if idx != prev and idx != 0:
                index = int(idx)
                if 0 <= index < len(self._charset):
                    chars.append(self._charset[index])
                    confidences.append(float(conf))
            prev = idx
        text = "".join(chars).strip()
        confidence = float(np.mean(confidences)) if confidences else 0.0
        return text, confidence

    def _recognize_batch(self, bgr: np.ndarray, boxes: list[np.ndarray], region: str) -> list[OcrLine]:
        self._ensure()
        kept: list[tuple[np.ndarray, np.ndarray]] = []
        for box in boxes:
            crop = _crop_quad(bgr, box)
            if crop is None or crop.size == 0:
                continue
            prep = self._rec_preprocess(crop)
            if prep is None:
                continue
            kept.append((prep, box))
        lines: list[OcrLine] = []
        if not kept:
            return lines
        # bucket by width so short crops don't pad to the longest line's width
        buckets: dict[int, list[tuple[np.ndarray, np.ndarray]]] = {}
        for prep, box in kept:
            width = prep.shape[3]
            bucket = next((b for b in REC_WIDTH_BUCKETS if width <= b), REC_WIDTH_BUCKETS[-1])
            buckets.setdefault(bucket, []).append((prep, box))
        for bucket, items in buckets.items():
            batch = np.full((len(items), 3, REC_HEIGHT, bucket), -1.0, dtype=np.float32)
            for i, (prep, _) in enumerate(items):
                batch[i, :, :, : prep.shape[3]] = prep[0]
            probs = self._rec.run(None, {"x": batch})[0]  # [B, T, C]
            for (prep, box), p in zip(items, probs):
                text, confidence = self._ctc_decode(p)
                if text:
                    lines.append(OcrLine(text=text, confidence=confidence, box=box, region=region))
        return lines

    def read_card(self, card_bgr: np.ndarray, body_pass: bool = True) -> OcrResult:
        """Region-based OCR on a normalized (600x840-ish) card image.

        Three cheap det passes instead of one expensive full-card pass:
        1. top strip    (name + HP + stage)
        2. bottom strip (flavor text / weakness row / copyright / language)
        3. number corner (collector number at high scale)
        """
        started = time.time()
        try:
            self._ensure()
            lines: list[OcrLine] = []
            h, w = card_bgr.shape[:2]

            def crop_region(x0: float, y0: float, x1: float, y1: float, scale: float) -> np.ndarray:
                sx0, sy0 = int(w * x0), int(h * y0)
                sx1, sy1 = int(w * x1), int(h * y1)
                crop = card_bgr[max(0, sy0): min(h, sy1), max(0, sx0): min(w, sx1)]
                if crop.size == 0:
                    return crop
                return cv2.resize(crop, (int(crop.shape[1] * scale), int(crop.shape[0] * scale)),
                                  interpolation=cv2.INTER_CUBIC)

            # --- pass 1: top strip; sub-label lines by horizontal position
            top = crop_region(0.0, 0.0, 1.0, 0.13, 2.0)
            if top is not None and top.size:
                for line in self._recognize_batch(top, self._detect_boxes(top), "top"):
                    center_x = line.box[:, 0].mean() / max(1, top.shape[1])
                    line.region = "hp" if center_x >= 0.62 else "name"
                    lines.append(line)

            # --- pass 2: bottom strip (flavor text / weakness row / copyright / language)
            bottom = crop_region(0.0, 0.80, 1.0, 0.945, 2.2)
            if bottom is not None and bottom.size:
                lines.extend(self._recognize_batch(bottom, self._detect_boxes(bottom), "footer"))

            # --- pass 3: collector-number line at high magnification (full width:
            # PT cards put it bottom-LEFT near the set symbol, modern cards bottom-RIGHT)
            corner = crop_region(0.0, 0.93, 1.0, 1.0, 4.5)
            if corner is not None and corner.size:
                lines.extend(self._recognize_batch(corner, self._detect_boxes(corner), "number"))

            return OcrResult(lines=lines, elapsed_ms=int((time.time() - started) * 1000))
        except Exception as exc:  # noqa: BLE001
            return OcrResult(elapsed_ms=int((time.time() - started) * 1000), error=str(exc))

    def read(self, bgr: np.ndarray) -> OcrResult:
        """Generic full-image OCR (det + rec)."""
        started = time.time()
        try:
            self._ensure()
            boxes = self._detect_boxes(bgr)
            lines = self._recognize_batch(bgr, boxes, "")
            return OcrResult(lines=lines, elapsed_ms=int((time.time() - started) * 1000))
        except Exception as exc:  # noqa: BLE001
            return OcrResult(elapsed_ms=int((time.time() - started) * 1000), error=str(exc))


def _unclip_quad(poly: np.ndarray, ratio: float = 1.6) -> Optional[np.ndarray]:
    area = cv2.contourArea(poly.astype(np.float32))
    length = cv2.arcLength(poly.astype(np.float32), True)
    if length <= 1 or area <= 0:
        return None
    distance = area * ratio / length
    center = poly.mean(axis=0)
    norms = np.linalg.norm(poly - center, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    expanded = center + (poly - center) * (1.0 + 2.0 * distance / norms)
    return expanded


def _order_points(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def _crop_quad(bgr: np.ndarray, box: np.ndarray) -> Optional[np.ndarray]:
    ordered = _order_points(box)
    width = max(16, int(np.linalg.norm(ordered[1] - ordered[0])))
    height = max(8, int(np.linalg.norm(ordered[3] - ordered[0])))
    if width <= 0 or height <= 0:
        return None
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(ordered, dst)
    return cv2.warpPerspective(bgr, matrix, (width, height))
