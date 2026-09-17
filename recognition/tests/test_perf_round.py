# -*- coding: utf-8 -*-
"""Behavioral tests for the 2026-09 perf round.

Covers:
- TTL-classified negative cache (404 long, transient short, expiry retries)
- SIFT query-feature reuse (one extract per probe per request, not per
  candidate) and byte-identical match() vs extract()+match_features()
- scan SIFT feature cache (hit/miss/eviction, scanSource-keyed)
- failure-aware HTTP retries (404 definitive, 429 Retry-After, backoff)
- thread-local requests.Session reuse
- resolve_scan_classified failure-class priority
"""
from __future__ import annotations

import os
import sys
import threading
import time
import unittest
from collections import OrderedDict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import recognizer.catalog as catalog_module
import recognizer.features as features_module
from recognizer.catalog import (HttpRateLimited, _http_get, resolve_scan,
                                resolve_scan_classified)
from recognizer.features import SiftMatcher, get_matcher
from recognizer.pipeline import Candidate, Recognizer


def _textured_image(seed: int, size: int = 480) -> np.ndarray:
    """Deterministic noisy image: SIFT needs actual texture to find keypoints."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 255, size=(size, size, 3), dtype=np.uint8)


# --------------------------------------------------------------------- negative TTL
class TestNegativeCacheTTL(unittest.TestCase):
    def _recognizer(self):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer._scan_cache = OrderedDict()
        recognizer._scan_cache_bytes = 0
        recognizer._scan_misses = {}
        recognizer._scan_inflight = {}
        recognizer._lock = threading.Lock()
        recognizer._scan_cache_hits = 0
        recognizer._scan_loads = 0
        recognizer._scan_miss_hits = 0
        recognizer._scan_evictions = 0
        recognizer._sift_cache = OrderedDict()
        recognizer._sift_cache_bytes = 0
        recognizer._sift_cache_hits = 0
        recognizer._sift_extractions = 0
        recognizer._sift_evictions = 0
        recognizer.SIFT_CACHE_MAX_BYTES = 128 * 1024 * 1024
        recognizer.SCAN_CACHE_MAX_BYTES = 400 * 1024 * 1024
        return recognizer

    def _candidate(self) -> Candidate:
        return Candidate(card_id="me01-001", language="pt-BR", set_id="me01",
                         set_name="S", name="X", local_id="1", denominator=99, hp=None)

    def _patch_resolution(self, outcomes):
        """outcomes: list returned by successive resolve_scan_classified calls."""
        calls = {"n": 0}
        original = catalog_module.resolve_scan_classified

        def fake(image_base, alt_url=None):
            result = outcomes[min(calls["n"], len(outcomes) - 1)]
            calls["n"] += 1
            return result

        catalog_module.resolve_scan_classified = fake

        class FakeRecord:
            image_base = "https://assets.tcgdex.net/pt/me/me01/001"
            image_alt = ""

        class FakeCatalog:
            def card_by_key(self, language, card_id):
                return FakeRecord()

        def restore():
            catalog_module.resolve_scan_classified = original
        self.addCleanup(restore)
        return FakeCatalog(), calls

    def test_miss_is_remembered_within_ttl(self):
        recognizer = self._recognizer()
        catalog, calls = self._patch_resolution([(None, "not-found")])
        recognizer.catalog = catalog
        self.assertIsNone(recognizer._scan_image(self._candidate()))
        self.assertIsNone(recognizer._scan_image(self._candidate()))
        self.assertEqual(calls["n"], 1, "miss dentro do TTL não deve refazer o download")

    def test_transient_miss_expires_and_retries(self):
        recognizer = self._recognizer()
        catalog, calls = self._patch_resolution([(None, "transient")])
        recognizer.catalog = catalog
        self.assertIsNone(recognizer._scan_image(self._candidate()))
        # Force the TTL to elapse (120s class) without sleeping.
        key = next(iter(recognizer._scan_misses))
        recognizer._scan_misses[key] = time.time() - 1.0
        self.assertIsNone(recognizer._scan_image(self._candidate()))
        self.assertEqual(calls["n"], 2, "TTL vencido deve tentar de novo")

    def test_404_and_transient_get_different_ttls(self):
        recognizer = self._recognizer()
        catalog, _ = self._patch_resolution([(None, "not-found")])
        recognizer.catalog = catalog
        recognizer._scan_image(self._candidate())
        ttl_404 = next(iter(recognizer._scan_misses.values())) - time.time()
        self.assertGreaterEqual(ttl_404, 5 * 3600, "404 deve ficar horas em cache")

        recognizer2 = self._recognizer()
        catalog2, _ = self._patch_resolution([(None, "rate-limited")])
        recognizer2.catalog = catalog2
        recognizer2._scan_image(self._candidate())
        ttl_429 = next(iter(recognizer2._scan_misses.values())) - time.time()
        self.assertLessEqual(ttl_429, 90.0, "429 deve liberar logo para nova tentativa")

    def test_success_clears_stale_miss(self):
        recognizer = self._recognizer()
        import cv2 as cv2_mod
        catalog, _ = self._patch_resolution([
            (None, "transient"),
            (("/fake/scan.webp", "high.webp"), "ok"),
        ])
        recognizer.catalog = catalog
        original_fromfile = sys.modules["recognizer.pipeline"].np.fromfile

        def fake_fromfile(path, dtype=None):
            ok, buf = cv2_mod.imencode(".png", np.full((64, 64, 3), 200, np.uint8))
            return np.frombuffer(buf.tobytes(), dtype=np.uint8)
        sys.modules["recognizer.pipeline"].np.fromfile = fake_fromfile
        self.addCleanup(lambda: setattr(sys.modules["recognizer.pipeline"].np, "fromfile", original_fromfile))

        self.assertIsNone(recognizer._scan_image(self._candidate()))
        key = next(iter(recognizer._scan_misses))
        recognizer._scan_misses[key] = time.time() - 1.0  # expire the transient miss
        self.assertIsNotNone(recognizer._scan_image(self._candidate()))
        self.assertNotIn(key, recognizer._scan_misses, "sucesso deve limpar o miss pendente")


# --------------------------------------------------------------------- SIFT split
class TestSiftFeatureSplit(unittest.TestCase):
    """extract()+match_features() must reproduce match() exactly, and verify()
    must extract the query ONCE per probe instead of once per candidate."""

    def test_match_vs_extract_match_features_identical(self):
        matcher = get_matcher("sift")
        photo = _textured_image(1)
        scan = _textured_image(1, 520)  # different size -> different prepping
        different = _textured_image(2, 520)
        for b in (scan, different):
            via_match = matcher.match(photo, b)
            via_split = matcher.match_features(matcher.extract(photo), matcher.extract(b))
            self.assertEqual(via_match.inliers, via_split.inliers)
            self.assertEqual(via_match.matches, via_split.matches)
            self.assertAlmostEqual(via_match.inlier_ratio, via_split.inlier_ratio, places=6)
            self.assertAlmostEqual(via_match.reprojection_error, via_split.reprojection_error, places=4)
            self.assertAlmostEqual(via_match.score, via_split.score, places=6)

    def test_extract_is_deterministic(self):
        matcher = get_matcher("sift")
        image = _textured_image(3)
        first = matcher.extract(image)
        second = matcher.extract(image)
        self.assertEqual(first.width, second.width)
        self.assertEqual(len(first.kpts), len(second.kpts))
        np.testing.assert_array_equal(first.kpts, second.kpts)
        np.testing.assert_array_equal(first.desc, second.desc)

    def test_verify_extracts_query_once_per_probe(self):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.matcher = get_matcher("sift")
        recognizer._scan_cache = OrderedDict()
        recognizer._scan_cache_bytes = 0
        recognizer._scan_misses = {}
        recognizer._scan_inflight = {}
        recognizer._lock = threading.Lock()
        recognizer._scan_cache_hits = 0
        recognizer._scan_loads = 0
        recognizer._scan_miss_hits = 0
        recognizer._scan_evictions = 0
        recognizer._sift_cache = OrderedDict()
        recognizer._sift_cache_bytes = 0
        recognizer._sift_cache_hits = 0
        recognizer._sift_extractions = 0
        recognizer._sift_evictions = 0
        recognizer.SIFT_CACHE_MAX_BYTES = 128 * 1024 * 1024
        recognizer.SCAN_CACHE_MAX_BYTES = 400 * 1024 * 1024
        recognizer.verify_topk = 12

        scans = {f"c{i}": _textured_image(100 + i, 520) for i in range(5)}
        candidates = []
        for i in range(5):
            candidate = Candidate(card_id=f"c{i}", language="pt-BR", set_id="s",
                                  set_name="S", name=f"n{i}", local_id=str(i),
                                  denominator=99, hp=None)
            candidates.append(candidate)

        recognizer._scan_image = lambda candidate: scans[candidate.card_id]

        extract_calls = {"n": 0}
        real_extract = recognizer.matcher.extract

        def counting_extract(image):
            extract_calls["n"] += 1
            return real_extract(image)
        recognizer.matcher.extract = counting_extract

        class FakeCard:
            image = _textured_image(1)
            rotated180 = _textured_image(1)  # same seed: probe reuse is count-based
            confidence = 0.9
        # one probe orientation only (confident normalization)
        recognizer.verify(FakeCard(), candidates, orientation="0", hints=None)

        # 5 candidates x 1 probe: OLD code extracted the query 5 times (plus 5
        # scan sides). NEW code: 5 scan extracts + exactly 1 query extract.
        scan_side = 5
        self.assertEqual(extract_calls["n"], scan_side + 1,
                         "query deve ser extraída 1x por probe, não 1x por candidato")

    def test_scan_feature_cache_hit(self):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.matcher = get_matcher("sift")
        recognizer._scan_cache = OrderedDict()
        recognizer._scan_cache_bytes = 0
        recognizer._scan_misses = {}
        recognizer._scan_inflight = {}
        recognizer._lock = threading.Lock()
        recognizer._scan_cache_hits = 0
        recognizer._scan_loads = 0
        recognizer._scan_miss_hits = 0
        recognizer._scan_evictions = 0
        recognizer._sift_cache = OrderedDict()
        recognizer._sift_cache_bytes = 0
        recognizer._sift_cache_hits = 0
        recognizer._sift_extractions = 0
        recognizer._sift_evictions = 0
        recognizer.SIFT_CACHE_MAX_BYTES = 128 * 1024 * 1024
        recognizer.SCAN_CACHE_MAX_BYTES = 400 * 1024 * 1024

        scan = _textured_image(7, 520)
        candidate = Candidate(card_id="c1", language="pt-BR", set_id="s", set_name="S",
                              name="n", local_id="1", denominator=99, hp=None,
                              scan_source="high.webp")
        first = recognizer._scan_sift_features(candidate, scan)
        second = recognizer._scan_sift_features(candidate, scan)
        self.assertIs(first, second, "segunda leitura deve vir do cache")
        self.assertEqual(recognizer._sift_cache_hits, 1)
        self.assertEqual(recognizer._sift_extractions, 1)

        # Different scanSource -> different key -> fresh extraction
        other = Candidate(card_id="c1", language="pt-BR", set_id="s", set_name="S",
                          name="n", local_id="1", denominator=99, hp=None,
                          scan_source="low.webp")
        recognizer._scan_sift_features(other, scan)
        self.assertEqual(recognizer._sift_extractions, 2, "scanSource diferente é outra imagem")

    def test_scan_feature_cache_byte_bound(self):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.matcher = get_matcher("sift")
        recognizer._scan_cache = OrderedDict()
        recognizer._scan_cache_bytes = 0
        recognizer._scan_misses = {}
        recognizer._scan_inflight = {}
        recognizer._lock = threading.Lock()
        recognizer._scan_cache_hits = 0
        recognizer._scan_loads = 0
        recognizer._scan_miss_hits = 0
        recognizer._scan_evictions = 0
        recognizer._sift_cache = OrderedDict()
        recognizer._sift_cache_bytes = 0
        recognizer._sift_cache_hits = 0
        recognizer._sift_extractions = 0
        recognizer._sift_evictions = 0
        recognizer.SIFT_CACHE_MAX_BYTES = 1  # evict everything immediately
        recognizer.SCAN_CACHE_MAX_BYTES = 400 * 1024 * 1024

        scan = _textured_image(9, 520)
        candidate = Candidate(card_id="c1", language="pt-BR", set_id="s", set_name="S",
                              name="n", local_id="1", denominator=99, hp=None,
                              scan_source="high.webp")
        recognizer._scan_sift_features(candidate, scan)
        self.assertEqual(len(recognizer._sift_cache), 0, "orçamento de 1 byte deve evictar")
        self.assertGreater(recognizer._sift_evictions, 0)


# --------------------------------------------------------------------- HTTP retries
class TestHttpRetryClassification(unittest.TestCase):
    def setUp(self):
        self._orig_get_session = catalog_module._get_session
        self.sleeps = []
        self._orig_sleep = catalog_module.time.sleep
        catalog_module.time.sleep = lambda s: self.sleeps.append(s)

    def tearDown(self):
        catalog_module._get_session = self._orig_get_session
        catalog_module.time.sleep = self._orig_sleep

    def _respond(self, status_codes, headers=None):
        """Sequential responses: one status per request, then repeats the last."""
        state = {"n": 0}

        class FakeResponse:
            def __init__(self, status):
                self.status_code = status
                self.content = b"x" * 5000
                self.headers = headers or {}
        state["codes"] = list(status_codes)

        class FakeSession:
            def get(self, url, timeout=30.0):
                index = min(state["n"], len(state["codes"]) - 1)
                state["n"] += 1
                return FakeResponse(state["codes"][index])
        catalog_module._get_session = lambda: FakeSession()
        return state

    def test_404_is_definitive_no_retry(self):
        state = self._respond([404])
        with self.assertRaises(FileNotFoundError):
            _http_get("https://example.com/a", retries=3)
        self.assertEqual(state["n"], 1, "404 não deve ser retentado")

    def test_500_retries_then_raises(self):
        state = self._respond([500, 500, 500])
        with self.assertRaises(RuntimeError):
            _http_get("https://example.com/a", retries=3)
        self.assertEqual(state["n"], 3, "5xx deve usar todas as tentativas")
        self.assertTrue(self.sleeps, "deve haver backoff entre tentativas")

    def test_500_then_200_succeeds(self):
        state = self._respond([500, 200])
        data = _http_get("https://example.com/a", retries=3)
        self.assertEqual(len(data), 5000)
        self.assertEqual(state["n"], 2)

    def test_429_without_retry_after_raises_ratelimited(self):
        state = self._respond([429])
        with self.assertRaises(HttpRateLimited):
            _http_get("https://example.com/a", retries=1)
        self.assertEqual(state["n"], 1)

    def test_429_with_short_retry_after_recovers(self):
        state = self._respond([429, 200], headers={"Retry-After": "0"})
        data = _http_get("https://example.com/a", retries=2)
        self.assertEqual(len(data), 5000)
        self.assertEqual(state["n"], 2, "Retry-After curto deve ser respeitado e retentado")

    def test_429_with_huge_retry_after_raises(self):
        state = self._respond([429], headers={"Retry-After": "3600"})
        with self.assertRaises(HttpRateLimited) as ctx:
            _http_get("https://example.com/a", retries=3)
        self.assertEqual(ctx.exception.retry_after, 3600.0)
        self.assertEqual(state["n"], 1, "Retry-After longo não deve bloquear o worker")

    def test_session_is_reused_per_thread(self):
        sessions = []
        original = catalog_module._get_session

        def tracked():
            session = original()
            sessions.append(id(session))
            return session
        catalog_module._get_session = tracked
        _http_get  # ensure import
        # same thread -> same session object
        catalog_module._get_session = original
        first = catalog_module._get_session()
        second = catalog_module._get_session()
        self.assertIs(first, second, "mesma thread deve reusar a Session")

        results = {}
        def other_thread():
            results["session"] = catalog_module._get_session()
        thread = threading.Thread(target=other_thread)
        thread.start()
        thread.join()
        self.assertIsNot(results["session"], first, "threads diferentes têm Sessions próprias")


# --------------------------------------------------------------------- classified resolve
class TestResolveScanClassified(unittest.TestCase):
    def setUp(self):
        self.tmp = "/tmp/rec-classified-test" if os.name != "nt" else os.environ.get("TEMP", ".")
        os.makedirs(self.tmp, exist_ok=True)
        self._orig_cache = catalog_module.IMAGE_CACHE_DIR
        catalog_module.IMAGE_CACHE_DIR = self.tmp
        self._orig_http = catalog_module._http_get

    def tearDown(self):
        catalog_module.IMAGE_CACHE_DIR = self._orig_cache
        catalog_module._http_get = self._orig_http
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_all_404_is_not_found(self):
        catalog_module._http_get = lambda url, timeout=30.0, retries=3: (_ for _ in ()).throw(FileNotFoundError(url))
        resolved, reason = resolve_scan_classified("https://assets.tcgdex.net/pt/me/me01/001")
        self.assertIsNone(resolved)
        self.assertEqual(reason, "not-found")

    def test_mixed_404_and_timeout_is_transient(self):
        def fake(url, timeout=30.0, retries=3):
            if "en/" in url:
                raise TimeoutError("boom")
            raise FileNotFoundError(url)
        catalog_module._http_get = fake
        resolved, reason = resolve_scan_classified("https://assets.tcgdex.net/pt/swsh3/swsh3/106")
        self.assertIsNone(resolved)
        self.assertEqual(reason, "transient", "mistura de 404 + timeout não prova ausência")

    def test_429_wins_over_other_failures(self):
        def fake(url, timeout=30.0, retries=3):
            if "low" in url:
                raise HttpRateLimited(url, 30.0)
            raise FileNotFoundError(url)
        catalog_module._http_get = fake
        resolved, reason = resolve_scan_classified("https://assets.tcgdex.net/pt/me/me01/001")
        self.assertEqual(reason, "rate-limited")

    def test_ok_wrapped_for_legacy_resolve_scan(self):
        # resolve_scan keeps its old (resolved-only) signature.
        self.assertIsNone(resolve_scan("https://assets.tcgdex.net/pt/xx/yy/000"))
        resolved, reason = resolve_scan_classified("https://assets.tcgdex.net/pt/xx/yy/000")
        self.assertEqual(reason, "not-found")


if __name__ == "__main__":
    unittest.main()


# --------------------------------------------------------------------- build_catalog classes
class TestBuildCatalogLanguageClasses(unittest.TestCase):
    """Optional-language gaps must NEVER block the install; core gaps must.

    Since the 2026-09 catalog round, CORE = (pt-BR, en, ja) — EN + JA +
    pt-BR is the declared objective — and OPTIONAL = (es).
    """

    def _run_main(self, tmp_db, languages, fetch_side_effects, sets=("s1", "s2", "s3")):
        """Run build_catalog.main() against a temp DB with mocked fetching."""
        import recognizer.catalog as cat
        import scripts.build_catalog as bc
        from unittest.mock import patch

        calls = []

        def fake_fetch(language, sets_filter=None):
            calls.append((language, sets_filter))
            outcome = fetch_side_effects[language]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        def fake_listing(language):
            return [{"id": sid, "cardCount": {"total": 5, "official": 5}} for sid in sets]

        argv = ["build_catalog.py", "--languages", languages, "--no-card-details"]
        # Patch the build_catalog module namespace: it from-imports init_db,
        # so patching recognizer.catalog.init_db would leave the REAL default
        # DB in play (test pollution). Same reasoning for the return path:
        # every query re-opens the temp DB through this patched constructor.
        with patch.object(bc, "init_db", return_value=self._conn(tmp_db)), \
             patch.object(bc, "fetch_language_cards", side_effect=fake_fetch), \
             patch.object(bc, "fetch_sets_listing", side_effect=fake_listing), \
             patch.object(bc, "probe_sources",
                          return_value={"tcgdex": {"available": False, "note": "offline test"},
                                        "pokemon-tcg-data": {"available": False,
                                                             "note": "offline test"}}), \
             patch.object(sys, "argv", argv):
            try:
                bc.main()
                code = 0
            except SystemExit as exc:
                code = int(exc.code or 0)
        return code, calls, self._conn(tmp_db)

    @staticmethod
    def _conn(path):
        # Use the REAL init_db (patched only at the build_catalog namespace
        # level): the schema — including the scan_status column and the scans
        # state table — stays in sync with recognizer.catalog forever instead
        # of a hand-written CREATE TABLE drifting out of date.
        import recognizer.catalog as cat
        return cat.init_db(path)

    @staticmethod
    def _report(language, failed):
        from recognizer.catalog import FetchReport
        return FetchReport(language=language, expected_sets=3,
                           succeeded_sets=3 - len(failed), failed_sets=failed)

    def test_optional_gap_does_not_block(self):
        import tempfile
        from recognizer.catalog import CardRecord

        def cards(lang):
            return [CardRecord(id="a", language=lang, set_id="s1", set_name="S", serie_name="",
                               serie_id="", local_id="1", name="A", hp=None, denominator=None,
                               image_base="https://x/y", variants="{}", release_date="")]
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "t.sqlite")
            effects = {
                "pt-BR": (cards("pt-BR"), self._report("pt-BR", [])),
                "es": (cards("es"), self._report("es", ["set-broken"])),
            }
            code, calls, conn = self._run_main(db, "pt-BR,es", effects)
            self.assertEqual(code, 0, "gap em idioma OPCIONAL não pode bloquear a instalação")
            gaps = conn.execute("SELECT value FROM meta WHERE key='catalog.gaps.es'").fetchone()
            self.assertIsNotNone(gaps, "gap do idioma opcional deve ser registrado")
            self.assertIn("set-broken", gaps[0])
            stamp = conn.execute("SELECT value FROM meta WHERE key='catalog.updated.pt-BR'").fetchone()
            self.assertIsNotNone(stamp, "core completo deve ser estampado")

    def test_core_gap_blocks(self):
        import tempfile
        from recognizer.catalog import CardRecord

        def cards(lang):
            return [CardRecord(id="a", language=lang, set_id="s1", set_name="S", serie_name="",
                               serie_id="", local_id="1", name="A", hp=None, denominator=None,
                               image_base="https://x/y", variants="{}", release_date="")]
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "t.sqlite")
            effects = {
                "pt-BR": (cards("pt-BR"), self._report("pt-BR", ["core-set-broken"])),
                "ja": (cards("ja"), self._report("ja", [])),
            }
            code, calls, conn = self._run_main(db, "pt-BR,ja", effects)
            self.assertEqual(code, 1, "gap em idioma CORE deve bloquear a instalação")

    def test_gap_retry_only_fetches_failed_sets(self):
        import tempfile
        from recognizer.catalog import CardRecord

        def cards(lang):
            return [CardRecord(id="a", language=lang, set_id="s1", set_name="S", serie_name="",
                               serie_id="", local_id="1", name="A", hp=None, denominator=None,
                               image_base="https://x/y", variants="{}", release_date="")]
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "t.sqlite")
            # First run: ja (CORE since the catalog round) fails one set —
            # blocks, but saves the good rows and records the gap.
            effects = {"ja": (cards("ja"), self._report("ja", ["set-broken"]))}
            code, _, conn = self._run_main(db, "ja", effects)
            self.assertEqual(code, 1, "ja é CORE: gap bloqueia")
            # Second run: the recorded gap drives a retry of ONLY that set.
            effects2 = {"ja": (cards("ja"), self._report("ja", []))}
            argv_calls = []
            import scripts.build_catalog as bc
            from unittest.mock import patch

            def fake_listing(language):
                return [{"id": sid, "cardCount": {"total": 5, "official": 5}}
                        for sid in ("s1", "s2", "s3")]

            def fake_fetch(language, sets_filter=None):
                argv_calls.append(sets_filter)
                return effects2[language]
            with patch.object(bc, "init_db", return_value=conn), \
                 patch.object(bc, "fetch_language_cards", side_effect=fake_fetch), \
                 patch.object(bc, "fetch_sets_listing", side_effect=fake_listing), \
                 patch.object(bc, "probe_sources",
                              return_value={"tcgdex": {"available": False, "note": "offline test"},
                                            "pokemon-tcg-data": {"available": False,
                                                                 "note": "offline test"}}), \
                 patch.object(sys, "argv", ["build_catalog.py", "--languages", "ja",
                                            "--no-card-details"]):
                bc.main()
            self.assertEqual(argv_calls, [["set-broken"]],
                             "gap retry deve buscar APENAS os sets falhados")
            gaps = conn.execute("SELECT value FROM meta WHERE key='catalog.gaps.ja'").fetchone()
            self.assertIsNone(gaps, "gap resolvido deve ser limpo")
            stamp = conn.execute("SELECT value FROM meta WHERE key='catalog.updated.ja'").fetchone()
            self.assertIsNotNone(stamp, "retry completo deve estampar o idioma")

    def test_listing_failure_optional_records_marker(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "t.sqlite")
            effects = {"es": RuntimeError("listing down")}
            code, calls, conn = self._run_main(db, "es", effects)
            self.assertEqual(code, 0, "listing falhando em idioma OPCIONAL não bloqueia")
            gaps = conn.execute("SELECT value FROM meta WHERE key='catalog.gaps.es'").fetchone()
            self.assertIsNotNone(gaps)
            self.assertIn("__listing_failed__", gaps[0])

    def test_listing_failure_core_blocks(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "t.sqlite")
            effects = {"pt-BR": RuntimeError("listing down")}
            code, calls, conn = self._run_main(db, "pt-BR", effects)
            self.assertEqual(code, 1, "listing falhando em idioma CORE bloqueia")


if __name__ == "__main__":
    unittest.main()
