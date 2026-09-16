#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Post-merge hardening regression tests (no ONNX models, no network).

Every test here reproduces a concrete bug found by the independent review
(2026-09-16) BEFORE the fix, so the behaviors stay fixed:

- orientation view selection in VisualIndex.search (argmax vs impossible
  max-then-compare);
- opposite-orientation probe in Recognizer.verify (was a duplicate);
- full collector number N/M end-to-end (denominator used to die in TS);
- denominator as independent fusion evidence (match/conflict/veto);
- OCR number consensus (a single confident read no longer stops the ladder);
- confirmed-memory threshold + margin calibration (0.80 was inside the
  SigLIP2 impostor distribution);
- scan cache validation on HITS (not just downloads), EN mirror, magic bytes;
- catalog fetch completeness reporting (partial != complete).

Run:  python -m unittest discover -s tests -v   (from recognition/)
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer import catalog as catalog_module
from recognizer import memory as memory_module
from recognizer.config import (DEFAULT_ALLOWED_ORIGINS, EMBEDDING_CALIBRATION)
from recognizer.hints import extract_hints
from recognizer.ocr import OcrLine, number_consensus_reached, number_read_groups
from recognizer.pipeline import Candidate, Recognizer, VisualIndex

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def fake_png(size: int = 8192) -> bytes:
    return PNG_MAGIC + b"\x00" * (size - len(PNG_MAGIC))


def fake_html(size: int = 8192) -> bytes:
    body = b"<html><body>404 not found</body></html>"
    return body + b" " * max(0, size - len(body))


class FakeLine:
    def __init__(self, text, confidence, region="name"):
        self.text = text
        self.confidence = confidence
        self.region = region


class FakeRead:
    def __init__(self, lines):
        self.lines = lines
        self.text = " ".join(l.text for l in lines)
        self.confidence_score = sum(l.confidence for l in lines)


# --------------------------------------------------------------------------- P0-1
class TestOrientationViewSelection(unittest.TestCase):
    """VisualIndex.search must report the orientation of the WINNING view.

    The old code computed best_scores = scores.max(axis=0) and then tested
    scores[i] > best_scores — logically impossible after the max — so
    orientation_idx was stuck at 0 even when the 180 view won.
    """

    def _index(self, matrix: np.ndarray, ids: list[str]) -> VisualIndex:
        index = VisualIndex.__new__(VisualIndex)
        index.embedding_name = "test"
        index.matrix = matrix.astype(np.float32)
        index.ids = ids
        index.id_to_row = {cid: i for i, cid in enumerate(ids)}

        class FakeModel:
            name = "fake"

            def embed(self, views):
                # One embedding dimension per view: view i is the unit vector
                # e_i, so scores[i, c] = 1 exactly when card c "wants" view i.
                n = len(views)
                return np.eye(n, dtype=np.float32)

        index.model = FakeModel()
        return index

    def _search(self, matrix, ids):
        import cv2
        index = self._index(matrix, ids)
        img = np.zeros((840, 600, 3), dtype=np.uint8)
        rot = cv2.rotate(img, cv2.ROTATE_180)
        # photometric_variants -> [raw, gamma] per orientation: 4 views total,
        # view_orientation == [0, 0, 1, 1]
        return index.search(img, topk=len(ids), orientations=[img, rot])

    def test_view0_wins_reports_orientation_0(self):
        results = self._search(np.array([[1, 0, 0, 0]]), ["pt-BR|cardA"])
        self.assertEqual(results[0][2:], (1.0, 0))

    def test_gamma_of_0_wins_reports_orientation_0(self):
        results = self._search(np.array([[0, 1, 0, 0]]), ["pt-BR|cardA"])
        self.assertEqual(results[0][2:], (1.0, 0))

    def test_view180_wins_reports_orientation_180(self):
        results = self._search(np.array([[0, 0, 1, 0]]), ["pt-BR|cardA"])
        self.assertEqual(results[0][2:], (1.0, 1))

    def test_gamma_of_180_wins_reports_orientation_180(self):
        results = self._search(np.array([[0, 0, 0, 1]]), ["pt-BR|cardA"])
        self.assertEqual(results[0][2:], (1.0, 1))

    def test_per_card_orientation_is_independent(self):
        matrix = np.array([
            [1, 0, 0, 0],  # cardA: view 0
            [0, 1, 0, 0],  # cardB: gamma of 0
            [0, 0, 1, 0],  # cardC: view 180
            [0, 0, 0, 1],  # cardD: gamma of 180
        ])
        results = self._search(matrix, ["pt-BR|a", "pt-BR|b", "pt-BR|c", "pt-BR|d"])
        by_card = {card_id: orientation for _lang, card_id, _sim, orientation in results}
        self.assertEqual(by_card, {"a": 0, "b": 0, "c": 1, "d": 1})

    def test_tie_prefers_first_view_deterministically(self):
        # views 0 and 2 tie: argmax must pick view 0 (raw, orientation 0)
        results = self._search(np.array([[1, 0, 1, 0]]), ["pt-BR|cardA"])
        self.assertEqual(results[0][3], 0)


# --------------------------------------------------------------------------- P0-2
class TestVerifyOppositeOrientation(unittest.TestCase):
    """verify() must probe the OPPOSITE orientation on weak quads — the old
    code appended the primary again, so the fallback did nothing."""

    class RecordingMatcher:
        name = "fake"

        def __init__(self):
            self.probes = []

        def match(self, a, b):
            import recognizer.features as features
            self.probes.append((id(a), id(b)))
            return features.Verification(0, 0, 0.0, 999.0, None, self.name)

    def _recognizer(self, matcher):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.matcher = matcher
        recognizer.verify_topk = 4
        recognizer.calibration = EMBEDDING_CALIBRATION["siglip2-base-384"]
        return recognizer

    def _card(self, confidence):
        from recognizer.normalize import NormalizedCard
        image = np.zeros((840, 600, 3), dtype=np.uint8)
        image[:] = 30
        rotated = np.ascontiguousarray(image[::-1, ::-1])
        return NormalizedCard(image=image, rotated180=rotated, rotation_code=0,
                              method="aspect-fallback", confidence=confidence, quad=None)

    def _candidate(self):
        return Candidate(card_id="swsh3-106", language="pt-BR", set_id="swsh3",
                         set_name="Darkness Ablaze", name="Purrloin", local_id="106",
                         denominator=189, hp=60)

    def test_weak_quad_probes_both_orientations_no_duplicates(self):
        for orientation in ("0", "180"):
            matcher = self.RecordingMatcher()
            recognizer = self._recognizer(matcher)
            card = self._card(confidence=0.1)
            recognizer._scan_image = lambda candidate: np.zeros((840, 600, 3), dtype=np.uint8)
            recognizer.verify(card, [self._candidate()], orientation)
            probes = matcher.probes
            self.assertEqual(len(probes), 2, f"orientation={orientation}: esperava 2 probes, veio {len(probes)}")
            first, second = probes
            self.assertNotEqual(first[0], second[0], "o segundo probe repetiu o primário")
            expected_primary = id(card.rotated180) if orientation == "180" else id(card.image)
            self.assertEqual(first[0], expected_primary)
            self.assertEqual({first[0], second[0]}, {id(card.image), id(card.rotated180)})

    def test_confident_quad_probes_only_primary(self):
        matcher = self.RecordingMatcher()
        recognizer = self._recognizer(matcher)
        card = self._card(confidence=0.9)
        recognizer._scan_image = lambda candidate: np.zeros((840, 600, 3), dtype=np.uint8)
        recognizer.verify(card, [self._candidate()], "0")
        self.assertEqual(len(matcher.probes), 1)
        self.assertEqual(matcher.probes[0][0], id(card.image))


# --------------------------------------------------------------------------- P0-3
class TestFullCollectorNumber(unittest.TestCase):
    def test_extracts_full_number_106_over_189(self):
        read = FakeRead([FakeLine("Purrloin", 0.95), FakeLine("106/189", 0.93, "number")])
        hints = extract_hints(read)
        self.assertEqual(hints.local_id, "106")
        self.assertEqual(hints.denominator, 189)
        self.assertGreaterEqual(hints.number_confidence, 0.9)

    def test_candidate_dict_carries_denominator(self):
        candidate = Candidate(card_id="swsh3-106", language="pt-BR", set_id="swsh3",
                              set_name="Darkness Ablaze", name="Purrloin", local_id="106",
                              denominator=189, hp=60)
        payload = candidate.to_dict()
        self.assertEqual(payload["localId"], "106")
        self.assertEqual(payload["denominator"], 189)
        self.assertEqual(payload["cardNumber"], "106/189")
        self.assertIn("ocrDenominatorMatch", payload)
        self.assertIn("ocrFullNumberMatch", payload)

    def test_memory_example_roundtrips_denominator(self):
        example = memory_module.MemoryExample(
            id="mem-1", card_id="swsh3-106", language="pt-BR", name="Purrloin",
            set_id="swsh3", set_name="Darkness Ablaze", local_id="106",
            denominator=189, confirmed_at=0, image_file="mem-1.jpg")
        data = example.to_dict()
        self.assertEqual(data["denominator"], 189)
        self.assertEqual(data["cardNumber"], "106/189")


# --------------------------------------------------------------------------- P0-4
class TestDenominatorFusionEvidence(unittest.TestCase):
    """106/189 against a candidate printed 106/73 is NOT a number match."""

    def _recognizer(self):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.calibration = EMBEDDING_CALIBRATION["siglip2-base-384"]
        return recognizer

    def _candidate(self, card_id, denominator, name="Purrloin"):
        return Candidate(card_id=card_id, language="pt-BR", set_id="swsh3",
                         set_name="S", name=name, local_id="106",
                         denominator=denominator, hp=60, visual_similarity=0.93)

    def _hints(self, confidence=0.9):
        from recognizer.hints import OcrHints
        return OcrHints(name="Purrloin", name_confidence=0.95, local_id="106",
                        denominator=189, number_confidence=confidence)

    def test_full_match_gets_positive_number_weight(self):
        recognizer = self._recognizer()
        candidate = self._candidate("swsh3-106", 189)
        ranked = recognizer.fuse([candidate], self._hints(), [])
        self.assertTrue(ranked[0].ocr_number_match)
        self.assertTrue(ranked[0].ocr_denominator_match)
        self.assertTrue(ranked[0].ocr_full_number_match)
        self.assertGreater(ranked[0].score, 0)

    def test_denominator_conflict_is_penalized(self):
        recognizer = self._recognizer()
        correct = self._candidate("swsh3-106", 189)
        reprint = self._candidate("swsh3.5-106", 73)
        ranked = recognizer.fuse([reprint, correct], self._hints(), [])
        by_id = {c.card_id: c for c in ranked}
        self.assertTrue(by_id["swsh3.5-106"].ocr_number_match)  # N bate
        self.assertFalse(by_id["swsh3.5-106"].ocr_denominator_match)  # M não
        self.assertFalse(by_id["swsh3.5-106"].ocr_full_number_match)
        # same-artwork reprint loses to the exact print when M is readable
        self.assertGreater(by_id["swsh3-106"].score, by_id["swsh3.5-106"].score + 100)

    def test_exact_print_wins_over_conflicting_reprint(self):
        recognizer = self._recognizer()
        hints = self._hints(confidence=0.95)
        correct = self._candidate("swsh3-106", 189)
        reprint = self._candidate("swsh3.5-106", 73)
        # same-artwork visual twins: both retrieve strongly, verification is
        # unavailable — exactly the case only the denominator can separate
        reprint.visual_similarity = 0.95
        correct.visual_similarity = 0.95
        ranked = recognizer.fuse([reprint, correct], hints, [])
        decision, evidence = recognizer.decide(ranked, hints)
        self.assertEqual(ranked[0].card_id, "swsh3-106", "o print exato deve vencer")
        # the CORRECT print has no conflict on it: a clean IDENTIFICADO is right
        self.assertEqual(decision, "IDENTIFICADO")
        self.assertNotIn("denominator-conflict", evidence)

    def test_denominator_conflict_caps_when_wrong_print_ranks_first(self):
        recognizer = self._recognizer()
        hints = self._hints(confidence=0.95)
        reprint = self._candidate("swsh3.5-106", 73)
        reprint.visual_similarity = 0.95
        # correct print NOT in catalog: the reprint still ranks first — the
        # conflict must cap the decision instead of trusting the wrong match
        ranked = recognizer.fuse([reprint], hints, [])
        self.assertEqual(ranked[0].card_id, "swsh3.5-106")
        decision, evidence = recognizer.decide(ranked, hints)
        self.assertEqual(decision, "PROVAVEL")
        self.assertIn("denominator-conflict", evidence)

    def test_local_id_conflict_still_vetoes(self):
        recognizer = self._recognizer()
        from recognizer.hints import OcrHints
        hints = OcrHints(name="Purrloin", name_confidence=0.95, local_id="107",
                         denominator=189, number_confidence=0.95)
        candidate = self._candidate("swsh3-106", 189)
        candidate.visual_similarity = 0.95
        decision, evidence = recognizer.decide([candidate], hints)
        self.assertEqual(decision, "PROVAVEL")
        self.assertIn("collector-number-conflict", evidence)

    def test_weak_ocr_never_vetoes(self):
        recognizer = self._recognizer()
        hints = self._hints(confidence=0.5)  # below the 0.75 veto gate
        reprint = self._candidate("swsh3.5-106", 73)
        reprint.visual_similarity = 0.95
        recognizer.fuse([reprint], hints, [])
        decision, evidence = recognizer.decide([reprint], hints)
        self.assertNotIn("denominator-conflict", evidence)

    def test_unknown_denominator_keeps_legacy_behavior(self):
        recognizer = self._recognizer()
        candidate = self._candidate("swsh3-106", None)
        ranked = recognizer.fuse([candidate], self._hints(), [])
        self.assertTrue(ranked[0].ocr_number_match)
        self.assertIsNone(ranked[0].ocr_denominator_match)
        self.assertGreater(ranked[0].score, 0)


# --------------------------------------------------------------------------- P1-6
class TestOcrNumberConsensus(unittest.TestCase):
    def _lines(self, *reads):
        return [OcrLine(text=text, confidence=conf, box=np.zeros((4, 2), dtype=np.float32), region="number")
                for text, conf in reads]

    def test_single_confident_read_is_not_consensus(self):
        lines = self._lines(("106/189", 0.99))
        self.assertFalse(number_consensus_reached(lines))

    def test_two_agreeing_reads_are_consensus(self):
        lines = self._lines(("106/189", 0.95), ("106/189", 0.62))
        self.assertTrue(number_consensus_reached(lines))

    def test_two_disagreeing_reads_are_not_consensus(self):
        lines = self._lines(("106/189", 0.95), ("108/189", 0.9))
        self.assertFalse(number_consensus_reached(lines))

    def test_groups_tally_vote_mass(self):
        lines = self._lines(("106/189", 0.9), ("106/189", 0.6), ("108/189", 0.95))
        groups = number_read_groups(lines)
        self.assertAlmostEqual(sum(groups[("106", "189")]), 1.5)
        self.assertAlmostEqual(sum(groups[("108", "189")]), 0.95)

    def test_extract_hints_outvotes_lone_confident_misread(self):
        read = FakeRead(self._lines(("106/189", 0.7), ("106/189", 0.65), ("108/189", 0.97)))
        hints = extract_hints(read)
        self.assertEqual(hints.local_id, "106")
        self.assertEqual(hints.denominator, 189)

    def test_non_number_regions_do_not_count(self):
        lines = [OcrLine(text="106/189", confidence=0.99, box=np.zeros((4, 2)), region="footer")]
        self.assertFalse(number_consensus_reached(lines))


# --------------------------------------------------------------------------- P0-5
class TestMemoryCalibration(unittest.TestCase):
    """Confirmed-memory lookup must respect the calibrated threshold AND the
    margin over the best different-card example."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rec-memory-")
        self.memory_file = os.path.join(self.tmp, "memory.json")
        self.embeddings_file = os.path.join(self.tmp, "memory-embeddings.npz")
        self.images_dir = os.path.join(self.tmp, "memory-images")
        os.makedirs(self.images_dir, exist_ok=True)
        self._orig = (memory_module.MEMORY_FILE, memory_module.MEMORY_EMBEDDINGS, memory_module.MEMORY_IMAGES)
        memory_module.MEMORY_FILE = self.memory_file
        memory_module.MEMORY_EMBEDDINGS = self.embeddings_file
        memory_module.MEMORY_IMAGES = self.images_dir

    def tearDown(self):
        memory_module.MEMORY_FILE, memory_module.MEMORY_EMBEDDINGS, memory_module.MEMORY_IMAGES = self._orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_memory(self, examples_spec):
        """examples_spec: list of (example_id, card_id, vector)."""
        examples = []
        ids, vectors = [], []
        for example_id, card_id, vector in examples_spec:
            examples.append(memory_module.MemoryExample(
                id=example_id, card_id=card_id, language="pt-BR", name="X",
                set_id="s", set_name="S", local_id="1", denominator=99,
                confirmed_at=0, image_file=f"{example_id}.jpg"))
            ids.append(example_id)
            vectors.append(np.asarray(vector, dtype=np.float32))
            with open(os.path.join(self.images_dir, f"{example_id}.jpg"), "wb") as fh:
                fh.write(fake_png())
        with open(self.memory_file, "w", encoding="utf-8") as fh:
            json.dump([e.to_dict() for e in examples], fh)
        np.savez_compressed(self.embeddings_file, ids=np.array(ids, dtype=object),
                            matrix=np.vstack(vectors))

    def test_hit_above_threshold_without_competition(self):
        self._write_memory([("mem-1", "swsh3-106", [1.0, 0.0])])
        match = memory_module.lookup(np.array([1.0, 0.0], dtype=np.float32), threshold=0.95, margin=0.012)
        self.assertIsNotNone(match)
        self.assertEqual(match.example.card_id, "swsh3-106")
        self.assertGreaterEqual(match.similarity, 0.95)

    def test_impostor_below_threshold_is_rejected(self):
        # SigLIP2 impostors concentrate around 0.886 — the OLD 0.80 threshold
        # would have matched this.
        self._write_memory([("mem-1", "other-card", [1.0, 0.0])])
        query = np.array([0.886, 0.4644], dtype=np.float32)  # cos ~ 0.886
        query /= np.linalg.norm(query)
        self.assertIsNone(memory_module.lookup(query, threshold=0.95, margin=0.012))

    def test_ambiguous_margin_is_rejected(self):
        # card-a and card-b embeddings sit 6 degrees apart; the query sits
        # between them — best ~0.999, runner-up ~0.998: lead < margin
        self._write_memory([
            ("mem-1", "card-a", [1.0, 0.0]),
            ("mem-2", "card-b", [0.99452, 0.10453]),
        ])
        query = np.array([0.99863, 0.05234], dtype=np.float32)
        query /= np.linalg.norm(query)
        match = memory_module.lookup(query, threshold=0.95, margin=0.012)
        self.assertIsNone(match)

    def test_same_card_examples_are_not_competition(self):
        self._write_memory([
            ("mem-1", "swsh3-106", [1.0, 0.0]),
            ("mem-2", "swsh3-106", [0.99452, 0.10453]),
        ])
        query = np.array([0.99863, 0.05234], dtype=np.float32)
        query /= np.linalg.norm(query)
        match = memory_module.lookup(query, threshold=0.95, margin=0.012)
        self.assertIsNotNone(match)

    def test_default_threshold_is_calibrated_not_080(self):
        from recognizer.config import MEMORY_MARGIN, MEMORY_MIN_SIMILARITY
        self.assertGreaterEqual(MEMORY_MIN_SIMILARITY, 0.93,
                                "threshold precisa ficar acima da distribuição de impostores")
        self.assertGreaterEqual(MEMORY_MARGIN, 0.005)

    def test_add_example_is_idempotent_and_atomic(self):
        card = {"cardId": "swsh3-106", "language": "pt-BR", "name": "Purrloin",
                "localId": "106", "denominator": 189}
        image = fake_png()
        embedding = np.array([[1.0, 0.0]], dtype=np.float32)
        first = memory_module.add_example(card, image, embedding)
        second = memory_module.add_example(card, image, embedding)
        self.assertEqual(first.id, second.id, "mesma imagem confirmada 2x não deve duplicar")
        examples = memory_module.load_examples()
        self.assertEqual(len(examples), 1)
        self.assertEqual(examples[0].denominator, 189)
        self.assertFalse(os.path.exists(self.memory_file + ".tmp"))
        self.assertFalse(os.path.exists(self.embeddings_file + ".tmp"))

    def test_add_example_evicts_beyond_limit(self):
        original = memory_module.MEMORY_MAX_EXAMPLES
        memory_module.MEMORY_MAX_EXAMPLES = 2
        try:
            card = {"cardId": "c", "language": "pt-BR", "name": "X"}
            for i in range(3):
                memory_module.add_example(card, fake_png(4096 + i),
                                          np.array([[1.0, 0.0]], dtype=np.float32))
            self.assertEqual(len(memory_module.load_examples()), 2)
        finally:
            memory_module.MEMORY_MAX_EXAMPLES = original


# --------------------------------------------------------------------------- P2-13
class TestScanCacheIntegrity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="rec-cache-")
        self._orig_cache = catalog_module.IMAGE_CACHE_DIR
        catalog_module.IMAGE_CACHE_DIR = self.tmp
        self._orig_http = catalog_module._http_get
        self.calls = []

    def tearDown(self):
        catalog_module.IMAGE_CACHE_DIR = self._orig_cache
        catalog_module._http_get = self._orig_http
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _http(self, payloads):
        """url-pattern -> bytes | exception; records every call."""

        def fake(url, timeout=30.0, retries=3):
            self.calls.append(url)
            for pattern, payload in payloads.items():
                if pattern in url:
                    if isinstance(payload, Exception):
                        raise payload
                    return payload
            raise RuntimeError(f"unexpected url {url}")

        return fake

    def test_magic_byte_rejection(self):
        self.assertFalse(catalog_module._looks_like_image(fake_html(8192)))
        self.assertFalse(catalog_module._looks_like_image(fake_png(100)), "arquivo minúsculo não é scan")
        self.assertTrue(catalog_module._looks_like_image(fake_png(8192)))

    def test_cached_html_is_detected_removed_and_replaced(self):
        # a >4KB HTML file poisoned the cache (old code accepted size > 0)
        base = "https://assets.tcgdex.net/pt/me/me01/091"
        path = catalog_module.scan_path(base, "high.webp")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(fake_html())
        catalog_module._http_get = self._http({"/high.webp": fake_png()})
        resolved = catalog_module.resolve_scan(base)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved[1], "high.webp")
        with open(resolved[0], "rb") as fh:
            self.assertEqual(fh.read(8), PNG_MAGIC, "o arquivo HTML não foi substituído")
        self.assertEqual(len(self.calls), 1, "re-download deve ocorrer exatamente uma vez")

    def test_en_mirror_fallback_and_cache(self):
        base = "https://assets.tcgdex.net/pt/swsh3/swsh3/106"
        catalog_module._http_get = self._http({
            "pt/swsh3/swsh3/106": FileNotFoundError("404"),
            "en/swsh3/swsh3/106": fake_png(),
        })
        resolved = catalog_module.resolve_scan(base)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved[1], "en-high.webp")
        self.assertTrue(catalog_module._en_mirror_base(base).endswith("/en/swsh3/swsh3/106"))
        # second resolve: pure cache hit, zero network
        before = len(self.calls)
        resolved2 = catalog_module.resolve_scan(base)
        self.assertEqual(resolved2[0], resolved[0])
        self.assertEqual(len(self.calls), before)

    def test_corrupt_en_mirror_cache_is_rejected(self):
        base = "https://assets.tcgdex.net/pt/swsh3/swsh3/106"
        corrupt = catalog_module.scan_path(base, "en-high.webp")
        os.makedirs(os.path.dirname(corrupt), exist_ok=True)
        with open(corrupt, "wb") as fh:
            fh.write(fake_html())
        catalog_module._http_get = self._http({
            "pt/swsh3/swsh3/106": FileNotFoundError("404"),
            "en/swsh3/swsh3/106": fake_png(),
        })
        resolved = catalog_module.resolve_scan(base)
        self.assertIsNotNone(resolved)
        with open(resolved[0], "rb") as fh:
            self.assertEqual(fh.read(8), PNG_MAGIC)

    def test_resolve_scan_none_for_missing_base(self):
        self.assertIsNone(catalog_module.resolve_scan(None))
        self.assertIsNone(catalog_module.resolve_scan(""))


# --------------------------------------------------------------------------- P2-14
class TestCatalogCompleteness(unittest.TestCase):
    def setUp(self):
        self._orig_http = catalog_module._http_get

    def tearDown(self):
        catalog_module._http_get = self._orig_http

    def _sets_payload(self, *set_ids):
        import json as _json
        return _json.dumps([{"id": s} for s in set_ids]).encode()

    def test_failed_set_is_reported_not_silently_skipped(self):
        import json as _json
        ok_detail = _json.dumps({
            "name": "Set OK", "serie": {"id": "swsh", "name": "SWSH"},
            "cardCount": {"official": 2},
            "cards": [
                {"id": "ok-001", "localId": "1", "name": "Alpha", "image": "https://assets.tcgdex.net/pt/ok/ok/001"},
                {"id": "ok-002", "localId": "2", "name": "Beta", "image": "https://assets.tcgdex.net/pt/ok/ok/002"},
            ],
        }).encode()

        def fake(url, timeout=30.0, retries=3):
            if "/sets?pagination" in url:
                return self._sets_payload("ok", "broken")
            if "/sets/ok" in url:
                return ok_detail
            raise RuntimeError("network down")

        catalog_module._http_get = fake
        records, report = catalog_module.fetch_language_cards("pt-BR")
        self.assertEqual(len(records), 2)
        self.assertEqual(report.expected_sets, 2)
        self.assertEqual(report.succeeded_sets, 1)
        self.assertEqual(report.failed_sets, ["broken"])
        self.assertFalse(report.ok)

    def test_complete_fetch_reports_ok(self):
        import json as _json
        detail = _json.dumps({
            "name": "Set OK", "serie": {}, "cardCount": {"official": 1},
            "cards": [{"id": "ok-001", "localId": "1", "name": "Alpha",
                       "image": "https://assets.tcgdex.net/pt/ok/ok/001"}],
        }).encode()

        def fake(url, timeout=30.0, retries=3):
            if "/sets?pagination" in url:
                return self._sets_payload("ok")
            return detail

        catalog_module._http_get = fake
        records, report = catalog_module.fetch_language_cards("pt-BR")
        self.assertTrue(report.ok)
        self.assertEqual(report.expected_sets, 1)
        self.assertEqual(len(records), 1)


# --------------------------------------------------------------------------- P1-8
class TestAllowedOrigins(unittest.TestCase):
    def test_defaults_are_localhost_only(self):
        origins = DEFAULT_ALLOWED_ORIGINS
        self.assertIn("http://localhost:3000", origins)
        for origin in origins:
            self.assertTrue(origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1"))

    def test_env_overrides(self):
        from recognizer import config as config_module
        original = os.environ.pop("RECOGNITION_ALLOWED_ORIGINS", None)
        try:
            os.environ["RECOGNITION_ALLOWED_ORIGINS"] = "https://leilao.example.com, https://staging.example.com"
            self.assertEqual(config_module.allowed_origins(),
                             ["https://leilao.example.com", "https://staging.example.com"])
            os.environ["RECOGNITION_ALLOWED_ORIGINS"] = "  ,  ,"
            self.assertEqual(config_module.allowed_origins(), DEFAULT_ALLOWED_ORIGINS)
        finally:
            if original is None:
                os.environ.pop("RECOGNITION_ALLOWED_ORIGINS", None)
            else:
                os.environ["RECOGNITION_ALLOWED_ORIGINS"] = original


if __name__ == "__main__":
    unittest.main(verbosity=2)


# --------------------------------------------------------------------------- memory-fusion
class TestMemoryFusionWeight(unittest.TestCase):
    """The confirmed-memory bonus must SURVIVE fuse().

    The pre-fix code set `candidate.score = max(candidate.score, 55*strength)`
    BEFORE fuse(), but fuse() recomputes `candidate.score = sum(weights)` —
    the bonus was silently wiped and memory never influenced ranking.
    """

    def _recognizer(self):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.calibration = EMBEDDING_CALIBRATION["siglip2-base-384"]
        return recognizer

    def _candidate(self, card_id="swsh3-106", language="pt-BR", visual=0.93):
        candidate = Candidate(card_id=card_id, language=language, set_id="swsh3",
                              set_name="Darkness Ablaze", name="Purrloin", local_id="106",
                              denominator=189, hp=60)
        candidate.visual_similarity = visual
        return candidate

    def _hints(self):
        from recognizer.hints import OcrHints
        return OcrHints()

    def test_memory_weight_survives_fuse_recomputation(self):
        recognizer = self._recognizer()
        candidate = self._candidate()
        candidate.memory_similarity = 0.97  # strength = (0.97-0.95)/0.04 = 0.5
        ranked = recognizer.fuse([candidate], self._hints(), [])
        expected_visual = max(0.0, 0.93 - 0.89) * 200.0  # 8.0
        self.assertAlmostEqual(ranked[0].score, expected_visual + 55.0 * 0.5, places=4)

    def test_memory_similarity_below_threshold_contributes_nothing(self):
        recognizer = self._recognizer()
        candidate = self._candidate()
        candidate.memory_similarity = 0.95  # strength 0 -> inert
        ranked = recognizer.fuse([candidate], self._hints(), [])
        self.assertAlmostEqual(ranked[0].score, max(0.0, 0.93 - 0.89) * 200.0, places=4)

    def test_memory_ranks_confirmed_card_above_equal_visual_impostor(self):
        recognizer = self._recognizer()
        confirmed = self._candidate(card_id="swsh3-106", visual=0.9300)
        confirmed.memory_similarity = 0.99  # strength 1.0 -> +55
        impostor = self._candidate(card_id="swsh3-107", visual=0.9301)
        ranked = recognizer.fuse([impostor, confirmed], self._hints(), [])
        self.assertEqual(ranked[0].card_id, "swsh3-106",
                         "memória confirmada deve subir o ranking da carta correta")

    def test_wrong_memory_never_beats_verification_evidence(self):
        recognizer = self._recognizer()
        from recognizer.features import Verification
        true_card = self._candidate(card_id="swsh3-106", visual=0.90)
        true_card.verification = Verification(inliers=40, matches=50, inlier_ratio=0.8,
                                              reprojection_error=2.0, homography=None, method="sift")
        wrong_memory_card = self._candidate(card_id="swsh3-107", visual=0.90)
        wrong_memory_card.memory_similarity = 1.0  # strongest possible memory
        ranked = recognizer.fuse([wrong_memory_card, true_card], self._hints(), [])
        self.assertEqual(ranked[0].card_id, "swsh3-106",
                         "memória errada não pode vencer evidência oficial (verificação)")

    def test_memory_alone_never_reaches_identificado(self):
        # Best possible memory (similarity 1.0 -> +55) with NO independent
        # evidence: no verification, no OCR, visual at impostor level.
        # decide() must stay below IDENTIFICADO (spec: memory alone caps at
        # PROVAVEL/REVISAR; recognize()'s upgrade path also only lifts
        # REVISAR -> PROVAVEL, never IDENTIFICADO).
        recognizer = self._recognizer()
        candidate = self._candidate(visual=0.886)  # impostor median similarity
        candidate.memory_similarity = 1.0
        hints = self._hints()
        ranked = recognizer.fuse([candidate], hints, [])
        decision, evidence = recognizer.decide(ranked, hints)
        self.assertNotEqual(decision, "IDENTIFICADO")
        self.assertIn(decision, ("REVISAR", "PROVAVEL", "NAO_IDENTIFICADO"))

    def test_memory_dict_exposes_similarity(self):
        payload = self._candidate().to_dict()
        self.assertIsNone(payload["memorySimilarity"])
        candidate = self._candidate()
        candidate.memory_similarity = 0.98
        self.assertEqual(candidate.to_dict()["memorySimilarity"], 0.98)
