# -*- coding: utf-8 -*-
"""PP-OCRv6 Medium OCR (det + rec) running fully on ONNX Runtime.

Region-based multi-pass OCR for normalized cards:
- name strip   (top-left, upscaled)     -> card name
- name band 2  (deeper top, upscaled)   -> card name on loose framings
- hp strip     (top-right, upscaled)    -> HP
- footer strip (bottom, upscaled)       -> collector number / set / language hints
- number corner + wide number band with denoising variants -> collector number

Every read produces (text, confidence); partial reads never become hard facts.
"""
from __future__ import annotations

import os
import re
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

# A line that plausibly contains a collector number ("106/189", "153/217").
_NUMBER_LINE_RE = re.compile(r"\d{1,3}\s*[/|lI]\s*\d{1,3}")
# Capturing variant used to group agreeing reads by (num, den).
_NUMBER_PAIR_RE = re.compile(r"(\d{1,3})\s*[/|lI]\s*(\d{1,3})")


def number_read_groups(lines) -> dict[tuple[str, str], list[float]]:
    """Group strict N/M reads of the number region by (num, den) -> confidences.

    Shared by the OCR early-stop (consensus) and by hints extraction
    (vote mass), so both agree on what counts as "the same read".
    """
    groups: dict[tuple[str, str], list[float]] = {}
    for line in lines:
        if getattr(line, "region", "") != "number":
            continue
        match = _NUMBER_PAIR_RE.search(line.text)
        if match and match.group(1) != match.group(2):
            groups.setdefault((match.group(1), match.group(2)), []).append(float(line.confidence))
    return groups


def number_consensus_reached(lines, min_votes: int = 2) -> bool:
    """True once some (num, den) pair has been read `min_votes` times.

    A single confident read — even 0.99 — does NOT stop the region ladder:
    a lone confident-but-wrong read is exactly what consensus exists to
    outvote (the misread repeats once at most; the true number repeats across
    complementary regions).
    """
    return any(len(votes) >= min_votes for votes in number_read_groups(lines).values())


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

    @property
    def loaded(self) -> bool:
        """True once the det/rec ONNX sessions exist (readiness reporting)."""
        return self._det is not None and self._rec is not None

    def warm(self) -> None:
        """Load the ONNX sessions eagerly (startup/health readiness)."""
        self._ensure()

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

        Passes (det + rec on each region, never one expensive full-card pass):
        1. top strip    (name + HP + stage)
        1b. deep top band — real photos with loose perspective warps put the
            name bar 10-25% down; tagged name2/hp2, used only as fallback
        2. bottom strip (flavor text / weakness row / copyright / language)
        3. collector number — four complementary regions (corner + wide
           bands), raw variant of each first, then denoising variants
           (bilateral -> Otsu) on the left-crop regions until a confident
           N/M line shows up
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

            # --- pass 1b: deep top band for loose framings (name2/hp2)
            top2 = crop_region(0.0, 0.14, 1.0, 0.32, 2.0)
            if top2 is not None and top2.size:
                for line in self._recognize_batch(top2, self._detect_boxes(top2), "top2"):
                    center_x = line.box[:, 0].mean() / max(1, top2.shape[1])
                    line.region = "hp2" if center_x >= 0.62 else "name2"
                    lines.append(line)

            # --- pass 2: bottom strip (flavor text / weakness row / copyright / language)
            bottom = crop_region(0.0, 0.80, 1.0, 0.945, 2.2)
            if bottom is not None and bottom.size:
                lines.extend(self._recognize_batch(bottom, self._detect_boxes(bottom), "footer"))

            # --- pass 3: collector number. Four complementary regions:
            #   a) bottom corner, full width (tight framings / synthetic scans)
            #   b) wide bottom band, full width (loose warps push the number
            #      up to 70-90% of the frame)
            #   c) wide bottom band, left 60% (real photos: the right-side
            #      set code / copyright / stand noise defeats detection)
            #   d) short bottom-left band (numbers that sit 86-100% down: the
            #      taller band's extra body text defeats detection there)
            # Breadth-first: the raw variant of every region runs before any
            # denoising variant, and the bilateral/Otsu ladder only climbs on
            # the left-crop regions (where noisy photos actually benefit).
            # Early-stop requires CONSENSUS: the same N/M read twice (across
            # regions or preprocessings). One confident read no longer stops
            # the ladder — a lone misread must not preempt the vote that would
            # outvote it (hints.extract_hints tallies these same lines).
            number_regions = (
                (0.0, 0.93, 1.0, 1.0, 4.5),
                (0.0, 0.72, 1.0, 1.0, 3.0),
                (0.0, 0.72, 0.60, 1.0, 5.0),
                (0.0, 0.86, 0.60, 1.0, 5.0),
            )
            attempts: list[tuple[tuple[float, float, float, float, float], str]] = [
                (region, "raw") for region in number_regions
            ]
            for region in number_regions[2:]:
                attempts.append((region, "bilateral"))
                attempts.append((region, "otsu"))
            for region_spec, variant_name in attempts:
                crop = crop_region(*region_spec)
                if crop is None or not crop.size:
                    continue
                variant = self._number_variant(crop, variant_name)
                lines.extend(self._recognize_batch(variant, self._detect_boxes(variant), "number"))
                if number_consensus_reached(lines):
                    break

            return OcrResult(lines=lines, elapsed_ms=int((time.time() - started) * 1000))
        except Exception as exc:  # noqa: BLE001
            return OcrResult(elapsed_ms=int((time.time() - started) * 1000), error=str(exc))

    @staticmethod
    def _number_variant(bgr: np.ndarray, name: str) -> np.ndarray:
        """Named preprocessing variant for the collector-number regions.

        raw        -> as-is (clean scans)
        bilateral  -> edge-preserving smoothing (JPEG noise, glare texture)
        otsu       -> hard binarization of the smoothed gray (worst glare)
        """
        if name == "raw":
            return bgr
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        bilateral = cv2.bilateralFilter(gray, 9, 75, 75)
        if name == "bilateral":
            return cv2.cvtColor(bilateral, cv2.COLOR_GRAY2BGR)
        _, otsu = cv2.threshold(bilateral, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR)

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
