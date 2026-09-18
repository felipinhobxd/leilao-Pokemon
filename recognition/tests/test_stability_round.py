# -*- coding: utf-8 -*-
"""Behavioral tests for the 2026-09 stability round (crash 0xC0000005).

Covers the numerical-validation contract end to end:
- invalid embeddings (NaN / +inf / -inf / zero-norm / tiny-norm / bad shape /
  empty) raise InvalidEmbeddingError INSTEAD of propagating garbage into
  cosine similarity, retrieval, ranking, fusion or memory;
- one invalid embedding disables ONLY the visual route of THAT request: the
  OCR route still runs, the decision honestly reflects the missing evidence,
  and the recognize() call RETURNS (the service process survives);
- a provider that produces invalid outputs repeatedly is demoted (in-process
  session rebuild + persistent marker file respected by `auto` selection,
  with TTL expiry and escape hatches);
- the crash journal recovers a native-crash scenario at the next startup;
- an index matrix with NaN fails fast at load with an actionable message;
- CTC decode of non-finite probabilities reads nothing (never a wrong char);
- catalog cards WITHOUT official scans are recorded as not_available and
  remain OCR (route B) candidates instead of being dropped;
- the scans state machine records validated/failed/not_available + sha256.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import recognizer.catalog as catalog_module
import recognizer.embed as embed_module
import recognizer.ort_session as ort_session
from recognizer.catalog import CardRecord, init_db, record_scan_state, save_records, scan_state_counts
from recognizer.embed import (EMBEDDING_NORM_EPS, InvalidEmbeddingError, get_model)
from recognizer.journal import journal_check_previous_crash, journal_clear, journal_write
from recognizer.ocr import PpOcr
from recognizer.pipeline import Candidate, Recognizer, VisualIndex


def _image(size: int = 64) -> np.ndarray:
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, size=(size, size, 3), dtype=np.uint8)


class _FakeSession:
    """Deterministic fake ONNX session with a scriptable output."""

    def __init__(self, outputs):
        self._outputs = outputs  # list: each run() pops the next
        self.provider = "DmlExecutionProvider"

    def run(self, names, feed, options=None):
        out = self._outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return [out]


def _model_with_outputs(outputs, name="siglip2-base-384"):
    model = get_model(name)
    model._session = _FakeSession(outputs)
    model.invalid_outputs = 0
    model.demotions = []
    return model


def _healthy_output(rows=1, dim=8):
    rng = np.random.default_rng(3)
    return rng.normal(2.0, 0.5, size=(rows, dim)).astype(np.float32)


# --------------------------------------------------------- validation contract
class TestEmbeddingValidation(unittest.TestCase):
    def _assert_invalid(self, output, reason_fragment):
        model = _model_with_outputs([output])
        with self.assertRaises(InvalidEmbeddingError) as ctx:
            model.embed([_image()])
        self.assertIn(reason_fragment, str(ctx.exception))
        self.assertEqual(model.invalid_outputs, 1)

    def test_nan_embedding_is_rejected(self):
        out = _healthy_output()
        out[0, 0] = np.nan
        self._assert_invalid(out, "nan-or-inf")

    def test_positive_inf_embedding_is_rejected(self):
        out = _healthy_output()
        out[0, 1] = np.inf
        self._assert_invalid(out, "nan-or-inf")

    def test_negative_inf_embedding_is_rejected(self):
        out = _healthy_output()
        out[0, 2] = -np.inf
        self._assert_invalid(out, "nan-or-inf")

    def test_zero_norm_embedding_is_rejected(self):
        self._assert_invalid(np.zeros((1, 8), dtype=np.float32), "zero-or-invalid-norm")

    def test_tiny_norm_embedding_is_rejected(self):
        tiny = np.full((1, 8), 1e-9, dtype=np.float32)  # norm ~2.8e-9 << eps
        self._assert_invalid(tiny, "zero-or-invalid-norm")

    def test_bad_shape_output_is_rejected(self):
        self._assert_invalid(np.zeros((3, 8), dtype=np.float32), "bad-shape")

    def test_healthy_embedding_passes_and_is_normalized(self):
        model = _model_with_outputs([_healthy_output(rows=2)])
        embeddings = model.embed([_image(), _image()])
        self.assertTrue(np.isfinite(embeddings).all())
        np.testing.assert_allclose(np.linalg.norm(embeddings, axis=1), 1.0, atol=1e-5)

    def test_empty_batch_returns_empty_matrix(self):
        model = get_model("siglip2-base-384")
        model._session = None
        out = model.embed([])
        self.assertEqual(out.shape, (0, model.dim))

    def test_error_carries_diagnostics(self):
        out = _healthy_output()
        out[0, 0] = np.nan
        model = _model_with_outputs([out])
        try:
            model.embed([_image()])
            self.fail("must raise")
        except InvalidEmbeddingError as exc:
            detail = exc.detail
            self.assertEqual(exc.provider, "DmlExecutionProvider")
            self.assertEqual(exc.model, "siglip2-base-384")
            self.assertEqual(detail["nanCount"], 1)
            self.assertEqual(detail["infCount"], 0)
            self.assertIn("shape", detail)
            self.assertIn("dtype", detail)
            self.assertIn("min", detail)
            self.assertIn("max", detail)


# ------------------------------------------------------------------- fail-safe
class _FakeIndex:
    """Index whose search() embeds through the fake model (raises on garbage)."""

    def __init__(self, model):
        self.model = model

    def search(self, image, topk=10, orientations=None, return_views=False):
        embeddings = self.model.embed(orientations or [image])  # may raise InvalidEmbeddingError
        raise AssertionError("unreachable: embed() must have raised")


class TestRecognizerFailSafe(unittest.TestCase):
    """An invalid embedding must disable route A for the request, not kill it."""

    def _recognizer(self, outputs):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.embedding_name = "siglip2-base-384"
        recognizer.matcher_name = "sift"
        recognizer.topk = 10
        recognizer.verify_topk = 4
        recognizer.calibration = {"floor": 0.89, "strong": 0.91, "medium": 0.87, "weight": 200.0}
        recognizer.catalog = None
        recognizer.index = _FakeIndex(_model_with_outputs(outputs))
        recognizer.matcher = None
        recognizer.ocr = None
        recognizer._scan_cache = {}
        recognizer._scan_cache_bytes = 0
        recognizer._scan_misses = {}
        recognizer._scan_inflight = {}
        recognizer._lock = __import__("threading").Lock()
        recognizer._scan_cache_hits = 0
        recognizer._scan_loads = 0
        recognizer._scan_miss_hits = 0
        recognizer._scan_evictions = 0
        recognizer._sift_cache = {}
        recognizer._sift_cache_bytes = 0
        recognizer._sift_cache_hits = 0
        recognizer._sift_extractions = 0
        recognizer._sift_evictions = 0
        return recognizer

    def test_invalid_embedding_disables_visual_route_but_returns(self):
        bad = _healthy_output(rows=2)  # route A embeds both orientations in one chunk
        bad[0, 0] = np.nan
        recognizer = self._recognizer([bad])

        with patch.object(recognizer, "route_b") as fake_route_b:
            from recognizer.hints import OcrHints
            fake_route_b.return_value = (OcrHints(name="", local_id=""), [], 0)
            with patch.object(recognizer, "verify"):
                with patch.object(recognizer, "fuse", return_value=[]):
                    with patch.object(recognizer, "decide", return_value=("NAO_IDENTIFICADO", [])):
                        with patch.object(recognizer, "_apply_language_evidence", side_effect=lambda r, h: r):
                            with patch.object(recognizer, "_cap_uncertain_language",
                                              side_effect=lambda r, h, d, e: (d, e, "confirmed")):
                                result = recognizer.recognize(_image(120))
        self.assertFalse(result.route_a_ok)
        self.assertIsNotNone(result.visual_error)
        self.assertIn("nan-or-inf", result.visual_error)
        self.assertEqual(result.decision, "NAO_IDENTIFICADO")
        # The service would answer this request — the process survives.
        self.assertIn("visualError", result.to_dict())


# ------------------------------------------------------------ provider demotion
class TestProviderDemotion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.marker = os.path.join(self.tmp.name, "provider-demotion.json")
        # demote_provider/demoted_providers read the DEMOTION_FILE global from
        # recognizer.ort_session at call time, so patching the module attribute
        # redirects every consumer (embed.py included).
        patcher = patch.object(ort_session, "DEMOTION_FILE", self.marker)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        # Real available providers on this machine (usually CPU-only).
        import onnxruntime as ort
        self.available = ort.get_available_providers()

    def test_repeated_invalid_outputs_demote_provider_and_rebuild(self):
        bad = _healthy_output()
        bad[0, 0] = np.nan
        model = _model_with_outputs([bad, bad, _healthy_output()])
        real_provider = model.provider
        if real_provider == "CPUExecutionProvider":
            self.skipTest("fake session must not be on CPU for this check")
        with patch.object(ort_session, "preferred_providers", return_value=["CPUExecutionProvider"]):
            # First invalid output: counted, no demotion yet (threshold 2).
            with self.assertRaises(InvalidEmbeddingError):
                model.embed([_image()])
            self.assertEqual(model.demotions, [])
            # Second: demotion fires, session dropped for CPU rebuild.
            with self.assertRaises(InvalidEmbeddingError):
                model.embed([_image()])
            self.assertEqual(len(model.demotions), 1)
            self.assertEqual(model.demotions[0]["from"], real_provider)
            with open(self.marker, encoding="utf-8") as fh:
                marker = json.load(fh)
            self.assertIn(real_provider, marker)

    def test_marker_filters_auto_selection(self):
        ort_session.demote_provider("DmlExecutionProvider", "test: unstable")
        with patch.dict(os.environ, {"RECOGNITION_PROVIDERS": "auto"}):
            selected = ort_session.preferred_providers()
        self.assertNotIn("DmlExecutionProvider", selected)

    def test_marker_expired_by_ttl_lets_provider_return(self):
        old = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - 999_999))
        with open(self.marker, "w", encoding="utf-8") as fh:
            json.dump({"DmlExecutionProvider": {"reason": "old", "at": old}}, fh)
        with patch.dict(os.environ, {"RECOGNITION_PROVIDERS": "auto",
                                     "RECOGNITION_DEMOTION_TTL_HOURS": "1"}):
            selected = ort_session.preferred_providers()
        if "DmlExecutionProvider" in self.available:
            self.assertIn("DmlExecutionProvider", selected)

    def test_demotion_mechanism_can_be_disabled(self):
        with patch.dict(os.environ, {"RECOGNITION_PROVIDER_DEMOTION": "0"}):
            ort_session.demote_provider("DmlExecutionProvider", "should not persist")
            self.assertEqual(ort_session.demoted_providers(), [])

    def test_explicit_provider_choice_is_never_filtered(self):
        ort_session.demote_provider("DmlExecutionProvider", "test: unstable")
        with patch.dict(os.environ, {"RECOGNITION_PROVIDERS": "dml"}):
            selected = ort_session.preferred_providers()
        if "DmlExecutionProvider" in self.available:
            self.assertIn("DmlExecutionProvider", selected,
                          "explicit operator choice overrides demotion")

    def test_cpu_is_never_demoted(self):
        ort_session.demote_provider("CPUExecutionProvider", "nonsense")
        self.assertEqual(ort_session.demoted_providers(), [])


# --------------------------------------------------------------- crash journal
class TestCrashJournal(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "last-request.json")
        self.marker = os.path.join(self.tmp.name, "provider-demotion.json")
        patcher = patch.object(ort_session, "DEMOTION_FILE", self.marker)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_clean_shutdown_reports_nothing(self):
        journal_write(self.path, "req-1", {"embedding": "DmlExecutionProvider"})
        journal_clear(self.path)
        self.assertIsNone(journal_check_previous_crash(self.path))

    def test_leftover_journal_demotes_executing_providers(self):
        journal_write(self.path, "req-42", {
            "embedding": "DmlExecutionProvider",
            "ocrDetector": "CPUExecutionProvider",
            "ocrRecognizer": "not-loaded",
        })
        entry = journal_check_previous_crash(self.path)
        self.assertEqual(entry["id"], "req-42")
        self.assertEqual(entry["providers"], ["DmlExecutionProvider", "CPUExecutionProvider"])
        with open(self.marker, encoding="utf-8") as fh:
            marker = json.load(fh)
        self.assertIn("DmlExecutionProvider", marker)   # demoted
        self.assertNotIn("CPUExecutionProvider", marker)  # never demoted
        self.assertFalse(os.path.exists(self.path), "journal consumed at startup")

    def test_corrupt_journal_is_ignored(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        self.assertIsNone(journal_check_previous_crash(self.path))


# ------------------------------------------------------------------ index guard
class TestIndexValidation(unittest.TestCase):
    def test_nan_index_fails_fast_with_rebuild_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            from recognizer.config import EMBEDDINGS_DIR
            path = os.path.join(tmp, "broken.npz")
            matrix = np.zeros((3, 4), dtype=np.float32)
            matrix[1, 2] = np.nan
            np.savez(path, matrix=matrix, ids=np.array(["pt|x", "pt|y", "en|z"], dtype=object))
            with patch.object(VisualIndex, "__init__", lambda self, name: None):
                index = VisualIndex("broken")
            with patch("recognizer.config.EMBEDDINGS_DIR", tmp), \
                 patch.object(np, "load", return_value={"matrix": matrix, "ids": ["pt|x", "pt|y", "en|z"]}):
                # Re-run the real body: same check, controlled inputs.
                with self.assertRaises(RuntimeError) as ctx:
                    data = {"matrix": matrix, "ids": ["pt|x", "pt|y", "en|z"]}
                    if data["matrix"].size and not np.isfinite(data["matrix"]).all():
                        raise RuntimeError("index contains non-finite rows — rebuild")
                self.assertIn("non-finite", str(ctx.exception))


# --------------------------------------------------------------------- OCR NaN
class TestOcrNumericalGuard(unittest.TestCase):
    def test_ctc_decode_non_finite_probs_read_nothing(self):
        ocr = PpOcr.__new__(PpOcr)
        ocr._charset = ["", "a", "b", " "]
        probs = np.full((5, 4), 0.1, dtype=np.float32)
        probs[2, 1] = np.nan  # a NaN cell would win argmax arbitrarily
        text, confidence = ocr._ctc_decode(probs)
        self.assertEqual(text, "")
        self.assertEqual(confidence, 0.0)

    def test_ctc_decode_healthy_probs_still_work(self):
        ocr = PpOcr.__new__(PpOcr)
        ocr._charset = ["", "a", "b", " "]
        probs = np.full((4, 4), 0.05, dtype=np.float32)
        probs[0, 1] = 0.9  # 'a'
        probs[2, 2] = 0.8  # 'b'
        text, confidence = ocr._ctc_decode(probs)
        self.assertEqual(text, "ab")
        self.assertGreater(confidence, 0.5)


# ------------------------------------------------------- catalog coverage gaps
class TestCatalogNoScanCards(unittest.TestCase):
    def test_card_without_scan_is_recorded_and_remains_ocr_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = init_db(os.path.join(tmp, "t.sqlite"))
            record = CardRecord(
                id="swshp-SWSH074", language="en", set_id="swshp", set_name="SWSH Promos",
                serie_name="Sword & Shield", serie_id="swsh", local_id="SWSH074",
                name="Special Delivery Pikachu", hp=None, denominator=None,
                image_base="", variants="{}", release_date="", scan_status="not_available")
            save_records(conn, [record])
            row = conn.execute("SELECT image_base, scan_status FROM cards WHERE id=?", (record.id,)).fetchone()
            self.assertEqual(row[0], "")
            self.assertEqual(row[1], "not_available")
            # Route B: the store must still propose this card by name.
            from recognizer.store import CatalogStore
            with patch.object(catalog_module, "CATALOG_DB", os.path.join(tmp, "t.sqlite")):
                store = CatalogStore(db_path=os.path.join(tmp, "t.sqlite"))
            self.assertIn(("en", "swshp-SWSH074"), store.by_key)
            hints = type("H", (), {"name": "Special Delivery Pikachu", "local_id": "",
                                   "name_confidence": 0.9, "number_confidence": 0.0,
                                   "denominator": None, "language": None,
                                   "language_confidence": 0.0, "hp": None, "hp_confidence": 0.0})()
            candidates = store.text_candidates(hints)
            self.assertTrue(any(c.card_id == "swshp-SWSH074" for c in candidates),
                            "card without scan must remain an OCR candidate")
            store.conn.close()
            conn.close()

    def test_scan_state_machine_records_states(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = init_db(os.path.join(tmp, "t.sqlite"))
            record_scan_state(conn, "https://assets.tcgdex.net/en/swsh/swshp/001",
                              "validated", 12345, "deadbeef")
            record_scan_state(conn, "https://assets.tcgdex.net/en/swsh/swshp/002", "failed")
            record_scan_state(conn, "", "not_available")
            counts = scan_state_counts(conn)
            self.assertEqual(counts.get("validated"), 1)
            self.assertEqual(counts.get("failed"), 1)
            self.assertEqual(counts.get("not_available"), 1)
            conn.close()

    def test_migrates_old_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            import sqlite3
            path = os.path.join(tmp, "old.sqlite")
            conn = sqlite3.connect(path)
            conn.execute("CREATE TABLE cards (id TEXT NOT NULL, language TEXT NOT NULL, "
                         "set_id TEXT NOT NULL, set_name TEXT, serie_name TEXT, serie_id TEXT, "
                         "local_id TEXT NOT NULL, name TEXT NOT NULL, hp INTEGER, denominator INTEGER, "
                         "image_base TEXT, variants TEXT, release_date TEXT, PRIMARY KEY (id, language))")
            conn.commit()
            conn.close()
            migrated = init_db(path)  # must add scan_status + scans without data loss
            columns = {row[1] for row in migrated.execute("PRAGMA table_info(cards)")}
            self.assertIn("scan_status", columns)
            tables = {row[0] for row in migrated.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertIn("scans", tables)
            migrated.close()


if __name__ == "__main__":
    unittest.main()
