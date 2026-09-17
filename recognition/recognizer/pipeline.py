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

import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .config import DEFAULT_EMBEDDING, DEFAULT_CALIBRATION, EMBEDDING_CALIBRATION, TOPK, VERIFY_CANDIDATES
from .embed import InvalidEmbeddingError, get_model
from .features import SiftFeatures, Verification, get_matcher
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
    # Tri-state denominator evidence: None = unknown (candidate or OCR lacks M),
    # True/False = both sides readable and (dis)agreeing. False on a local-id
    # match means "same N, different M": a same-artwork reprint of another set.
    ocr_denominator_match: Optional[bool] = None
    ocr_full_number_match: bool = False
    image_url: str = ""
    variant: Optional[str] = None
    # Rarity as published by the catalog source ("Rare", "Illustration
    # Rare", …). Display metadata — it NEVER influences fusion scores.
    rarity: str = ""
    # Which scan source actually resolved for this candidate
    # ("high.webp" | "low.webp" | "en-high.webp" | "en-low.webp" | None).
    # Transient metadata: candidates whose source is NOT the standard
    # high.webp must not advertise the high.webp CDN URL (it 404s for them);
    # the service rewrites their imageUrl to the local /scan endpoint.
    scan_source: Optional[str] = None
    # Confirmed-memory evidence (AUXILIARY, never decisive): similarity to the
    # nearest USER-CONFIRMED example of exactly this card, or -1 when the
    # memory did not hit this candidate. Explicit field so fuse() can fold it
    # into the score — a plain score bonus set before fuse() was silently
    # wiped by `candidate.score = sum(weights.values())`.
    memory_similarity: float = -1.0

    def to_dict(self) -> dict:
        return {
            "cardId": self.card_id, "language": self.language, "setId": self.set_id,
            "setName": self.set_name, "name": self.name,
            "cardNumber": f"{self.local_id}/{self.denominator}" if self.denominator else self.local_id,
            "localId": self.local_id, "denominator": self.denominator, "hp": self.hp,
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
            "ocrDenominatorMatch": self.ocr_denominator_match,
            "ocrFullNumberMatch": self.ocr_full_number_match,
            "ocrLanguageMatch": self.ocr_language_match,
            "ocrHpMatch": self.ocr_hp_match,
            "imageUrl": self.image_url,
            "variant": self.variant,
            "rarity": self.rarity or None,
            "memorySimilarity": round(self.memory_similarity, 4) if self.memory_similarity >= 0 else None,
        }


@dataclass
class ScanCacheEntry:
    """Decoded official scan + the metadata the plain-ndarray cache lost.

    Storing only `key -> ndarray` made cache HITs return the image WITHOUT
    `scan_source`, so a second identification of the same card reverted its
    imageUrl to the high.webp CDN URL — which 404s for exactly the cards that
    resolved through low.webp / EN-mirror scans.
    """
    image: np.ndarray
    source: Optional[str]
    nbytes: int


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
    # Language evidence state, decided AFTER card identity (two-step):
    #   "confirmed" -> own OCR language evidence (or a single-language print)
    #   "uncertain" -> a same-card language twin competes and no language
    #                  evidence separates them; the identity stands but the
    #                  language must be reviewed by the user.
    language_status: str = "confirmed"
    # True when the adaptive difficulty gate routed this request through the
    # minimal-OCR / reduced-verification budget (unambiguous artwork case).
    fast_path: bool = False
    hints: Optional[OcrHints] = None
    evidence: list[str] = field(default_factory=list)
    elapsed_ms: int = 0
    timings: dict = field(default_factory=dict)
    # Set when the visual route was DISABLED for this request because the
    # embedding failed numerical validation (NaN/inf/zero-norm). The OCR
    # route still ran; the decision honestly reflects the missing evidence
    # instead of a fabricated similarity.
    visual_error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "decision": self.decision,
            "best": self.best.to_dict() if self.best else None,
            "candidates": [c.to_dict() for c in self.candidates[:10]],
            "routeA": self.route_a_ok, "routeB": self.route_b_ok,
            "normalization": {"method": self.normalization_method,
                              "confidence": round(self.normalization_confidence, 3)},
            "orientation": self.orientation,
            "languageStatus": self.language_status,
            "fastPath": self.fast_path,
            "visualError": self.visual_error,
            "hints": self.hints.to_dict() if self.hints else None,
            "evidence": self.evidence,
            "elapsedMs": self.elapsed_ms,
            "timings": {k: round(v) for k, v in self.timings.items()},
        }


def candidate_from_record(record) -> "Candidate":
    """Build a Candidate from a CardRecord, including scan URL + variant."""
    import json as _json
    variant = None
    rarity = getattr(record, "rarity", "") or ""
    try:
        variants = _json.loads(record.variants or "{}")
        available = [["firstEdition", "1st Edition"], ["holo", "Holo"],
                     ["reverse", "Reverse Holo"], ["normal", "Normal"],
                     ["wPromo", "Promo (W)"]]
        labels = [label for key, label in available if variants.get(key) is True]
        variant = labels[0] if len(labels) == 1 else (", ".join(labels) if labels else None)
    except Exception:
        variant = None
    if variant is None and rarity:
        # No per-variant flags (set listing only): a distinctive rarity is
        # better display metadata than nothing. Never fabricated — it comes
        # verbatim from the source that published it.
        variant = rarity
    return Candidate(
        card_id=record.id, language=record.language, set_id=record.set_id,
        set_name=record.set_name, name=record.name, local_id=record.local_id,
        denominator=record.denominator, hp=record.hp,
        image_url=f"{record.image_base}/high.webp" if record.image_base else "",
        variant=variant,
        rarity=rarity,
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
        # A NaN/inf row in the index poisons EVERY query that touches it (a
        # NaN similarity wins argmax silently). Fail fast at load with an
        # actionable message instead of serving garbage rankings.
        if self.matrix.size and not np.isfinite(self.matrix).all():
            bad = int((~np.isfinite(self.matrix)).any(axis=1).sum())
            raise RuntimeError(
                f"index '{embedding_name}' contains {bad} non-finite row(s) (NaN/inf) — "
                f"rebuild it with: python scripts/build_index.py --model {embedding_name}")
        self.id_to_row = {cid: i for i, cid in enumerate(self.ids)}
        self.model = get_model(embedding_name)

    def search(self, image: np.ndarray, topk: int = TOPK, orientations: Optional[list[np.ndarray]] = None,
               return_views: bool = False):
        """Multi-view retrieval: each orientation x each photometric view is
        embedded; a card's score is its max similarity over all views.
        Raw views win on well-lit photos, gamma-normalized views rescue
        dark/washed-out ones (bake-off 2026-09-14: rank 2 -> 1 on the hardest).

        With return_views=True the (embeddings, view_orientation) pair is also
        returned so the caller can REUSE the raw-view rows for the confirmed
        memory lookup instead of embedding the same views twice per request.
        View order is [img0_raw, img0_gamma, img1_raw, img1_gamma, ...]."""
        images = orientations or [image]
        views: list[np.ndarray] = []
        view_orientation: list[int] = []
        for i, oriented in enumerate(images):
            for variant in photometric_variants(oriented):
                views.append(variant)
                view_orientation.append(i)
        embeddings = self.model.embed(views)
        scores = embeddings @ self.matrix.T  # [n_views, N]
        # Winning view per card + its orientation. argmax picks the FIRST view
        # on ties, so the raw variant of the winning orientation wins ties
        # deterministically (photometric variants are ordered raw-first).
        best_view = np.argmax(scores, axis=0)
        columns = np.arange(scores.shape[1])
        best_scores = scores[best_view, columns]
        orientation_of_view = np.asarray(view_orientation, dtype=np.int64)
        orientation_idx = orientation_of_view[best_view]
        order = np.argsort(-best_scores)[:topk]
        results = []
        for row in order:
            key = self.ids[int(row)]
            language, card_id = key.split("|", 1)
            results.append((language, card_id, float(best_scores[int(row)]), int(orientation_idx[int(row)])))
        if return_views:
            return results, embeddings, view_orientation
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
        self._scan_cache = OrderedDict()  # key -> ScanCacheEntry (FIFO, byte-bounded)
        self._scan_cache_bytes = 0
        # key -> expiry epoch-seconds. TTL-classified negative cache:
        # 404 gaps live 6 h, rate-limits 60 s, transient failures 120 s.
        self._scan_misses: dict[str, float] = {}
        # Single-flight: key -> Event for an IN-PROGRESS scan load. With
        # RECOGNITION_MAX_CONCURRENCY > 1 (or /scan + recognize racing), N
        # threads requesting the same miss would each download/decode it; the
        # first one works and the rest wait on the event, then read the cache.
        self._scan_inflight: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        # Cache observability (surfaced on /health so tuning decisions use
        # numbers, not guesses). hits = decoded-RAM hits; loads = downloads+
        # decodes actually performed; missHits = negative-cache hits (skipped
        # loads); evictions = byte-budget evictions.
        self._scan_cache_hits = 0
        self._scan_loads = 0
        self._scan_miss_hits = 0
        self._scan_evictions = 0
        # LRU byte-bounded cache of SIFT features extracted from OFFICIAL
        # SCANS (query features are per-request and never cached here). A
        # scan's descriptors are deterministic for the lifetime of the decoded
        # file, so a re-photographed card skips its ~20-60 ms detectAndCompute.
        # Keyed by language|cardId|scanSource (a re-resolution to a different
        # quality/mirror is a different image and must not reuse features).
        self._sift_cache: OrderedDict[str, SiftFeatures] = OrderedDict()
        self._sift_cache_bytes = 0
        self._sift_cache_hits = 0
        self._sift_extractions = 0
        self._sift_evictions = 0

    @property
    def ocr_ready(self) -> bool:
        """OCR sessions loaded (readiness reporting for /health)."""
        return self.ocr is not None and self.ocr.loaded

    @property
    def embedding_ready(self) -> bool:
        """Embedding session loaded (readiness reporting for /health)."""
        return self.index is not None and self.index.model is not None and self.index.model.loaded

    def warm(self) -> None:
        """Eagerly load EVERY lazy component. The index matrix is loaded at
        construction, but the embedding ONNX session and the OCR det/rec
        sessions are lazy: without this, ready=true would still mean a
        multi-second stall on the FIRST photo (session creation + graph
        optimization). Used by --preload and by readiness probing: after
        warm() returns, the next photo can be served at full speed."""
        if self.index is not None and self.index.model is not None:
            self.index.model.warm()
        self.ocr.warm()

    def runtime_providers(self) -> dict:
        """Per-session ACTUAL providers for /health: what each model really
        runs on right now (ORT can silently fall back to CPU)."""
        embedding = self.index.model.provider if self.index is not None and self.index.model is not None else ""
        ocr_detector = self.ocr.provider if self.ocr is not None else ""
        ocr_recognizer = ""
        if self.ocr is not None and self.ocr._rec is not None:
            ocr_recognizer = self.ocr._rec.provider
        return {"embedding": embedding or "not-loaded",
                "ocrDetector": ocr_detector or "not-loaded",
                "ocrRecognizer": ocr_recognizer or "not-loaded"}

    # ------------------------------------------------------------- scan access
    # Byte-bounded FIFO cache of decoded candidate scans. Entry-count bounds
    # are unsafe here: official scans range from ~1.5 MB to ~7 MB decoded, so
    # 400 entries can hold gigabytes on a memory-tight machine (OOM observed
    # at 3.5 GB RSS). The budget keeps the whole service under ~1 GB of scan
    # memory while still covering the per-request verification working set.
    # Tunable via RECOGNITION_SCAN_CACHE_MB on the target machine (256/400/512
    # are the interesting values; default keeps the measured-safe 400 MB).
    SCAN_CACHE_MAX_BYTES = int(os.environ.get("RECOGNITION_SCAN_CACHE_MB", "400")) * 1024 * 1024

    # Negative cache with per-reason TTL (epoch-seconds expiry). The old
    # plain set remembered misses FOREVER: one timeout at 09:00 hid a
    # perfectly downloadable scan until the process restarted. Classes:
    #   not-found    every URL in the chain 404'd -> definitive CDN gap, 6 h;
    #   rate-limited 429                              -> short backoff,  60 s;
    #   transient    timeout / 5xx / HTML-200 / decode-> retry soon,    120 s.
    # Every TTL is shorter than the old "forever", so this only ever retries
    # MORE, never less.
    MISS_TTL_NOT_FOUND = 6 * 3600.0
    MISS_TTL_RATE_LIMITED = 60.0
    MISS_TTL_TRANSIENT = 120.0

    def _miss_ttl(self, reason: str) -> float:
        if reason == "not-found" or reason == "no-base":
            return self.MISS_TTL_NOT_FOUND
        if reason == "rate-limited":
            return self.MISS_TTL_RATE_LIMITED
        return self.MISS_TTL_TRANSIENT

    # SIFT feature cache budget. Descriptors are ~1 MB per scan worst case
    # (2000 kpts x 128 float32) but typically 200-600 KB after the 512 px
    # prepping; 128 MB covers the per-request verification working set many
    # times over while staying far below the decoded-scan budget. Tunable via
    # RECOGNITION_SIFT_CACHE_MB (0 disables the cache entirely).
    SIFT_CACHE_MAX_BYTES = int(os.environ.get("RECOGNITION_SIFT_CACHE_MB", "128")) * 1024 * 1024

    def _scan_sift_features(self, candidate: "Candidate", scan: np.ndarray) -> Optional[SiftFeatures]:
        """SIFT features of an official scan, through the LRU cache.

        With the cache disabled (RECOGNITION_SIFT_CACHE_MB=0) the features are
        still extracted — the QUERY-side reuse (one extract per probe instead
        of one per candidate) does not depend on this cache at all."""
        if self.SIFT_CACHE_MAX_BYTES <= 0:
            return self.matcher.extract(scan)
        key = f"{candidate.language}|{candidate.card_id}|{candidate.scan_source or '-'}"
        with self._lock:
            cached = self._sift_cache.get(key)
            if cached is not None:
                self._sift_cache.move_to_end(key)
                self._sift_cache_hits += 1
                return cached
        features = self.matcher.extract(scan)
        with self._lock:
            # Another thread may have won the race; keep the first entry to
            # stay deterministic (identical content either way).
            if key not in self._sift_cache:
                self._sift_cache[key] = features
                self._sift_cache_bytes += features.nbytes
                self._sift_extractions += 1
                while self._sift_cache and self._sift_cache_bytes > self.SIFT_CACHE_MAX_BYTES:
                    _, old = self._sift_cache.popitem(last=False)
                    self._sift_cache_bytes -= old.nbytes
                    self._sift_evictions += 1
            else:
                self._sift_cache.move_to_end(key)
        # Return the LOCAL reference: a tiny budget may have evicted the entry
        # we just inserted, but the extracted features remain valid for this
        # caller regardless of cache residency.
        return features

    def cache_stats(self) -> dict:
        """Cache observability for /health: hit ratios + byte footprints."""
        with self._lock:
            return {
                "scanCache": {
                    "hits": self._scan_cache_hits, "loads": self._scan_loads,
                    "negativeHits": self._scan_miss_hits, "evictions": self._scan_evictions,
                    "entries": len(self._scan_cache), "bytes": self._scan_cache_bytes,
                    "maxBytes": self.SCAN_CACHE_MAX_BYTES,
                },
                "siftFeatureCache": {
                    "hits": self._sift_cache_hits, "extractions": self._sift_extractions,
                    "evictions": self._sift_evictions,
                    "entries": len(self._sift_cache), "bytes": self._sift_cache_bytes,
                    "maxBytes": self.SIFT_CACHE_MAX_BYTES,
                },
            }

    def _scan_image(self, candidate: "Candidate") -> Optional[np.ndarray]:
        key = f"{candidate.language}|{candidate.card_id}"
        while True:
            with self._lock:
                cached = self._scan_cache.get(key)
                if cached is not None:
                    self._scan_cache.move_to_end(key)
                    self._scan_cache_hits += 1
                    # The candidate that hit the cache is a NEW object: it must
                    # inherit the source the loader discovered, or its
                    # imageUrl regresses to high.webp (404 for low/mirror cards).
                    candidate.scan_source = cached.source
                    return cached.image
                expiry = self._scan_misses.get(key)
                if expiry is not None:
                    if time.time() < expiry:
                        self._scan_miss_hits += 1
                        return None
                    # TTL elapsed: this class of failure may have healed — retry
                    del self._scan_misses[key]
                event = self._scan_inflight.get(key)
                if event is None:
                    # First requester for this miss: own the load. Waiters hold
                    # a direct reference to this event, so it can be set after
                    # the registry entry is popped.
                    event = threading.Event()
                    self._scan_inflight[key] = event
                    break
            # Another thread is loading this exact scan: wait for it (never
            # under the lock) and re-check the cache/miss sets afterwards.
            event.wait()
        try:
            image = None
            source: Optional[str] = None
            reason = "transient"
            if self.catalog is not None:
                from .catalog import resolve_scan_classified
                record = self.catalog.card_by_key(candidate.language, candidate.card_id)
                alt_url = (getattr(record, "image_alt", "") or "") if record is not None else ""
                base = record.image_base if (record is not None and record.image_base) else None
                if base or alt_url:
                    resolved, reason = resolve_scan_classified(base, alt_url or None)
                    if resolved is not None:
                        path, source = resolved
                        data = np.fromfile(path, dtype=np.uint8)
                        image = cv2.imdecode(data, cv2.IMREAD_COLOR)
                        if image is None:
                            # truncated/corrupt file that passed the magic-byte
                            # check: treat as a miss, never serve it
                            path, source, image, reason = None, None, None, "transient"
                else:
                    reason = "no-base"
            if image is not None:
                candidate.scan_source = source
            nbytes = int(image.nbytes) if image is not None else 0
            with self._lock:
                if image is None:
                    # Remember the miss WITH its class-specific TTL: a 404 gap
                    # stays cached for hours, a timeout only for two minutes.
                    self._scan_misses[key] = time.time() + self._miss_ttl(reason)
                    return None
                self._scan_cache[key] = ScanCacheEntry(image=image, source=source, nbytes=nbytes)
                self._scan_cache_bytes += nbytes
                self._scan_misses.pop(key, None)
                self._scan_loads += 1
                while self._scan_cache and self._scan_cache_bytes > self.SCAN_CACHE_MAX_BYTES:
                    _, old = self._scan_cache.popitem(last=False)
                    self._scan_cache_bytes -= old.nbytes
                    self._scan_evictions += 1
            return image
        finally:
            with self._lock:
                self._scan_inflight.pop(key, None)
            event.set()

    # ---------------------------------------------------------------- route B
    def route_b(self, card: NormalizedCard, orientation: str = "0", minimal: bool = False,
                include_footer: bool = True) -> tuple[OcrHints, list[Candidate], int]:
        """OCR the card. Orientation comes from Route A (fast) when available;
        otherwise both orientations are tried and the richer read wins.

        minimal=True (safe fast path): only the critical-metadata regions run
        — top strip (name/HP) + footer (language/backup number) + the first
        two raw collector-number regions with the usual consensus early-stop.
        The deep-top band and the denoising ladder are skipped: they exist to
        rescue hard reads, and the fast path only runs on unambiguous cases."""
        if orientation == "180":
            primary = card.rotated180
            secondary = card.image
        else:
            primary = card.image
            secondary = card.rotated180
        best = self.ocr.read_card(primary, minimal=minimal, include_footer=include_footer)
        passes = best.passes
        if not best.lines or best.confidence_score < 1.2:
            other = self.ocr.read_card(secondary, minimal=minimal, include_footer=include_footer)
            passes += other.passes
            if other.confidence_score > best.confidence_score:
                best = other
        hints = extract_hints(best)
        candidates: list[Candidate] = []
        if self.catalog is not None and (hints.name or hints.local_id):
            candidates = self.catalog.text_candidates(hints)
        return hints, candidates, passes

    # ---------------------------------------------------------------- route A
    def route_a(self, card: NormalizedCard, return_views: bool = False):
        if return_views:
            results, view_embeddings, _ = self.index.search(
                card.image, self.topk, [card.image, card.rotated180], return_views=True)
        else:
            results = self.index.search(card.image, self.topk, [card.image, card.rotated180])
            view_embeddings = None
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
        if return_views:
            # Rows of the RAW view of each orientation for memory reuse
            # (photometric variants are ordered raw-first, so row
            # i * n_variants is orientation i's raw view).
            n_variants = len(photometric_variants(card.image))
            raw_rows = [i * n_variants for i in range(2)]
            return candidates, orientation, view_embeddings, raw_rows
        return candidates, orientation

    # ------------------------------------------------------------ verification
    def verify(self, card: NormalizedCard, candidates: list[Candidate], orientation: str = "0",
               hints: Optional[OcrHints] = None, verify_topk: Optional[int] = None) -> None:
        """Geometric verification. Uses Route A's winning orientation by default
        (halves cost); the opposite orientation is a fallback for weak quads.

        Beyond the top visual ranks, candidates whose OCR evidence (collector
        number + name) matches are always verified: EN-mirror embeddings rank
        low for localized cards, but the artwork still verifies exactly.
        """
        primary = card.rotated180 if orientation == "180" else card.image
        probe_variants = [primary]
        if card.confidence < 0.25:  # uncertain normalization: try both orientations
            # The OPPOSITE orientation, not a duplicate of the primary probe:
            # a weak quad can flip the 0/180 disambiguation, and the fallback
            # only means anything if it tests the other way up.
            probe_variants.append(card.image if orientation == "180" else card.rotated180)

        topk = self.verify_topk if verify_topk is None else verify_topk
        selected = list(candidates[:topk])
        if hints and hints.local_id and hints.number_confidence >= 0.5 and hints.name:
            already = {id(c) for c in selected}
            for candidate in candidates[topk:]:
                number_match = False
                if candidate.local_id:
                    try:
                        number_match = int(hints.local_id) == int(candidate.local_id)
                    except ValueError:
                        number_match = hints.local_id == candidate.local_id
                if not number_match:
                    continue
                similarity = name_similarity(hints.name, candidate.name or "")
                if similarity < 0.72:
                    continue
                if id(candidate) in already:
                    continue
                selected.append(candidate)
                already.add(id(candidate))
                if len(selected) >= topk + 8:
                    break

        # Query SIFT is computed ONCE per probe orientation for the whole
        # request. The old loop re-detected the query for EVERY candidate
        # (4x on the fast path, 12-20x on the full path, per probe): same
        # detector, same input, same descriptors, thrown away each time.
        # Matchers without extract()/match_features() (akaze, aliked) keep the
        # legacy per-candidate match() calls.
        reusable = hasattr(self.matcher, "extract") and hasattr(self.matcher, "match_features")
        probe_features = [self.matcher.extract(probe) for probe in probe_variants] if reusable else None

        for candidate in selected:
            scan = self._scan_image(candidate)
            if scan is None:
                continue
            best: Optional[Verification] = None
            if probe_features is not None:
                scan_features = self._scan_sift_features(candidate, scan)
                for query_features in probe_features:
                    verification = self.matcher.match_features(query_features, scan_features)
                    if best is None or verification.score > best.score:
                        best = verification
            else:
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
                numeric = True
                try:
                    match = int(hints.local_id) == int(candidate.local_id)
                except ValueError:
                    numeric = False
                    match = hints.local_id == candidate.local_id
                candidate.ocr_number_match = match
                # Full collector number N/M: the denominator is INDEPENDENT
                # evidence. "106/189" against a candidate printed "106/73" is
                # NOT a number match — it is a same-artwork reprint of another
                # set, which only a readable M can expose. Tri-state:
                #   None  -> M unknown on either side (evidence inert)
                #   True  -> full N/M agreement
                #   False -> N agrees but M contradicts (reprint of other set)
                if (match and hints.denominator is not None
                        and candidate.denominator is not None):
                    denominator_match = int(hints.denominator) == int(candidate.denominator)
                    candidate.ocr_denominator_match = denominator_match
                    candidate.ocr_full_number_match = denominator_match
                if match and hints.number_confidence >= 0.6:
                    if candidate.ocr_denominator_match is False:
                        # Readable N/M vs printed N/M' — strong penalty, symmetric
                        # with the local-id conflict, never a hard filter on
                        # weak reads (number_confidence gates the veto).
                        weights["ocr_denominator_conflict"] = -70.0 * hints.number_confidence
                    else:
                        weights["ocr_number"] = 45.0 * hints.number_confidence
                elif (not match and numeric and hints.number_confidence >= 0.75
                      and hints.denominator):
                    # Explicit collector-number contradiction: the photographed
                    # card claims N/M and this candidate prints a different N.
                    # Same-artwork reprints ride visual+verification to the top;
                    # only a readable number can expose them. Penalized, never
                    # a hard filter (low-confidence numbers stay inert).
                    weights["ocr_number_conflict"] = -70.0 * hints.number_confidence
            if hints.language and candidate.language == hints.language:
                candidate.ocr_language_match = True
                weights["ocr_language"] = 8.0 * hints.language_confidence
            elif not hints.language or hints.language_confidence < 0.5:
                # VERY WEAK language prior (pt-BR > EN > rest), applied ONLY
                # when OCR produced no usable language evidence. It exists to
                # break true visual ties between language twins toward the
                # user's dominant language (mostly pt-BR); at 1.5 points it
                # can never override a real OCR language read (8.0 * conf) or
                # any visual/verification lead, and the twin-uncertainty cap
                # still applies when evidence is absent.
                if candidate.language == "pt-BR":
                    weights["language_prior"] = 1.5
            if hints.hp and candidate.hp == hints.hp:
                candidate.ocr_hp_match = True
                weights["ocr_hp"] = 6.0 * hints.hp_confidence
            # Confirmed memory: AUXILIARY evidence folded in here (not before):
            # bounded well below verification (220) and strong-name (60) tiers
            # so memory alone can never produce IDENTIFICADO, while a strong
            # memory hit on the correct card survives the score recomputation.
            if candidate.memory_similarity >= 0:
                from .config import MEMORY_MIN_SIMILARITY
                strength = max(0.0, min(1.0, (candidate.memory_similarity - MEMORY_MIN_SIMILARITY) / 0.04))
                if strength > 0:
                    weights["confirmed_memory"] = 55.0 * strength
            candidate.score = sum(weights.values())
        return sorted(candidates, key=lambda c: -c.score)

    # ---------------------------------------------------------------- language
    # Language is a SEPARATE decision from card identity (two-step). Visual
    # similarity and geometric verification cannot tell a pt-BR print from
    # its EN twin (same artwork, same layout): letting a 0.9123 vs 0.9130
    # cosine decide the language is exactly the ambiguity bug. Mirrored EN
    # scans used for verification are NOT language evidence either.
    # 0.75 requires >= 2 characteristic OCR words for the winning language
    # with margin: a single shared word ("pokemon" is in BOTH the pt and en
    # lists) yields exactly 0.62, which must not count as strong evidence.
    LANGUAGE_STRONG_OCR_CONFIDENCE = 0.75

    def _apply_language_evidence(self, ranked: list[Candidate], hints: OcrHints) -> list[Candidate]:
        """Step B before decide(): between SAME-CARD language twins all
        identity evidence is equal by definition (same artwork/set/number),
        so only language evidence may order them. When the OCR language read
        is strong and matches a twin (not the current leader), that twin
        becomes the leader — the identity is unchanged, only the language
        is resolved by language evidence instead of visual noise.
        Scan availability (e.g. an EN mirror resolving for verification)
        never plays a role here."""
        if (not ranked or not hints.language
                or hints.language_confidence < self.LANGUAGE_STRONG_OCR_CONFIDENCE):
            return ranked
        best = ranked[0]
        if best.language == hints.language:
            return ranked  # leader already agrees with the language read
        for idx, twin in enumerate(ranked[1:], start=1):
            if twin.card_id == best.card_id and twin.language == hints.language:
                ranked.insert(0, ranked.pop(idx))
                break
        return ranked

    def _cap_uncertain_language(self, ranked: list[Candidate], hints: OcrHints,
                               decision: str, evidence: list[str]) -> tuple[str, list[str], str]:
        """Cap the decision when the language of the winning identity is
        still ambiguous; report languageStatus for the UI.

        Rules:
        - twins = retrieved candidates of the SAME card_id in another language;
        - strong language evidence = OCR language read that matches the winner
          (and, implicitly, not the twin);
        - twins present + no strong evidence -> language "uncertain": the card
          identity (artwork/set/number/printing) stands, but the decision is
          capped at PROVAVEL — never IDENTIFICADO with a possibly wrong tongue;
        - no twins -> the language is inherent to the winning catalog entry.
        """
        best = ranked[0] if ranked else None
        if best is None:
            return decision, evidence, "confirmed"
        twins = [c for c in ranked[1:] if c.card_id == best.card_id and c.language != best.language]
        if not twins:
            return decision, evidence, "confirmed"
        strong_language = (hints.language == best.language
                           and hints.language_confidence >= self.LANGUAGE_STRONG_OCR_CONFIDENCE)
        if strong_language:
            return decision, evidence, "confirmed"
        # Ambiguous language: keep the identity, flag the uncertainty and cap.
        evidence = ["language-uncertain"] + evidence
        if decision == "IDENTIFICADO":
            decision = "PROVAVEL"
        return decision, evidence, "uncertain"

    # ------------------------------------------------------------------ decide
    def decide(self, ranked: list[Candidate], hints: OcrHints) -> tuple[str, list[str]]:
        cal = self.calibration
        if not ranked:
            return "NAO_IDENTIFICADO", []
        best = ranked[0]
        # Margin against the best DIFFERENT card: language twins of the same
        # card_id (pt-BR / en prints verified against the same scan) differ by
        # a few points, which must not masquerade as a tight competition.
        second = None
        for candidate in ranked[1:]:
            if candidate.card_id != best.card_id:
                second = candidate
                break
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

        # Explicit collector-number contradiction on the top candidate: the
        # best match prints a different number than the photographed card —
        # either a different N (local-id conflict) or the same N with a
        # different M (denominator conflict: same-artwork reprint of another
        # set). Visual + geometric evidence cannot separate same-artwork
        # reprints, so a readable contradicting number caps the decision at
        # PROVAVEL — the user reviews instead of trusting a wrong exact match.
        id_conflict = (best.ocr_number_match is False
                       and hints.number_confidence >= 0.75 and hints.denominator)
        den_conflict = (best.ocr_denominator_match is False
                        and hints.number_confidence >= 0.75 and hints.denominator)
        number_conflict = id_conflict or den_conflict
        if id_conflict:
            evidence.append("collector-number-conflict")
        if den_conflict:
            evidence.append("denominator-conflict")

        strong_evidence = (verified or (best.visual_similarity >= cal["strong"] and len(evidence) >= 2))
        if strong_evidence and margin >= 25 and not number_conflict:
            return "IDENTIFICADO", evidence
        if len(evidence) >= 2 and margin >= 12:
            return "PROVAVEL", evidence
        if len(evidence) >= 1:
            return "REVISAR", evidence
        return "NAO_IDENTIFICADO", evidence

    # ---------------------------------------------------------------- recognize
    # Safe fast path gates (all must hold; measured against the calibration):
    #   - catalog present and normalization was not a weak quad (>= 0.25);
    #   - Top-1 visual similarity >= strong + 0.005;
    #   - visual margin to the best DIFFERENT card >= 0.02 — same-artwork
    #     reprints of other sets and same-card language twins sit within
    #     ~0.01 of each other, so a 0.02 gap means the artwork is unambiguous
    #     (twins are a LANGUAGE question, handled by the two-step logic);
    #   - on the fast path OCR still runs, but only the critical metadata
    #     regions (top strip + footer + 2 raw number regions), and fewer
    #     candidates go through SIFT verification.
    FAST_PATH_VISUAL_HEADROOM = 0.005
    FAST_PATH_VISUAL_MARGIN = 0.02
    FAST_PATH_VERIFY_TOPK = 4

    def _fast_path_eligible(self, card: NormalizedCard, route_a_candidates: list[Candidate]) -> bool:
        if self.catalog is None or not route_a_candidates or card.confidence < 0.25:
            return False
        cal = self.calibration
        best = route_a_candidates[0]
        if best.visual_similarity < cal["strong"] + self.FAST_PATH_VISUAL_HEADROOM:
            return False
        for candidate in route_a_candidates[1:]:
            if candidate.card_id != best.card_id:
                if best.visual_similarity - candidate.visual_similarity < self.FAST_PATH_VISUAL_MARGIN:
                    return False  # ambiguous artwork: reprint or lookalike competition
                break
        return True

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

        # Route A: visual retrieval (independent of OCR). The multi-view
        # embeddings come back so the memory lookup below can REUSE the raw
        # rows instead of embedding the same two views again per request.
        # FAIL-SAFE (P0): an invalid embedding (NaN/inf/zero-norm from a bad
        # provider) disables ONLY the visual route for THIS request — the
        # OCR route still runs and the decision honestly reflects the missing
        # evidence. One bad image must never kill the service process.
        t0 = time.time()
        route_a_candidates: list[Candidate] = []
        orientation = "0"
        view_embeddings = None
        raw_rows: list[int] = []
        try:
            route_a_candidates, orientation, view_embeddings, raw_rows = self.route_a(card, return_views=True)
        except InvalidEmbeddingError as exc:
            result.visual_error = str(exc)
            print(f"[recognize] visual route disabled for this request: {exc}", flush=True)
        timings["route_a_retrieval"] = (time.time() - t0) * 1000
        result.route_a_ok = bool(route_a_candidates)

        # Difficulty assessment (tier 1 -> easy/intermediate/hard). The safe
        # fast path only fires on unambiguous artwork with a confident quad.
        fast_path = self._fast_path_eligible(card, route_a_candidates)
        result.fast_path = fast_path
        # Language twins in the retrieved pool still need the footer OCR for
        # language evidence even on the fast path.
        has_twin = len({c.card_id for c in route_a_candidates}) < len(
            {(c.card_id, c.language) for c in route_a_candidates})

        # Memory of user-confirmed examples (exemplar retrieval). Threshold +
        # margin are calibrated for the embedding in use (see
        # scripts/benchmark_memory.py): SigLIP2 impostor similarity sits around
        # 0.886 median / 0.940 p95, so anything below the calibrated threshold
        # is NOT a safe match. Both orientations are probed (a 180-flipped
        # photo must still find its confirmed example) using the REUSED
        # route-A raw-view rows (no extra embedding inference).
        memory_hit = None
        if use_memory and view_embeddings is not None:
            t0 = time.time()
            try:
                from . import memory as memory_module
                memory_hit = (memory_module.lookup(view_embeddings[raw_rows[0]])
                              or memory_module.lookup(view_embeddings[raw_rows[1]]))
            except Exception:
                memory_hit = None
            timings["memory"] = (time.time() - t0) * 1000

        # Route B: OCR + text candidates (orientation hinted by Route A).
        # Fast path -> minimal OCR budget (critical metadata only); the
        # footer stays whenever language twins need its evidence.
        t0 = time.time()
        hints, route_b_candidates, ocr_passes = self.route_b(card, orientation, minimal=fast_path,
                                                             include_footer=not fast_path or has_twin)
        timings["ocr_passes"] = ocr_passes
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

        # Memory hit becomes bounded AUXILIARY evidence on its confirmed card.
        # The similarity is stored on the candidate (memory_similarity) and
        # weighted inside fuse(): the previous implementation added a score
        # bonus here that fuse() immediately recomputed away, so memory never
        # actually influenced the ranking.
        if memory_hit is not None:
            example, similarity = memory_hit.example, memory_hit.similarity
            record = self.catalog.card_by_key(example.language, example.card_id) if self.catalog else None
            if record is not None:
                key = example.card_id + "|" + example.language
                candidate = merged.get(key) or candidate_from_record(record)
                candidate.memory_similarity = max(candidate.memory_similarity, similarity)
                merged[key] = candidate

        # Geometric verification on the merged shortlist (route A candidates
        # first), plus route B candidates whose OCR text evidence (name AND
        # collector number) points at them: mirror-scan and low-rank true
        # cards would otherwise never reach verification. Fast path verifies
        # fewer candidates (the artwork is unambiguous there by gate).
        shortlist = sorted(merged.values(),
                           key=lambda c: -(c.visual_similarity if c.visual_similarity >= 0 else 0.5))
        t0 = time.time()
        self.verify(card, shortlist, orientation, hints,
                    verify_topk=self.FAST_PATH_VERIFY_TOPK if fast_path else None)
        timings["verification"] = (time.time() - t0) * 1000

        ranked = self.fuse(list(merged.values()), hints, route_b_candidates)
        # Step B of the two-step identity: language. Applied after fuse() so
        # card identity (artwork/set/number/printing) is settled first; strong
        # OCR language evidence may reorder SAME-CARD twins, and a still
        # ambiguous language caps the decision instead of guessing silently.
        ranked = self._apply_language_evidence(ranked, hints)
        decision, evidence = self.decide(ranked, hints)
        decision, evidence, language_status = self._cap_uncertain_language(ranked, hints, decision, evidence)
        result.language_status = language_status
        # A high-similarity, unambiguous confirmed-memory example may upgrade a
        # REVISAR to PROVAVEL (never to IDENTIFICADO — that always requires
        # independent route evidence).
        if memory_hit is not None:
            if "confirmed-memory" not in evidence:
                evidence = ["confirmed-memory"] + evidence
            if decision == "REVISAR":
                decision = "PROVAVEL"
        result.decision = decision
        result.evidence = evidence
        result.candidates = ranked
        result.best = ranked[0] if ranked else None
        result.elapsed_ms = int((time.time() - started) * 1000)
        result.timings = timings
        return result
