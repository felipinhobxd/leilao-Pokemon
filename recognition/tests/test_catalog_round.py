# -*- coding: utf-8 -*-
"""Behavioral tests for the 2026-09 catalog round (multi-source + identity).

Covers the round's mandatory catalog/recognition matrix with mocked HTTP
(the CI light environment has no network and no catalog):

CATALOG
1-2.  dynamic discovery of sets and cards (no hardcoded ids anywhere);
3.    new expansion detected automatically by the listing census diff;
4.    incremental download (validated scans skipped, zero network);
5.    resume after an interrupted run (partial data kept, stamp withheld);
6.    retry of gaps (ONLY the failed sets);
7.    corrupt image (sha mismatch -> delete + re-download);
8.    missing image (not_available, no network);
9.    checksum recorded at validation time;
10.   reconciliation of sources (merge by normalized key);
11.   conflicts recorded, never silently overwritten;
12-14. EN / JA / pt-BR handling (ja is CORE since this round).

RECOGNITION
15-16. name matching incl. ja CJK normalization;
17-19. collector numbers: full N/M, alphanumeric pair (TG05/TG30) and
       solo (SVP001), HP/PS tokens rejected;
20-23. language evidence + twins (existing behavior kept green);
24-27. promo/subset/Secret/Gallery cards distinguishable (set+localId);
28-33. SIFT query reuse / caches (already covered by perf round; the
       scan_source cache-hit semantics are re-checked for alt images).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import recognizer.catalog as catalog_module
from recognizer.catalog import (CardRecord, init_db, load_cards, record_conflict,
                                record_scan_state, get_scan_state, save_records,
                                sets_census)
from recognizer.hints import extract_hints, name_similarity
from recognizer.ocr import OcrLine, OcrResult
from recognizer.reconcile import (backfill_alt_images, backfill_limitless_images,
                                  match_sets, normalize_local_id, reconcile_ptcgdata)
from recognizer.sources import PtcgCard, PtcgSet, LimitlessCard, LimitlessSet


def _png_bytes(width: int = 640, height: int = 896) -> bytes:
    import cv2
    ok, buf = cv2.imencode(".png", np.full((height, width, 3), 128, np.uint8))
    assert ok
    return buf.tobytes()


def _hints_from_lines(*lines):
    """Shared: build OcrHints from (text, region, confidence) tuples."""
    ocr_lines = [OcrLine(text=l[0], confidence=l[2], region=l[1], box=np.zeros((4, 2)))
                 for l in lines]
    return extract_hints(OcrResult(lines=ocr_lines, passes=1))


def _record(**kwargs) -> CardRecord:
    defaults = dict(id="sv01-025", language="pt-BR", set_id="sv01", set_name="SV",
                    serie_name="", serie_id="", local_id="025", name="Pikachu",
                    hp=None, denominator=258, image_base="", variants="{}",
                    release_date="")
    defaults.update(kwargs)
    return CardRecord(**defaults)


def _ocr_result(lines) -> OcrResult:
    return OcrResult(lines=lines, passes=1)


class _Line:
    """Test shorthand for an OCR line (box is unused by hint extraction)."""
    def __init__(self, text, region="number", confidence=0.9):
        self.text = text
        self.region = region
        self.confidence = confidence
        self.box = None


# --------------------------------------------------------------------- key normalization
class TestLocalIdNormalization(unittest.TestCase):
    def test_numeric_ids_match_across_padding(self):
        self.assertEqual(normalize_local_id("001"), normalize_local_id("1"))
        self.assertEqual(normalize_local_id("025"), normalize_local_id("25"))

    def test_prefixed_ids_normalize_case_and_zeros(self):
        self.assertEqual(normalize_local_id("TG05"), normalize_local_id("tg5"))
        self.assertEqual(normalize_local_id("SVP001"), normalize_local_id("svp1"))

    def test_empty_is_empty(self):
        self.assertEqual(normalize_local_id(""), "")


# --------------------------------------------------------------------- set matching
class TestSetMatching(unittest.TestCase):
    def test_exact_id_match(self):
        primary = [{"id": "swsh9", "name": "Brilliant Stars", "cardCount": {"official": 186}}]
        ptcg = [PtcgSet("swsh9", "Brilliant Stars", "Sword & Shield", 186, 186, "2022/02/25")]
        report = match_sets(primary, ptcg)
        self.assertEqual(report.matched, {"swsh9": "swsh9"})
        self.assertEqual(report.only_primary, [])
        self.assertEqual(report.only_secondary, [])

    def test_half_set_ids_match_by_name_date_count(self):
        # TCGdex "swsh12.5" vs pokemon-tcg-data "swsh12pt5" (Crown Zenith)
        primary = [{"id": "swsh12.5", "name": "Crown Zenith", "releaseDate": "2023/01/20",
                    "cardCount": {"official": 160}}]
        ptcg = [PtcgSet("swsh12pt5", "Crown Zenith", "Sword & Shield", 160, 160, "2023/01/20")]
        report = match_sets(primary, ptcg)
        self.assertEqual(report.matched.get("swsh12pt5"), "swsh12.5")

    def test_subsets_only_in_primary_are_reported_not_matched(self):
        # Trainer Gallery: only TCGdex has it as a set; pokemon-tcg-data
        # embeds TG cards inside the main set (or omits them). It must land
        # in only_primary — never force-matched by name prefix.
        primary = [
            {"id": "swsh9", "name": "Brilliant Stars", "releaseDate": "2022/02/25",
             "cardCount": {"official": 186}},
            {"id": "swsh9tg", "name": "Brilliant Stars Trainer Gallery",
             "releaseDate": "2022/02/25", "cardCount": {"official": 30}},
        ]
        ptcg = [PtcgSet("swsh9", "Brilliant Stars", "Sword & Shield", 186, 186, "2022/02/25")]
        report = match_sets(primary, ptcg)
        self.assertEqual(report.matched, {"swsh9": "swsh9"})
        self.assertIn("swsh9tg", report.only_primary)

    def test_same_name_different_era_is_not_matched(self):
        # "Base" (1999) vs a hypothetical modern set with the same name:
        # the date/count guards must prevent a false match.
        primary = [{"id": "base1", "name": "Base", "releaseDate": "1999/01/09",
                    "cardCount": {"official": 102}}]
        ptcg = [PtcgSet("xxx1", "Base", "Scarlet & Violet", 200, 200, "2025/01/09")]
        report = match_sets(primary, ptcg)
        self.assertEqual(report.matched, {})
        self.assertEqual(report.only_secondary, ["xxx1"])


# --------------------------------------------------------------------- scan fast paths
class TestScanFastPath(unittest.TestCase):
    """Re-runs must touch zero network: `validated` rows are skipped after a
    local sha256 re-verification and `not_available` rows are skipped while
    the URL scope that produced the verdict is unchanged (a gap is a catalog
    fact, not a transport failure). Only `failed` rows go to the wire."""

    def setUp(self):
        import scripts.download_scans as ds
        self.ds = ds
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        self._orig_cache = catalog_module.IMAGE_CACHE_DIR
        catalog_module.IMAGE_CACHE_DIR = os.path.join(tmp, "scans")
        self.ds._conn = init_db(os.path.join(tmp, "t.sqlite"))
        self.ds._pending_writes.clear()
        self._orig_http = catalog_module._http_get
        self._orig_conn = None

    def tearDown(self):
        catalog_module.IMAGE_CACHE_DIR = self._orig_cache
        catalog_module._http_get = self._orig_http
        self.ds._pending_writes.clear()

    def _forbid_network(self):
        def no_network(url, timeout=30.0, retries=3):
            raise AssertionError(f"rede consultada no fast path: {url}")
        catalog_module._http_get = no_network

    def _card(self, **kwargs) -> CardRecord:
        defaults = dict(id="sv01-025", language="pt-BR", set_id="sv01", set_name="SV",
                        serie_name="", serie_id="", local_id="025", name="Pikachu",
                        hp=None, denominator=258,
                        image_base="https://assets.tcgdex.net/pt/sv/sv01/025",
                        variants="{}", release_date="")
        defaults.update(kwargs)
        return CardRecord(**defaults)

    def _flush(self):
        self.ds._flush_writes()

    def test_validated_card_revalidates_locally_zero_network(self):
        import hashlib
        card = self._card()
        path = catalog_module.scan_path(card.image_base, "high.webp")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = _png_bytes()
        with open(path, "wb") as fh:
            fh.write(data)
        record_scan_state(self.ds._conn, card.image_base, "validated",
                          len(data), hashlib.sha256(data).hexdigest(),
                          width=640, height=896, source="high.webp")
        self._forbid_network()
        self.assertEqual(self.ds.sync_card(card), "validated")
        self._flush()  # nothing queued: state unchanged

    def test_validated_card_with_corrupt_cache_redownloads(self):
        import hashlib
        card = self._card()
        path = catalog_module.scan_path(card.image_base, "high.webp")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(b"\x89PNG\r\n\x1a\n" + b"corrupted" * 90)  # < 1 KB: cache-invalid
        record_scan_state(self.ds._conn, card.image_base, "validated",
                          4481, "0" * 64, width=640, height=896, source="high.webp")
        calls = []

        def fake_http(url, timeout=30.0, retries=3):
            calls.append(url)
            return _png_bytes()
        catalog_module._http_get = fake_http
        self.assertEqual(self.ds.sync_card(card), "validated")
        self.assertTrue(calls, "sha divergente deve cair no re-download")
        self._flush()
        state = get_scan_state(self.ds._conn, card.image_base)
        self.assertEqual(state[0], "validated")
        self.assertNotEqual(state[2], "0" * 64, "sha do arquivo re-baixado deve ser gravado")

    def test_undecodable_cache_file_is_invalidated_and_heals_next_run(self):
        # Bit-rot that still passes magic+size: the cache-hit validator
        # (magic + bytes only) would serve these bytes forever. sync_card
        # must DELETE the file when the full decode fails so the next run
        # genuinely re-downloads (self-healing), not re-serve the corpse.
        import hashlib
        card = self._card()
        path = catalog_module.scan_path(card.image_base, "high.webp")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        garbage = b"\x89PNG\r\n\x1a\n" + b"garbage" * 300  # 2408 bytes, PNG magic
        with open(path, "wb") as fh:
            fh.write(garbage)
        # recorded sha does NOT match the rot (the original validated file
        # had different bytes) -> the fast path falls through to a fresh
        # resolution, which serves the rot back from the cache (magic+size
        # pass) -> full decode fails -> failed + file invalidated.
        record_scan_state(self.ds._conn, card.image_base, "validated",
                          4481, "0" * 64, width=640, height=896, source="high.webp")
        self.assertEqual(self.ds.sync_card(card), "failed",
                         "arquivo ilegível deve ser marcado failed (não validado às cegas)")
        self.assertFalse(os.path.exists(path), "arquivo ilegível deve ser removido do cache")
        self._flush()
        state = get_scan_state(self.ds._conn, card.image_base)
        self.assertEqual(state[0], "failed")

        # Next run: cache is empty now, network works again -> heals.
        calls = []

        def fake_http(url, timeout=30.0, retries=3):
            calls.append(url)
            return _png_bytes()
        catalog_module._http_get = fake_http
        self.assertEqual(self.ds.sync_card(card), "validated")
        self.assertTrue(calls, "após invalidação o re-download real deve acontecer")

    def test_not_available_with_same_scope_is_skipped(self):
        card = self._card(image_base="", image_alt="https://images.pokemontcg.io/sv01/25_hires.png")
        record_scan_state(self.ds._conn, card.image_alt, "not_available",
                          source=self.ds._na_scope(card))
        self._forbid_network()
        self.assertEqual(self.ds.sync_card(card), "not_available")

    def test_not_available_scope_change_reprobes(self):
        # The card GAINS an image URL (e.g. a new source backfilled image_alt):
        # the cached absence verdict no longer covers the new scope and the
        # card must be retried even without --force.
        old_card = self._card(image_base="", image_alt="")
        record_scan_state(self.ds._conn, old_card.image_base, "not_available",
                          source="|")  # old scope: no image anywhere
        new_card = self._card(image_base="https://assets.tcgdex.net/pt/sv/sv01/025",
                              image_alt="")
        calls = []

        def fake_http(url, timeout=30.0, retries=3):
            calls.append(url)
            return _png_bytes()
        catalog_module._http_get = fake_http
        self.assertEqual(self.ds.sync_card(new_card), "validated")
        self.assertTrue(calls, "escopo mudou: a rede deve ser consultada")
        self._flush()
        state = get_scan_state(self.ds._conn, new_card.image_base)
        self.assertEqual(state[0], "validated")

    def test_legacy_not_available_row_falls_through_once(self):
        # Rows written before the scope existed have no recorded scope: they
        # are re-probed once and re-marked WITH the scope (self-healing).
        card = self._card(image_base="", image_alt="https://images.pokemontcg.io/sv01/25_hires.png")
        record_scan_state(self.ds._conn, card.image_alt, "not_available")  # source=""
        probes = []

        def fake_http(url, timeout=30.0, retries=3):
            probes.append(url)
            raise FileNotFoundError(url)  # still absent everywhere
        catalog_module._http_get = fake_http
        self.assertEqual(self.ds.sync_card(card), "not_available")
        self.assertTrue(probes, "linha legada deve ser re-probada uma vez")
        self._flush()
        state = get_scan_state(self.ds._conn, card.image_alt)
        self.assertEqual(state[3], self.ds._na_scope(card),
                         "re-probe regrava o veredito com o escopo atual")

    def test_failed_card_is_retried_and_recovers(self):
        card = self._card()
        record_scan_state(self.ds._conn, card.image_base, "failed")
        calls = []

        def fake_http(url, timeout=30.0, retries=3):
            calls.append(url)
            return _png_bytes()
        catalog_module._http_get = fake_http
        self.assertEqual(self.ds.sync_card(card), "validated")
        self.assertTrue(calls, "failed deve ser retentado com rede")
        self._flush()
        self.assertEqual(get_scan_state(self.ds._conn, card.image_base)[0], "validated")


# --------------------------------------------------------------------- reconciliation
class TestReconcile(unittest.TestCase):
    def _db(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        return init_db(os.path.join(tmp, "t.sqlite"))

    def _listing(self, *sets):
        return [{"id": s[0], "name": s[1], "releaseDate": s[2],
                 "cardCount": {"official": s[3], "total": s[3]}} for s in sets]

    def test_merge_enriches_rarity_and_records_no_false_conflict(self):
        conn = self._db()
        save_records(conn, [_record(
            id="swsh9-001", language="en", set_id="swsh9", local_id="001",
            name="Arceus V", denominator=186,
            image_base="https://assets.tcgdex.net/en/swsh/swsh9/001")])
        listing = self._listing(("swsh9", "Brilliant Stars", "2022/02/25", 186))
        ptcg_sets = [PtcgSet("swsh9", "Brilliant Stars", "Sword & Shield", 186, 186, "2022/02/25")]
        cards = {"swsh9": [PtcgCard("swsh9", "1", "Arceus V", rarity="Rare Holo",
                                    subtypes=["Basic", "V"],
                                    image_small="https://images.pokemontcg.io/swsh9/1.png",
                                    image_large="https://images.pokemontcg.io/swsh9/1_hires.png")]}
        report = reconcile_ptcgdata(conn, listing, ptcg_sets, cards)
        self.assertEqual(report.cards_both, 1)
        self.assertEqual(report.conflicts, 0)
        self.assertEqual(report.enriched_rarity, 1)
        self.assertEqual(report.enriched_subtypes, 1)
        # the row still has its TCGdex image (primary wins) and no alt
        # (alt is only for rows WITHOUT a primary scan)
        row = conn.execute("SELECT rarity, subtypes, image_base, image_alt FROM cards "
                           "WHERE id='swsh9-001' AND language='en'").fetchone()
        self.assertEqual(row[0], "Rare Holo")
        self.assertIn("V", json.loads(row[1]))
        self.assertIn("assets.tcgdex.net", row[2])
        self.assertEqual(row[3], "")

    def test_name_disagreement_is_ledgered_not_overwritten(self):
        conn = self._db()
        save_records(conn, [_record(
            id="swsh9-001", language="en", set_id="swsh9", local_id="001",
            name="Arceus V", denominator=186, image_base="https://assets.tcgdex.net/en/swsh/swsh9/001")])
        listing = self._listing(("swsh9", "Brilliant Stars", "2022/02/25", 186))
        ptcg_sets = [PtcgSet("swsh9", "Brilliant Stars", "Sword & Shield", 186, 186, "2022/02/25")]
        cards = {"swsh9": [PtcgCard("swsh9", "1", "Arceus VSTAR")]}
        report = reconcile_ptcgdata(conn, listing, ptcg_sets, cards)
        self.assertEqual(report.conflicts, 1)
        row = conn.execute("SELECT name FROM cards WHERE id='swsh9-001' AND language='en'").fetchone()
        self.assertEqual(row[0], "Arceus V", "nome TCGdex deve ser mantido")
        conflict = conn.execute("SELECT field, value_a, value_b, resolution FROM conflicts").fetchone()
        self.assertEqual(conflict[0], "name")
        self.assertEqual(conflict[1], "Arceus V")
        self.assertEqual(conflict[2], "Arceus VSTAR")
        self.assertIn("kept:tcgdex", conflict[3])

    def test_scanless_row_gains_alt_image(self):
        conn = self._db()
        save_records(conn, [_record(
            id="svp-100", language="en", set_id="svp", local_id="100",
            name="Mew", denominator=None, image_base="", scan_status="not_available")])
        listing = self._listing(("svp", "SVP Black Star Promos", "2023/01/01", 226))
        ptcg_sets = [PtcgSet("svp", "SVP Black Star Promos", "Scarlet & Violet", 226, 226, "2023/01/01")]
        cards = {"svp": [PtcgCard("svp", "100", "Mew", rarity="Promo",
                                   image_large="https://images.pokemontcg.io/svp/100_hires.png")]}
        report = reconcile_ptcgdata(conn, listing, ptcg_sets, cards)
        self.assertEqual(report.backfilled_image_alt, 1)
        row = conn.execute("SELECT image_alt, rarity FROM cards WHERE id='svp-100'").fetchone()
        self.assertIn("100_hires.png", row[0])
        self.assertEqual(row[1], "Promo")

    def test_ptcg_only_card_is_inserted_with_source_tag(self):
        conn = self._db()
        listing = self._listing(("sv99", "Future Set", "2027/01/01", 10))
        ptcg_sets = [PtcgSet("sv99", "Future Set", "Scarlet & Violet", 10, 10, "2027/01/01")]
        cards = {"sv99": [PtcgCard("sv99", "7", "Futuremon", rarity="Rare",
                                    image_large="https://images.pokemontcg.io/sv99/7_hires.png")]}
        report = reconcile_ptcgdata(conn, listing, ptcg_sets, cards)
        self.assertEqual(report.inserted_secondary_cards, 1)
        row = conn.execute("SELECT name, image_alt, sources, canonical_id FROM cards "
                           "WHERE id='sv99-7' AND language='en'").fetchone()
        self.assertEqual(row[0], "Futuremon")
        self.assertIn("7_hires.png", row[1])
        self.assertIn("pokemon-tcg-data", json.loads(row[2]))
        self.assertEqual(row[3], "sv99|7")

    def test_pt_backfill_uses_international_set_identity(self):
        conn = self._db()
        # pt-BR card of an international set, no primary scan
        save_records(conn, [_record(
            id="sv01-025", language="pt-BR", set_id="sv01", local_id="025",
            name="Pikachu", image_base="", scan_status="not_available")])
        # a same-set EN card that HAS a scan must not be touched
        save_records(conn, [_record(
            id="sv01-026", language="pt-BR", set_id="sv01", local_id="026",
            name="Flutter Mane", image_base="https://assets.tcgdex.net/pt/sv/sv01/026")])
        listing = self._listing(("sv01", "Escarlate e Violeta", "2023/01/01", 258))
        ptcg_sets = [PtcgSet("sv01", "Scarlet & Violet Base", "Scarlet & Violet",
                             258, 258, "2023/01/01")]
        cards = {"sv01": [PtcgCard("sv01", "25", "Pikachu",
                                    image_large="https://images.pokemontcg.io/sv01/25_hires.png")]}
        n = backfill_alt_images(conn, "pt-BR", listing, ptcg_sets, cards)
        self.assertEqual(n, 1)
        row = conn.execute("SELECT image_alt FROM cards "
                           "WHERE id='sv01-025' AND language='pt-BR'").fetchone()
        self.assertIn("25_hires.png", row[0])
        untouched = conn.execute("SELECT image_alt FROM cards "
                                 "WHERE id='sv01-026' AND language='pt-BR'").fetchone()
        self.assertEqual(untouched[0], "", "carta com scan primário não ganha alt")


# --------------------------------------------------------------------- Limitless (3rd source)
class TestLimitlessBackfill(unittest.TestCase):
    """Fase 2: the third image source must reach scanless pt-BR promos with
    ALPHANUMERIC collector numbers (PROMO-A, SVP-001) without weakening any
    existing guarantee: primary scans/alt images untouched, junk numbers
    rejected, ambiguous tail matches never guessed."""

    def _db(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        return init_db(os.path.join(tmp, "t.sqlite"))

    def _listing(self, *sets):
        return [{"id": s[0], "name": s[1], "releaseDate": s[2],
                 "cardCount": {"official": s[3], "total": s[3]}} for s in sets]

    def _scanless(self, conn, set_id, local_id, name="Promo", image_base=""):
        record = _record(id=f"{set_id}-{local_id}-{name[:4]}", language="pt-BR",
                         set_id=set_id, set_name=set_id, local_id=local_id,
                         name=name, image_base=image_base, image_alt="")
        save_records(conn, [record])
        return record

    def _lsets(self, set_id="svp", name="SV Promos", total=95, date="2023/01/27"):
        return [LimitlessSet(set_id, name, "Scarlet & Violet", total, total, date)]

    def test_brazilian_alphanumeric_promos_gain_third_source_image(self):
        conn = self._db()
        # scanless pt-BR promos: alphanumeric localIds that pokemon-tcg-data
        # never covers (the exact Fase 2 target population)
        self._scanless(conn, "svp", "SVP-001", "Pikachu")
        self._scanless(conn, "svp", "PROMO-A", "Promo Revista")
        self._scanless(conn, "svp", "001", "Pikachu SVP")
        listing = self._listing(("svp", "Promos Escarlate e Violeta", "2023/01/27", 95))
        cards = {"svp": [
            LimitlessCard("svp", "SVP-001", "Pikachu",
                          image_large="https://img.limitlesstcg.com/svp/SVP-001.png"),
            LimitlessCard("svp", "PROMO-A", "Promo Revista",
                          image_large="https://img.limitlesstcg.com/svp/PROMO-A.png"),
        ]}
        n = backfill_limitless_images(conn, "pt-BR", listing, self._lsets(), cards)
        self.assertEqual(n, 3, "SVP-001 e PROMO-A casam exatos; 001 casa por tail do SVP-001")
        rows = {r[0]: r[1] for r in conn.execute(
            "SELECT local_id, image_alt FROM cards WHERE language='pt-BR'")}
        self.assertIn("SVP-001.png", rows["SVP-001"])
        self.assertIn("PROMO-A.png", rows["PROMO-A"])
        self.assertIn("SVP-001.png", rows["001"],
                      "tail-match: SVP-001 (prefixo=set svp) e' a mesma carta que 001")
        # sources ledger records the third source without clobbering others
        ledger = json.loads(conn.execute(
            "SELECT sources FROM cards WHERE local_id='PROMO-A' AND language='pt-BR'"
        ).fetchone()[0])
        self.assertIn("limitless", ledger)

    def test_prefix_from_another_set_never_aliases(self):
        # "XY-001" inside set svp: the prefix guard (prefix == set id) must
        # reject the tail alias — a foreign prefix is not evidence.
        conn = self._db()
        self._scanless(conn, "svp", "001", "Pikachu")
        listing = self._listing(("svp", "Promos Escarlate e Violeta", "2023/01/27", 95))
        cards = {"svp": [LimitlessCard("svp", "XY-001", "Other promo",
                                       image_large="https://img.limitlesstcg.com/svp/XY-001.png")]}
        n = backfill_limitless_images(conn, "pt-BR", listing, self._lsets(), cards)
        self.assertEqual(n, 0, "prefixo que não é o set não pode casar por tail")

    def test_ambiguous_tail_is_never_guessed(self):
        # Two DIFFERENT limitless numbers collapse to the same tail ("1"):
        # the ambiguity must stay unfilled instead of guessing a winner.
        conn = self._db()
        self._scanless(conn, "svp", "001", "Pikachu")
        listing = self._listing(("svp", "Promos Escarlate e Violeta", "2023/01/27", 95))
        cards = {"svp": [
            LimitlessCard("svp", "SVP-001", "Pikachu",
                          image_large="https://img.limitlesstcg.com/svp/SVP-001.png"),
            LimitlessCard("svp", "SVP-1", "Outra carta",
                          image_large="https://img.limitlesstcg.com/svp/SVP-1.png"),
        ]}
        n = backfill_limitless_images(conn, "pt-BR", listing, self._lsets(), cards)
        self.assertEqual(n, 0, "tail ambíguo não pode preencher por adivinhação")

    def test_junk_numbers_never_enter_the_mapping(self):
        conn = self._db()
        self._scanless(conn, "svp", "001", "Pikachu")
        listing = self._listing(("svp", "Promos Escarlate e Violeta", "2023/01/27", 95))
        cards = {"svp": [
            LimitlessCard("svp", "?? 12", "Lixo",
                          image_large="https://img.limitlesstcg.com/svp/junk.png"),
            LimitlessCard("svp", "", "Sem numero",
                          image_large="https://img.limitlesstcg.com/svp/nn.png"),
        ]}
        n = backfill_limitless_images(conn, "pt-BR", listing, self._lsets(), cards)
        self.assertEqual(n, 0, "numeros invalidos jamais entram no merge")

    def test_rows_with_scan_or_alt_are_never_touched(self):
        conn = self._db()
        save_records(conn, [
            _record(id="svp-with-scan", language="pt-BR", set_id="svp", set_name="svp",
                    local_id="001", name="Com scan",
                    image_base="https://assets.tcgdex.net/pt/sv/svp/001"),
            _record(id="svp-with-alt", language="pt-BR", set_id="svp", set_name="svp",
                    local_id="002", name="Com alt", image_base="",
                    image_alt="https://images.pokemontcg.io/svp/2_hires.png"),
        ])
        listing = self._listing(("svp", "Promos Escarlate e Violeta", "2023/01/27", 95))
        cards = {"svp": [
            LimitlessCard("svp", "001", "Com scan",
                          image_large="https://img.limitlesstcg.com/svp/001.png"),
            LimitlessCard("svp", "002", "Com alt",
                          image_large="https://img.limitlesstcg.com/svp/002.png"),
        ]}
        n = backfill_limitless_images(conn, "pt-BR", listing, self._lsets(), cards)
        self.assertEqual(n, 0, "scan primário e alt existente sempre vencem")

    def test_unmatched_sets_are_reported_not_forced(self):
        # A Limitless set with no TCGdex counterpart contributes nothing —
        # same honest contract as the pokemon-tcg-data reconciliation.
        conn = self._db()
        self._scanless(conn, "zz9", "001", "Isolada")
        listing = self._listing(("svp", "Promos Escarlate e Violeta", "2023/01/27", 95))
        lsets = [LimitlessSet("unmatched-set", "Set Sem Par", "Série", 95, 95, "2023/01/27")]
        cards = {"unmatched-set": [LimitlessCard("unmatched-set", "001", "Isolada",
                                                 image_large="https://img/1.png")]}
        n = backfill_limitless_images(conn, "pt-BR", listing, lsets, cards)
        self.assertEqual(n, 0, "set sem match heurístico não é forçado")


class TestLimitlessSource(unittest.TestCase):
    """Fetchers + honest probe of the third source (HTTP mocked, no network
    in CI — same contract as every other source test)."""

    def _patch_http(self, responses):
        import recognizer.sources as sources_module
        calls = []

        def fake(url, timeout=30.0, retries=3, headers=None, params=None):
            calls.append({"url": url, "headers": headers, "params": params})
            for suffix, payload in responses:
                if url.endswith(suffix):
                    return json.dumps(payload).encode("utf-8")
            raise FileNotFoundError(url)
        patcher = patch.object(sources_module, "_http_get", fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        return calls

    def test_sets_accept_bare_list_and_data_wrapper(self):
        self._patch_http([
            ("/sets", [{"id": "svp", "name": "SV Promos", "printedTotal": 95}]),
        ])
        from recognizer.sources import fetch_limitless_sets
        sets = fetch_limitless_sets()
        self.assertEqual(len(sets), 1)
        self.assertEqual(sets[0].set_id, "svp")
        self.assertEqual(sets[0].printed_total, 95)
        # same payload wrapped in {"data": [...]}
        self._patch_http([
            ("/sets", {"data": [{"id": "svp2", "name": "SV Promos 2", "cardCount": {"total": 9}}]}),
        ])
        sets = fetch_limitless_sets()
        self.assertEqual(sets[0].set_id, "svp2")
        self.assertEqual(sets[0].printed_total, 9)

    def test_cards_parse_number_and_images_tolerantly(self):
        self._patch_http([
            ("/cards", {"data": [
                {"number": "SVP-001", "name": "Pikachu", "rarity": "Promo",
                 "image": {"small": "https://img/s.png", "large": "https://img/l.png"}},
                {"collectorNumber": "PROMO-A", "name": "Revista", "hp": "60",
                 "images": {"hiRes": "https://img/h.png"}},
            ]}),
        ])
        from recognizer.sources import fetch_limitless_cards
        cards = fetch_limitless_cards("svp")
        self.assertEqual(cards[0].number, "SVP-001")
        self.assertEqual(cards[0].image_large, "https://img/l.png")
        self.assertEqual(cards[1].number, "PROMO-A", "collectorNumber fallback")
        self.assertEqual(cards[1].image_large, "https://img/h.png", "hiRes key")
        self.assertEqual(cards[1].hp, 60, "hp string de dígito vira int")

    def test_fetch_uses_auth_headers_and_set_filter(self):
        from unittest.mock import patch as _patch
        with _patch.dict("os.environ", {"LIMITLESS_API_KEY": "k-test",
                                        "LIMITLESS_API_BASE": "https://api.example.test/v2"}):
            calls = self._patch_http([("/cards", [])])
            from recognizer.sources import fetch_limitless_cards
            fetch_limitless_cards("svp")
            self.assertEqual(calls[0]["url"], "https://api.example.test/v2/cards")
            self.assertEqual(calls[0]["headers"], {"X-Api-Key": "k-test"})
            self.assertEqual(calls[0]["params"], {"set": "svp"})

    def test_probe_without_key_is_honestly_unavailable(self):
        from recognizer.sources import probe_sources

        class FakeResponse:
            def __init__(self, code=200):
                self.status_code = code

        def responder(url, timeout=15.0, **kwargs):
            return FakeResponse(200)  # tcgdex/ptcgdata probes: fast success

        with patch.dict("os.environ", {"LIMITLESS_API_KEY": ""}):
            with patch("requests.get", side_effect=responder):
                status = probe_sources()
        self.assertFalse(status["limitless"]["available"])
        self.assertIn("LIMITLESS_API_KEY", status["limitless"]["note"])

    def test_probe_reports_auth_failure_and_success(self):
        from recognizer.sources import probe_sources

        class FakeResponse:
            def __init__(self, code):
                self.status_code = code

        def responder_factory(limitless_code):
            def responder(url, timeout=15.0, **kwargs):
                if "example.test" in url:
                    return FakeResponse(limitless_code)
                return FakeResponse(200)
            return responder

        with patch.dict("os.environ", {"LIMITLESS_API_KEY": "bad",
                                       "LIMITLESS_API_BASE": "https://api.example.test/v2"}):
            with patch("requests.get", side_effect=responder_factory(401)):
                status = probe_sources()
                self.assertFalse(status["limitless"]["available"])
                self.assertIn("chave", status["limitless"]["note"])
            with patch("requests.get", side_effect=responder_factory(200)):
                status = probe_sources()
                self.assertTrue(status["limitless"]["available"])


# --------------------------------------------------------------------- incremental sync
class TestIncrementalSync(unittest.TestCase):
    """The listing census must detect new expansions and skip what is current."""

    def _run(self, db, effects, listing_sets, languages="ja", argv_extra=()):
        import scripts.build_catalog as bc
        calls = []

        def fake_fetch(language, sets_filter=None):
            calls.append((language, sets_filter))
            outcome = effects[language]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        def fake_listing(language):
            return [{"id": s, "name": s.upper(), "cardCount": {"total": 5, "official": 5}}
                    for s in listing_sets[language]]

        argv = ["build_catalog.py", "--languages", languages, "--no-card-details",
                *argv_extra]
        with patch.object(bc, "init_db", return_value=db), \
             patch.object(bc, "fetch_language_cards", side_effect=fake_fetch), \
             patch.object(bc, "fetch_sets_listing", side_effect=fake_listing), \
             patch.object(bc, "probe_sources",
                          return_value={"tcgdex": {"available": False, "note": "test"},
                                        "pokemon-tcg-data": {"available": False, "note": "test"}}), \
             patch.object(sys, "argv", argv):
            try:
                bc.main()
                code = 0
            except SystemExit as exc:
                code = int(exc.code or 0)
        return code, calls

    @staticmethod
    def _cards(lang):
        return [_record(id="s1-1", language=lang, set_id="s1", local_id="1", name="A")]

    @staticmethod
    def _report(language, failed):
        from recognizer.catalog import FetchReport
        return FetchReport(language=language, expected_sets=1,
                           succeeded_sets=1 - len(failed), failed_sets=failed)

    def _db(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        return init_db(os.path.join(tmp, "t.sqlite"))

    def test_new_expansion_detected_without_refresh(self):
        db = self._db()
        # Run 1: two sets exist.
        code, calls = self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))},
                                {"ja": ["s1", "s2"]})
        self.assertEqual(code, 0)
        first_fetch = calls[0][1]
        self.assertIsNone(first_fetch, "primeira run busca tudo")
        # Run 2: a NEW expansion appeared (s3) — must be fetched, s1/s2 skipped.
        code, calls = self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))},
                                {"ja": ["s1", "s2", "s3"]})
        self.assertEqual(code, 0)
        self.assertEqual(calls[0][1], ["s3"],
                         "nova expansão deve ser detectada e buscada sem --refresh")

    def test_unchanged_listing_is_a_noop(self):
        db = self._db()
        self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))}, {"ja": ["s1", "s2"]})
        code, calls = self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))},
                                {"ja": ["s1", "s2"]})
        self.assertEqual(code, 0)
        self.assertEqual(calls, [], "listing inalterado = zero fetches de sets")

    def test_changed_card_count_refetches_only_that_set(self):
        db = self._db()
        self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))}, {"ja": ["s1", "s2"]})
        # s2 grows from 5 to 8 cards upstream (reprints added)
        def listing_with_growth(language):
            counts = {"s1": 5, "s2": 8}
            return [{"id": s, "name": s.upper(), "cardCount": {"total": counts[s], "official": counts[s]}}
                    for s in ("s1", "s2")]
        import scripts.build_catalog as bc
        calls = []
        effects = {"ja": (self._cards("ja"), self._report("ja", []))}

        def fake_fetch(language, sets_filter=None):
            calls.append(sets_filter)
            return effects[language]

        with patch.object(bc, "init_db", return_value=db), \
             patch.object(bc, "fetch_language_cards", side_effect=fake_fetch), \
             patch.object(bc, "fetch_sets_listing", side_effect=listing_with_growth), \
             patch.object(bc, "probe_sources",
                          return_value={"tcgdex": {"available": False, "note": "test"},
                                        "pokemon-tcg-data": {"available": False, "note": "test"}}), \
             patch.object(sys, "argv", ["build_catalog.py", "--languages", "ja",
                                        "--no-card-details"]):
            bc.main()
        self.assertEqual(calls, [["s2"]], "apenas o set com cardCount alterado é re-buscado")

    def test_resume_keeps_partial_data_and_withholds_stamp(self):
        db = self._db()
        # Run 1: set fails after partial save.
        code, _ = self._run(db, {"ja": (self._cards("ja"), self._report("ja", ["s2"]))},
                            {"ja": ["s1", "s2"]})
        self.assertEqual(code, 1, "ja é CORE: gap bloqueia")
        kept = conn_rows = db.execute(
            "SELECT COUNT(*) FROM cards WHERE language='ja'").fetchone()[0]
        self.assertGreater(kept, 0, "dados parciais devem ser mantidos")
        stamp = db.execute("SELECT value FROM meta WHERE key='catalog.updated.ja'").fetchone()
        self.assertIsNone(stamp, "run parcial não ganha stamp de completo")
        gaps = json.loads(db.execute(
            "SELECT value FROM meta WHERE key='catalog.gaps.ja'").fetchone()[0])
        self.assertIn("s2", gaps["failedSets"])
        # Run 2 (resume): the gap is retried and only it.
        code, calls = self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))},
                                {"ja": ["s1", "s2"]})
        self.assertEqual(code, 0)
        self.assertEqual(calls[0][1], ["s2"], "resume busca apenas o gap")
        stamp = db.execute("SELECT value FROM meta WHERE key='catalog.updated.ja'").fetchone()
        self.assertIsNotNone(stamp, "run completa estampa")

    def test_persistent_upstream_failure_unblocks_after_budget(self):
        """A set that fails every run (source-side 503, like the ja '+' sets)
        must stop blocking the install after UPSTREAM_UNAVAILABLE_AFTER
        consecutive attempts — recorded + retried, never silently dropped."""
        import scripts.build_catalog as bc
        db = self._db()
        effects = {"ja": (self._cards("ja"), self._report("ja", ["s2"]))}
        codes = []
        for _ in range(bc.UPSTREAM_UNAVAILABLE_AFTER - 1):
            code, _ = self._run(db, effects, {"ja": ["s1", "s2"]})
            codes.append(code)
        self.assertTrue(all(c == 1 for c in codes), "primeiras tentativas bloqueiam")
        # The UPSTREAM_UNAVAILABLE_AFTER-th consecutive failure crosses the
        # budget: still partial, no longer blocking.
        code, _ = self._run(db, effects, {"ja": ["s1", "s2"]})
        self.assertEqual(code, 0, "gap upstream-unavailable não bloqueia a instalação")
        gaps = json.loads(db.execute(
            "SELECT value FROM meta WHERE key='catalog.gaps.ja'").fetchone()[0])
        self.assertTrue(gaps["upstreamLimited"])
        self.assertGreaterEqual(gaps["attempts"]["s2"], bc.UPSTREAM_UNAVAILABLE_AFTER)
        stamp = db.execute("SELECT value FROM meta WHERE key='catalog.updated.ja'").fetchone()
        self.assertIsNone(stamp, "partial (upstream) never gets the complete stamp")
        # The gap is still retried on the next run (self-healing) and heals.
        code, calls = self._run(db, {"ja": (self._cards("ja"), self._report("ja", []))},
                                {"ja": ["s1", "s2"]})
        self.assertEqual(code, 0)
        self.assertEqual(calls[0][1], ["s2"], "gap upstream continua sendo retentado")
        row = db.execute("SELECT value FROM meta WHERE key='catalog.gaps.ja'").fetchone()
        self.assertIsNone(row, "gap curado é removido inteiramente")
        stamp = db.execute("SELECT value FROM meta WHERE key='catalog.updated.ja'").fetchone()
        self.assertIsNotNone(stamp, "cura completa estampa o idioma")


# --------------------------------------------------------------------- scan backfill chain
class TestAltImageChain(unittest.TestCase):
    def test_ptcg_url_derivation(self):
        from recognizer.catalog import _ptcg_url
        alt = "https://images.pokemontcg.io/svp/100_hires.png"
        self.assertEqual(_ptcg_url(alt, "hires"), alt)
        self.assertEqual(_ptcg_url(alt, "small"), "https://images.pokemontcg.io/svp/100.png")
        plain = "https://images.pokemontcg.io/svp/100.png"
        self.assertEqual(_ptcg_url(plain, "hires"),
                         "https://images.pokemontcg.io/svp/100_hires.png")
        self.assertEqual(_ptcg_url(plain, "small"), plain)

    def test_alt_image_downloads_into_own_namespace(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        with patch.object(catalog_module, "IMAGE_CACHE_DIR", tmp):
            alt = "https://images.pokemontcg.io/svp/100_hires.png"
            with patch.object(catalog_module, "_http_get", return_value=_png_bytes()):
                resolved, reason = catalog_module.resolve_scan_classified(None, alt)
            self.assertEqual(reason, "ok")
            path, source = resolved
            self.assertEqual(source, "ptcg-hires")
            self.assertIn(os.path.join("ptcg", ""), path)
            # Second call: pure cache hit (zero network — _http_get now fails hard)
            with patch.object(catalog_module, "_http_get",
                              side_effect=RuntimeError("network must not be hit")):
                resolved2, reason2 = catalog_module.resolve_scan_classified(None, alt)
            self.assertEqual(reason2, "ok")
            self.assertEqual(resolved2[0], path)

    def test_primary_scan_wins_over_alt(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        with patch.object(catalog_module, "IMAGE_CACHE_DIR", tmp):
            base = "https://assets.tcgdex.net/en/sv/sv01/025"
            alt = "https://images.pokemontcg.io/sv01/25_hires.png"
            calls = []

            def fake_http(url, timeout=25.0, retries=3):
                calls.append(url)
                return _png_bytes()

            with patch.object(catalog_module, "_http_get", side_effect=fake_http):
                resolved, reason = catalog_module.resolve_scan_classified(base, alt)
            self.assertEqual(reason, "ok")
            self.assertEqual(resolved[1], "high.webp")
            self.assertTrue(all("images.pokemontcg.io" not in u for u in calls),
                            "alt não deve ser consultada quando o scan primário existe")


# --------------------------------------------------------------------- download validation
class TestScanValidation(unittest.TestCase):
    def test_scans_table_records_dimensions_and_source(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        conn = init_db(os.path.join(tmp, "t.sqlite"))
        record_scan_state(conn, "https://x/y", "validated", 1234, "deadbeef",
                          width=600, height=840, source="high.webp")
        state = get_scan_state(conn, "https://x/y")
        self.assertEqual(state[0], "validated")
        row = conn.execute("SELECT width, height, source FROM scans "
                           "WHERE image_base='https://x/y'").fetchone()
        self.assertEqual(row, (600, 840, "high.webp"))

    def test_corrupt_file_is_redownloaded_not_trusted(self):
        """The sha256 mismatch path: a changed file must not validate."""
        import hashlib
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        conn = init_db(os.path.join(tmp, "t.sqlite"))
        with patch.object(catalog_module, "IMAGE_CACHE_DIR", tmp):
            base = "https://assets.tcgdex.net/en/sv/sv01/025"
            # Download 1: good image
            with patch.object(catalog_module, "_http_get", return_value=_png_bytes()):
                resolved, reason = catalog_module.resolve_scan_classified(base)
            path = resolved[0]
            good_sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
            record_scan_state(conn, base, "validated", os.path.getsize(path), good_sha)
            # Corrupt the cached file (passes magic bytes? no — overwrite
            # with garbage that still starts like a PNG)
            with open(path, "wb") as fh:
                fh.write(b"\x89PNG\r\n\x1a\n" + b"garbage" * 100)
            # The cache-hit validator must reject it and re-download.
            with patch.object(catalog_module, "_http_get", return_value=_png_bytes()):
                resolved2, reason2 = catalog_module.resolve_scan_classified(base)
            self.assertEqual(reason2, "ok")
            self.assertEqual(resolved2[0], path)
            new_sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
            self.assertEqual(new_sha, good_sha, "arquivo deve ter sido re-baixado")


# --------------------------------------------------------------------- recognition: numbers
class TestAlphanumericNumbers(unittest.TestCase):
    def _hints(self, *lines):
        return _hints_from_lines(*lines)

    def test_tg_pair_is_parsed(self):
        hints = self._hints(("TG05/TG30", "number", 0.92))
        self.assertEqual(hints.local_id, "TG05")
        self.assertIsNone(hints.denominator, "denominador alfanumérico não é int: fica None")
        self.assertGreaterEqual(hints.number_confidence, 0.5)

    def test_svp_solo_is_parsed(self):
        hints = self._hints(("SVP001", "number", 0.88))
        self.assertEqual(hints.local_id, "SVP001")
        self.assertGreaterEqual(hints.number_confidence, 0.5)

    def test_ocr_confusables_in_digits_are_fixed(self):
        hints = self._hints(("TGO5/TG3O", "number", 0.9))
        self.assertEqual(hints.local_id, "TG05")

    def test_hp_and_ps_tokens_are_rejected(self):
        hints = self._hints(("PS60", "number", 0.95))
        self.assertEqual(hints.local_id, "", "leitura de HP não é número de colecionador")
        hints2 = self._hints(("HP120", "number", 0.95))
        self.assertEqual(hints2.local_id, "")

    def test_numeric_nm_still_wins_over_alnum(self):
        """A regular 25/165 read must keep working exactly as before."""
        hints = self._hints(("25/165", "number", 0.9), ("SVP001", "number", 0.8))
        self.assertEqual(hints.local_id, "25")
        self.assertEqual(hints.denominator, 165)

    def test_lowercase_alnum_read_is_uppercased(self):
        hints = self._hints(("tg05/tg30", "number", 0.9))
        self.assertEqual(hints.local_id, "TG05")

    def test_alnum_matches_catalog_local_id_in_text_candidates(self):
        from recognizer.store import CatalogStore
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        db = os.path.join(tmp, "t.sqlite")
        conn = init_db(db)
        save_records(conn, [
            _record(id="swsh9tg-TG05", language="en", set_id="swsh9tg", local_id="TG05",
                    name="Charizard V", denominator=30),
            _record(id="svp-100", language="en", set_id="svp", local_id="100",
                    name="Mew", denominator=None),
        ])
        store = CatalogStore(db, languages=["en"])
        # TG subsets store the prefixed localId: exact match, full bonus.
        hints = _hints_from_lines(("TG05/TG30", "number", 0.9))
        candidates = store.text_candidates(hints)
        tg = [c for c in candidates if c.set_id == "swsh9tg"]
        self.assertTrue(tg, "candidato TG05 deve ser recuperado pela rota B")
        # Promo sets store plain digits: "SVP100" must still find card 100
        # (weaker tail match — the prefix names the subset, the tail the card).
        hints2 = _hints_from_lines(("SVP100", "number", 0.9))
        candidates2 = store.text_candidates(hints2)
        svp = [c for c in candidates2 if c.set_id == "svp"]
        self.assertTrue(svp, "leitura SVP100 deve recuperar a carta 100 do set svp")
        if tg and svp:
            self.assertGreater(tg[0].score, svp[0].score,
                               "match exato (TG05) pontua mais que tail-only (SVP100->100)")


# --------------------------------------------------------------------- recognition: ja names
class TestJapaneseNormalization(unittest.TestCase):
    def test_ja_name_similarity_exact(self):
        self.assertEqual(name_similarity("ピカチュウ", "ピカチュウ"), 1.0)

    def test_ja_name_similarity_different(self):
        self.assertLess(name_similarity("ピカチュウ", "フシギダネ"), 0.6)

    def test_ja_cards_index_by_name_in_store(self):
        from recognizer.store import CatalogStore
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        db = os.path.join(tmp, "t.sqlite")
        conn = init_db(db)
        save_records(conn, [
            _record(id="s1-025", language="ja", set_id="s1", local_id="025",
                    name="ピカチュウ"),
        ])
        store = CatalogStore(db, languages=["ja"])
        hints = _hints_from_lines(("ピカチュウ", "name", 0.9))
        candidates = store.text_candidates(hints)
        self.assertTrue(candidates, "carta ja deve ser recuperável pelo nome")
        self.assertEqual(candidates[0].name, "ピカチュウ")

    def test_latin_names_unchanged(self):
        self.assertEqual(name_similarity("Cauda Brado", "cauda brado"), 1.0)
        self.assertEqual(name_similarity("Mr. Mime", "Mr Mime"), 1.0,
                         "pontuação é normalizada: mesma leitura")
        self.assertEqual(name_similarity("CaudaBrado", "Cauda Brado"), 0.98)


# --------------------------------------------------------------------- identity vs printing
class TestIdentityVsPrinting(unittest.TestCase):
    def test_canonical_id_links_language_twins(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        conn = init_db(os.path.join(tmp, "t.sqlite"))
        save_records(conn, [
            _record(id="sv01-025", language="pt-BR", set_id="sv01", local_id="025"),
            _record(id="sv01-025", language="en", set_id="sv01", local_id="025"),
            _record(id="sv01-025", language="ja", set_id="sv01", local_id="025"),
        ])
        ids = {row[0] for row in conn.execute(
            "SELECT DISTINCT canonical_id FROM cards")}
        self.assertEqual(ids, {"sv01|025"},
                         "gêmeos de idioma do mesmo set internacional compartilham identidade")

    def test_printings_are_distinct_rows(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        conn = init_db(os.path.join(tmp, "t.sqlite"))
        save_records(conn, [
            _record(id="sv01-025", language="pt-BR", set_id="sv01", local_id="025"),
            _record(id="sv01-025", language="en", set_id="sv01", local_id="025"),
        ])
        n = conn.execute("SELECT COUNT(*) FROM cards WHERE canonical_id='sv01|025'").fetchone()[0]
        self.assertEqual(n, 2, "cada printing (idioma) é uma linha própria")

    def test_migration_backfills_canonical_id(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        db = os.path.join(tmp, "t.sqlite")
        conn = init_db(db)
        # simulate a v1 catalog row without the v2 columns
        conn.execute("""CREATE TABLE cards_v1 AS SELECT id, language, set_id, set_name,
            serie_name, serie_id, local_id, name, hp, denominator, image_base, variants,
            release_date, scan_status FROM cards""")
        conn.execute("DROP TABLE cards")
        conn.execute("ALTER TABLE cards_v1 RENAME TO cards")
        conn.execute("INSERT INTO cards (id, language, set_id, set_name, serie_name, serie_id, "
                     "local_id, name, hp, denominator, image_base, variants, release_date, scan_status) "
                     "VALUES ('sv01-025','pt-BR','sv01','SV','','','025','Pikachu',NULL,258,'','{}','', '')")
        conn.commit()
        # re-run init_db: the migration must add and backfill the columns
        conn2 = init_db(db)
        row = conn2.execute("SELECT canonical_id, rarity, sources FROM cards "
                            "WHERE id='sv01-025'").fetchone()
        self.assertEqual(row[0], "sv01|025")
        self.assertEqual(row[1], "")
        self.assertEqual(row[2], "{}")


# --------------------------------------------------------------------- variants/rarity
class TestVariantRarityPayload(unittest.TestCase):
    def test_variant_from_flags(self):
        from recognizer.pipeline import candidate_from_record
        record = _record(variants=json.dumps({"holo": True, "normal": False, "reverse": False}))
        candidate = candidate_from_record(record)
        self.assertEqual(candidate.variant, "Holo")

    def test_rarity_fallback_when_no_flags(self):
        from recognizer.pipeline import candidate_from_record
        record = _record(variants="{}", rarity="Illustration Rare")
        candidate = candidate_from_record(record)
        self.assertEqual(candidate.variant, "Illustration Rare")
        self.assertEqual(candidate.rarity, "Illustration Rare")
        payload = candidate.to_dict()
        self.assertEqual(payload["rarity"], "Illustration Rare")

    def test_no_variant_when_nothing_published(self):
        from recognizer.pipeline import candidate_from_record
        record = _record(variants="{}", rarity="")
        candidate = candidate_from_record(record)
        self.assertIsNone(candidate.variant)
        self.assertIsNone(candidate.to_dict()["rarity"])


# --------------------------------------------------------------------- coverage helpers
class TestCoverage(unittest.TestCase):
    def test_sets_census_from_listing(self):
        listing = [
            {"id": "a", "cardCount": {"total": 10, "official": 10}},
            {"id": "b", "cardCount": {"total": 20, "official": 18}},
            {"name": "no-id"},
        ]
        census = sets_census(listing)
        self.assertEqual(census, {"a": {"total": 10, "official": 10},
                                  "b": {"total": 20, "official": 18}})

    def test_conflict_ledger_roundtrip(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        conn = init_db(os.path.join(tmp, "t.sqlite"))
        record_conflict(conn, "en", "sv01-025", "tcgdex", "pokemon-tcg-data",
                        "name", "Pikachu", "Pikachú", "kept:tcgdex")
        rows = conn.execute("SELECT language, card_key, field, value_a, value_b "
                            "FROM conflicts").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][2], "name")


if __name__ == "__main__":
    unittest.main()
