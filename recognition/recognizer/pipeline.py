# -*- coding: utf-8 -*-
"""Full recognition pipeline: two independent routes + fusion + honest confidence.

ROUTE A (visual, never gated by OCR):
    photo -> normalize -> global embedding (both 0/180 orientations) -> exact
    cosine search over the whole local index -> Top-K -> local feature
    geometric verification (RANSAC homography) on the best candidates.

ROUTE B (text):
    photo -> normalize -> PP-OCRv6 (best orientation) -> hints -> catalog
    candidates from name/number/language similarity.

FUSION:
    visual verification (homography inliers) is near-conclusive evidence;
    OCR validates metadata (name/number/HP/language); both routes produce
    independent ranked candidates. Confidences are reported as honest
    categories, not fake percentages.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .config import DEFAULT_EMBEDDING, DEFAULT_CALIBRATION, EMBEDDING_CALIBRATION, TOPK, VERIFY_CANDIDATES
from .embed import get_model
from .features import Verification, get_matcher
from .hints import OcrHints, extract_hints, name_similarity
from .normalize import NormalizedCard, normalize_card, photometric_variants
from .ocr import PpOcr

import cv2


@dataclass
class Candidate:
    card_id: str
    language: str
    set_id: str
    set_name: str
    name: str
    local_id: str
    denominator: Optional[int]
    hp: Optional[int]
    score: float = 0.0
    visual_similarity: float = -1.0
    verification: Optional[Verification] = None
    ocr_name_similarity: float = 0.0
    ocr_number_match: bool = False
    ocr_language_match: bool = False
    ocr_hp_match: bool = False
    image_url: str = ""
    variant: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "cardId": self.card_id, "language": self.language, "setId": self.set_id,
            "setName": self.set_name, "name": self.name,
            "cardNumber": f"{self.local_id}/{self.denominator}" if self.denominator else self.local_id,
            "localId": self.local_id, "hp": self.hp,
            "score": round(self.score, 4),
            "visualSimilarity": round(self.visual_similarity, 4) if self.visual_similarity >= 0 else None,
            "verification": None if self.verification is None else {
                "inliers": self.verification.inliers, "matches": self.verification.matches,
                "inlierRatio": round(self.verification.inlier_ratio, 4),
                "reprojectionError": round(self.verification.reprojection_error, 2),
                "score": round(self.verification.score, 4),
                "method": self.verification.method,
            },
            "ocrNameSimilarity": round(self.ocr_name_similarity, 4),
            "ocrNumberMatch": self.ocr_number_match,
            "ocrLanguageMatch": self.ocr_language_match,
            "ocrHpMatch": self.ocr_hp_match,
            "imageUrl": self.image_url,
            "variant": self.variant,
        }


@dataclass
class RecognitionResult:
    decision: str = "NAO_IDENTIFICADO"  # IDENTIFICADO | PROVAVEL | REVISAR | NAO_IDENTIFICADO
    best: Optional[Candidate] = None
    candidates: list[Candidate] = field(default_factory=list)
    route_a_ok: bool = False
    route_b_ok: bool = False
    normalization_method: str = ""
    normalization_confidence: float = 0.0
    orientation: str = "0"  # "0" | "180"
    hints: Optional[OcrHints] = None
    evidence: list[str] = field(default_factory=list)
    elapsed_ms: int = 0
    timings: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "decision": self.decision,
            "best": self.best.to_dict() if self.best else None,
            "candidates": [c.to_dict() for c in self.candidates[:10]],
            "routeA": self.route_a_ok, "routeB": self.route_b_ok,
            "normalization": {"method": self.normalization_method,
                              "confidence": round(self.normalization_confidence, 3)},
            "orientation": self.orientation,
            "hints": self.hints.to_dict() if self.hints else None,
            "evidence": self.evidence,
            "elapsedMs": self.elapsed_ms,
            "timings": {k: round(v) for k, v in self.timings.items()},
        }


def candidate_from_record(record) -> "Candidate":
    """Build a Candidate from a CardRecord, including scan URL + variant."""
    import json as _json
    variant = None
    try:
        variants = _json.loads(record.variants or "{}")
        available = [["normal", "Normal"], ["holo", "Holo"], ["reverse", "Reverse Holo"]]
        labels = [label for key, label in available if variants.get(key) is True]
        variant = labels[0] if len(labels) == 1 else None
    except Exception:
        variant = None
    return Candidate(
        card_id=record.id, language=record.language, set_id=record.set_id,
        set_name=record.set_name, name=record.name, local_id=record.local_id,
        denominator=record.denominator, hp=record.hp,
        image_url=f"{record.image_base}/high.webp" if record.image_base else "",
        variant=variant,
    )


class VisualIndex:
    """In-memory exact cosine index (catalog is ~10-80k cards: brute force wins)."""

    def __init__(self, embedding_name: str):
        from .config import EMBEDDINGS_DIR
        import os
        self.embedding_name = embedding_name
        path = os.path.join(EMBEDDINGS_DIR, f"{embedding_name}.npz")
        data = np.load(path, allow_pickle=True)
        self.matrix = data["matrix"].astype(np.float32)
        self.ids = list(map(str, data["ids"]))
        self.id_to_row = {cid: i for i, cid in enumerate(self.ids)}
        self.model = get_model(embedding_name)

    def search(self, image: np.ndarray, topk: int = TOPK, orientations: Optional[list[np.ndarray]] = None):
        """Multi-view retrieval: each orientation x each photometric view is
        embedded; a card's score is its max similarity over all views.
        Raw views win on well-lit photos, gamma-normalized views rescue
        dark/washed-out ones (bake-off 2026-09-14: rank 2 -> 1 on the hardest)."""
        images = orientations or [image]
        views: list[np.ndarray] = []
        view_orientation: list[int] = []
        for i, oriented in enumerate(images):
            for variant in photometric_variants(oriented):
                views.append(variant)
                view_orientation.append(i)
        embeddings = self.model.embed(views)
        scores = embeddings @ self.matrix.T  # [n_views, N]
        best_scores = scores.max(axis=0)
        orientation_idx = np.zeros(len(best_scores), dtype=np.int64)
        for i in range(1, len(view_orientation)):
            better = scores[i] > best_scores
            orientation_idx[better] = view_orientation[i]
        order = np.argsort(-best_scores)[:topk]
        results = []
        for row in order:
            key = self.ids[int(row)]
            language, card_id = key.split("|", 1)
            results.append((language, card_id, float(best_scores[int(row)]), int(orientation_idx[int(row)])))
        return results


class Recognizer:
    def __init__(self, embedding_name: str = DEFAULT_EMBEDDING, matcher_name: str = "sift",
                 topk: int = TOPK, verify_topk: int = VERIFY_CANDIDATES, catalog=None):
        self.embedding_name = embedding_name
        self.matcher_name = matcher_name
        self.topk = topk
        self.verify_topk = verify_topk
        self.calibration = EMBEDDING_CALIBRATION.get(embedding_name, DEFAULT_CALIBRATION)
        self.catalog = catalog  # CatalogStore with card_by_key()
        self.index = VisualIndex(embedding_name)
        self.matcher = get_matcher(matcher_name)
        self.ocr = PpOcr.instance()
        self._scan_cache: dict[str, Optional[np.ndarray]] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------- scan access
    def _scan_image(self, language: str, card_id: str) -> Optional[np.ndarray]:
        key = f"{language}|{card_id}"
        with self._lock:
            if key in self._scan_cache:
                return self._scan_cache[key]
        card = self.catalog.card_by_key(language, card_id) if self.catalog else None
        image = None
        if card is not None:
            from .catalog import ensure_scan
            path = ensure_scan(card.image_base, "high.webp")
            if path:
                data = np.fromfile(path, dtype=np.uint8)
                image = cv2.imdecode(data, cv2.IMREAD_COLOR)
        with self._lock:
            if len(self._scan_cache) > 400:
                self._scan_cache.clear()
            self._scan_cache[key] = image
        return image

    # ---------------------------------------------------------------- route B
    def route_b(self, card: NormalizedCard, orientation: str = "0") -> tuple[OcrHints, list[Candidate]]:
        """OCR the card. Orientation comes from Route A (fast) when available;
        otherwise both orientations are tried and the richer read wins."""
        if orientation == "180":
            primary = card.rotated180
            secondary = card.image
        else:
            primary = card.image
            secondary = card.rotated180
        best = self.ocr.read_card(primary)
        if not best.lines or best.confidence_score < 1.2:
            other = self.ocr.read_card(secondary)
            if other.confidence_score > best.confidence_score:
                best = other
        hints = extract_hints(best)
        candidates: list[Candidate] = []
        if self.catalog is not None and (hints.name or hints.local_id):
            candidates = self.catalog.text_candidates(hints)
        return hints, candidates

    # ---------------------------------------------------------------- route A
    def route_a(self, card: NormalizedCard) -> tuple[list[Candidate], str]:
        results = self.index.search(card.image, self.topk, [card.image, card.rotated180])
        candidates = []
        orientation = "0"
        for language, card_id, similarity, orientation_idx in results:
            record = self.catalog.card_by_key(language, card_id) if self.catalog else None
            if record is None:
                continue
            if not candidates and orientation_idx == 1:
                orientation = "180"
            candidate = candidate_from_record(record)
            candidate.visual_similarity = similarity
            candidates.append(candidate)
        return candidates, orientation

    # ------------------------------------------------------------ verification
    def verify(self, card: NormalizedCard, candidates: list[Candidate], orientation: str = "0") -> None:
        """Geometric verification. Uses Route A's winning orientation by default
        (halves cost); the opposite orientation is a fallback for weak quads."""
        primary = card.rotated180 if orientation == "180" else card.image
        probe_variants = [primary]
        if card.confidence < 0.25:  # uncertain normalization: try both orientations
            probe_variants.append(card.rotated180 if orientation == "180" else card.image)
        for i, candidate in enumerate(candidates[: self.verify_topk]):
            scan = self._scan_image(candidate.language, candidate.card_id)
            if scan is None:
                continue
            best: Optional[Verification] = None
            for probe in probe_variants:
                verification = self.matcher.match(probe, scan)
                if best is None or verification.score > best.score:
                    best = verification
            candidate.verification = best

    # ------------------------------------------------------------------ fusion
    def fuse(self, candidates: list[Candidate], hints: OcrHints, route_b: list[Candidate]) -> list[Candidate]:
        """Combine evidence with fixed, benchmark-calibrated weights."""
        cal = self.calibration
        ocr_best = {c.card_id + "|" + c.language: c for c in route_b}
        for candidate in candidates:
            weights = {}
            visual = candidate.visual_similarity
            if visual >= 0:
                # cosine similarity on a 0..1 scale; only rewards well above chance
                weights["visual"] = max(0.0, (visual - cal["floor"])) * cal["weight"]
            verification = candidate.verification
            if verification is not None and verification.score > 0:
                weights["verification"] = verification.score * 220.0
            if hints.name and candidate.name:
                similarity = name_similarity(hints.name, candidate.name)
                candidate.ocr_name_similarity = similarity
                if hints.name_confidence >= 0.6 and similarity >= 0.9:
                    weights["ocr_name"] = 60.0 * hints.name_confidence
                elif similarity >= 0.72:
                    weights["ocr_name"] = 22.0 * hints.name_confidence
                if hints.name_confidence >= 0.8 and similarity < 0.45:
                    weights["ocr_name_conflict"] = -90.0
            if hints.local_id and candidate.local_id:
                try:
                    match = int(hints.local_id) == int(candidate.local_id)
                except ValueError:
                    match = hints.local_id == candidate.local_id
                candidate.ocr_number_match = match
                if match and hints.number_confidence >= 0.6:
                    weights["ocr_number"] = 45.0 * hints.number_confidence
            if hints.language and candidate.language == hints.language:
                candidate.ocr_language_match = True
                weights["ocr_language"] = 8.0 * hints.language_confidence
            if hints.hp and candidate.hp == hints.hp:
                candidate.ocr_hp_match = True
                weights["ocr_hp"] = 6.0 * hints.hp_confidence
            candidate.score = sum(weights.values())
        return sorted(candidates, key=lambda c: -c.score)

    # ------------------------------------------------------------------ decide
    def decide(self, ranked: list[Candidate], hints: OcrHints) -> tuple[str, list[str]]:
        cal = self.calibration
        if not ranked:
            return "NAO_IDENTIFICADO", []
        best = ranked[0]
        second = ranked[1] if len(ranked) > 1 else None
        verification = best.verification
        verified = verification is not None and verification.inliers >= 12 and verification.inlier_ratio >= 0.30
        margin = (best.score - second.score) if second is not None else 999.0
        evidence = []
        if verified:
            evidence.append("geometric-verification")
        if best.visual_similarity >= cal["medium"]:
            evidence.append("global-visual-retrieval")
        if best.ocr_name_similarity >= 0.9 and hints.name_confidence >= 0.6:
            evidence.append("ocr-name")
        if best.ocr_number_match and hints.number_confidence >= 0.6:
            evidence.append("collector-number")
        if best.ocr_language_match and hints.language_confidence >= 0.6:
            evidence.append("language")

        strong_evidence = verified or (best.visual_similarity >= cal["strong"] and len(evidence) >= 2)
        if strong_evidence and margin >= 25:
            return "IDENTIFICADO", evidence
        if len(evidence) >= 2 and margin >= 12:
            return "PROVAVEL", evidence
        if len(evidence) >= 1:
            return "REVISAR", evidence
        return "NAO_IDENTIFICADO", evidence

    # ---------------------------------------------------------------- recognize
    def recognize(self, bgr: np.ndarray, ocr_override: Optional[dict] = None,
                  use_memory: bool = True) -> RecognitionResult:
        started = time.time()
        result = RecognitionResult()
        timings: dict[str, float] = {}

        t0 = time.time()
        card = normalize_card(bgr)
        timings["normalize"] = (time.time() - t0) * 1000
        result.normalization_method = card.method
        result.normalization_confidence = card.confidence

        # Memory of user-confirmed examples (exemplar retrieval, before routes)
        memory_hit = None
        if use_memory:
            t0 = time.time()
            try:
                from . import memory as memory_module
                embeddings = self.index.model.embed([card.image])
                memory_hit = memory_module.lookup(embeddings[0])
                if memory_hit is not None and memory_hit[1] < 0.85:
                    # weak: treat as soft prior only
                    pass
            except Exception:
                memory_hit = None
            timings["memory"] = (time.time() - t0) * 1000

        # Route A: visual retrieval (independent of OCR)
        t0 = time.time()
        route_a_candidates, orientation = self.route_a(card)
        timings["route_a_retrieval"] = (time.time() - t0) * 1000
        result.route_a_ok = bool(route_a_candidates)

        # Route B: OCR + text candidates (orientation hinted by Route A)
        t0 = time.time()
        hints, route_b_candidates = self.route_b(card, orientation)
        if ocr_override:
            from .hints import apply_override
            apply_override(hints, ocr_override)
            route_b_candidates = self.catalog.text_candidates(hints) if self.catalog else []
        timings["route_b_ocr"] = (time.time() - t0) * 1000
        result.route_b_ok = bool(route_b_candidates)
        result.hints = hints
        result.orientation = orientation

        # Merge candidate pools: route A dominates, route B adds anything missed
        merged: dict[str, Candidate] = {}
        for candidate in route_a_candidates:
            merged[candidate.card_id + "|" + candidate.language] = candidate
        for candidate in route_b_candidates[:20]:
            key = candidate.card_id + "|" + candidate.language
            if key not in merged:
                merged[key] = candidate

        # Memory hit becomes a strong prior on its confirmed card
        if memory_hit is not None:
            example, similarity = memory_hit
            record = self.catalog.card_by_key(example.language, example.card_id) if self.catalog else None
            if record is not None:
                key = example.card_id + "|" + example.language
                candidate = merged.get(key) or candidate_from_record(record)
                candidate.score = max(candidate.score, 90.0 * min(1.0, similarity / 0.95))
                candidate.visual_similarity = max(candidate.visual_similarity, similarity)
                merged[key] = candidate
                result.evidence.append("confirmed-memory")

        # Geometric verification on the merged shortlist (route A candidates first)
        shortlist = sorted(merged.values(),
                           key=lambda c: -(c.visual_similarity if c.visual_similarity >= 0 else 0.5))
        t0 = time.time()
        self.verify(card, shortlist, orientation)
        timings["verification"] = (time.time() - t0) * 1000

        ranked = self.fuse(list(merged.values()), hints, route_b_candidates)
        decision, evidence = self.decide(ranked, hints)
        if memory_hit is not None and "confirmed-memory" not in evidence and decision in ("REVISAR", "NAO_IDENTIFICADO"):
            evidence = ["confirmed-memory"] + evidence
            if memory_hit[1] >= 0.85:
                decision = "PROVAVEL" if decision == "REVISAR" else decision
        result.decision = decision
        result.evidence = evidence
        result.candidates = ranked
        result.best = ranked[0] if ranked else None
        result.elapsed_ms = int((time.time() - started) * 1000)
        result.timings = timings
        return result
