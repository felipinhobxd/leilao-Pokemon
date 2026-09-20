# -*- coding: utf-8 -*-
"""Catalog store: fast in-memory card metadata + text-route candidate generation."""
from __future__ import annotations

import re
import sqlite3
import threading
import unicodedata
from typing import Optional

from .catalog import CardRecord, init_db, load_cards
from .hints import OcrHints, name_similarity

# Japanese card names (kana + kanji) must survive normalization: the old
# [a-z0-9] filter mapped EVERY ja name to "" (one giant bucket, no route-B
# name matching at all for ja cards). CJK ranges are kept as-is so
# "ピカチュウ" indexes and matches against an OCR read of the same glyphs.
_CJK_RE = re.compile(r"[ぁ-んァ-ン一-龯]")


def _normalize(value: str) -> str:
    if _CJK_RE.search(value or ""):
        # Japanese read: keep CJK glyphs, drop latin punctuation noise.
        return re.sub(r"[^ぁ-んァ-ン一-龯ーA-Za-z0-9♀♂]+", " ", (value or "").strip()).strip()
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9♀♂]+", " ", stripped.lower()).strip()


class CatalogStore:
    def __init__(self, db_path: Optional[str] = None, languages: Optional[list[str]] = None):
        self.conn: sqlite3.Connection = init_db(db_path) if db_path else init_db()
        self.cards = load_cards(self.conn, languages)
        self.by_key = {(c.language, c.id): c for c in self.cards}
        self.by_name: dict[str, list[CardRecord]] = {}
        for card in self.cards:
            self.by_name.setdefault(_normalize(card.name), []).append(card)
        # Collector-number indexes for the text route. The old code scanned the
        # WHOLE catalog per request (10-80k cards x 2-3 string ops in Python)
        # whenever OCR read a number — the common case. Both indexes preserve
        # the exact old comparison semantics, just inverted:
        #   by_local_id  -> key = local_id.lstrip("0")            (exact form)
        #   by_digits    -> key = digits-only local_id.lstrip("0") (tail pool)
        self.by_local_id: dict[str, list[CardRecord]] = {}
        self.by_digits: dict[str, list[CardRecord]] = {}
        for card in self.cards:
            key = str(card.local_id or "").lstrip("0")
            if not key:
                continue
            self.by_local_id.setdefault(key, []).append(card)
            if str(card.local_id or "").isdigit():
                self.by_digits.setdefault(key, []).append(card)
        self._lock = threading.Lock()

    def card_by_key(self, language: str, card_id: str) -> Optional[CardRecord]:
        return self.by_key.get((language, card_id))

    def text_candidates(self, hints: OcrHints, limit: int = 60) -> list:
        """ROUTE B candidate generation from OCR hints over the local catalog.

        Faithful to the old site behavior: candidates require a plausible name
        match OR a number match — which is exactly why a garbage OCR name
        ('escia') used to kill recognition. Used here only as one fusion input.
        """
        from .pipeline import Candidate

        scored: list[tuple[float, CardRecord]] = []
        name_norm = _normalize(hints.name) if hints.name else ""
        exact_pool = self.by_name.get(name_norm, []) if name_norm else []

        if name_norm and len(name_norm) >= 3:
            # exact + fuzzy name search across the catalog
            for card in exact_pool:
                base = 60.0
                scored.append((base * hints.name_confidence + 20.0, card))
            if not exact_pool:
                # fuzzy scan (bounded by first-letter buckets to stay fast)
                prefix = name_norm[0]
                for norm_name, pool in self.by_name.items():
                    if not norm_name or norm_name[0] != prefix:
                        continue
                    similarity = name_similarity(name_norm, norm_name)
                    if similarity >= 0.72:
                        for card in pool:
                            scored.append((similarity * 55.0 * hints.name_confidence, card))

        if hints.local_id and hints.number_confidence >= 0.5:
            # Alphanumeric reads ("SVP001", "TG05") carry a letter prefix the
            # catalog may or may not store (TG subsets DO store "TG05"; promo
            # sets store plain "001"). Exact match keeps the full-strength
            # bonus; a tail-only digit match ("SVP001" -> "001") is a weaker
            # signal — the prefix identified the SUBSET, the tail the card.
            read = hints.local_id
            read_tail = re.sub(r"^[A-Za-z]+", "", read) if not read.isdigit() else ""
            number_pool: list[CardRecord] = list(self.by_local_id.get(read.lstrip("0"), []))
            if read_tail:
                tail_key = read_tail.lstrip("0")
                for card in self.by_digits.get(tail_key, []):
                    if card not in number_pool and str(card.local_id).lstrip("0") != read.lstrip("0"):
                        number_pool.append(card)
            for card in number_pool:
                exact = card.local_id.lstrip("0") == read.lstrip("0")
                tail_only = (not exact and read_tail
                             and read_tail.lstrip("0") == card.local_id.lstrip("0"))
                if exact or tail_only:
                    bonus = 30.0 * hints.number_confidence if exact else 12.0 * hints.number_confidence
                    if hints.denominator and card.denominator == hints.denominator:
                        bonus += 25.0
                    if hints.language and card.language == hints.language:
                        bonus += 10.0
                    scored.append((bonus, card))

        # score refinement: language + HP
        results: list[Candidate] = []
        seen = set()
        for score, card in sorted(scored, key=lambda x: -x[0]):
            key = (card.language, card.id)
            if key in seen:
                continue
            seen.add(key)
            final_score = score
            if hints.language and card.language == hints.language:
                final_score += 8.0 * hints.language_confidence
            if hints.hp and card.hp == hints.hp:
                final_score += 6.0 * hints.hp_confidence
            from .pipeline import candidate_from_record
            candidate = candidate_from_record(card)
            candidate.score = final_score
            candidate.ocr_name_similarity = name_similarity(hints.name, card.name) if hints.name else 0.0
            candidate.ocr_number_match = (bool(hints.local_id and card.local_id
                                               and card.local_id.lstrip("0") == hints.local_id.lstrip("0"))
                                          if (hints.local_id and card.local_id) else None)
            candidate.ocr_language_match = bool(hints.language and card.language == hints.language)
            candidate.ocr_hp_match = bool(hints.hp and card.hp == hints.hp)
            results.append(candidate)
            if len(results) >= limit:
                break
        return results


def find_catalog_card(conn: sqlite3.Connection, language: str,
                      set_ref: str, number: str) -> Optional[dict]:
    """Resolve a user-typed (set, collector number) against the catalog.

    Fase 4.3 — ghost-lot guard: the auction wizard rejects lots whose card
    does not exist in the recognition catalog. Matching must be tolerant the
    way users type, but never fuzzy-guessing:

    - set_ref: TCGdex set id ("svp") OR set name ("Promo Escarlate e
      Violeta"), case-insensitive, accents stripped. A wrong set FAILS —
      it is never fuzzy-matched to the closest name.
    - number: printed collector number. Digits compare zero-padded
      ("001" == "1"); alphanumeric ids compare exact ("SWSH074",
      "TG05"); a prefixed number also tail-matches a digits-only localId of
      the SAME set ("SVP-001" <-> "001" when the prefix equals the set id).

    Returns {"id", "set_id", "local_id", "name"} of the matched card or
    None. Ambiguous set names resolve only when the number disambiguates
    them (exactly one set contains the card).
    """
    from .reconcile import normalize_local_id

    lang = str(language or "").strip() or "pt-BR"
    set_ref_norm = _normalize(str(set_ref or ""))
    number_raw = str(number or "").strip()
    if not set_ref_norm or not number_raw:
        return None

    set_rows = conn.execute(
        "SELECT DISTINCT set_id, set_name FROM cards WHERE language = ?", (lang,)).fetchall()
    candidates = [row for row in set_rows
                  if _normalize(row[0] or "") == set_ref_norm
                  or _normalize(row[1] or "") == set_ref_norm]
    if not candidates:
        return None

    number_norm = normalize_local_id(number_raw)
    prefix_match = re.match(r"^([A-Za-z]+)[-/._]?(\d+)$", number_raw)
    for set_id, _set_name in candidates:
        rows = conn.execute(
            "SELECT id, local_id, name FROM cards WHERE language = ? AND set_id = ?",
            (lang, set_id)).fetchall()
        for card_id, local_id, name in rows:
            if local_id is None:
                continue
            if local_id.lower() == number_raw.lower():
                return {"id": card_id, "set_id": set_id, "local_id": local_id, "name": name or ""}
            if normalize_local_id(local_id) == number_norm:
                return {"id": card_id, "set_id": set_id, "local_id": local_id, "name": name or ""}
            if (prefix_match is not None
                    and str(local_id).isdigit()
                    and normalize_local_id(prefix_match.group(1)) == normalize_local_id(set_id)
                    and normalize_local_id(local_id) == normalize_local_id(prefix_match.group(2))):
                return {"id": card_id, "set_id": set_id, "local_id": local_id, "name": name or ""}
    return None
