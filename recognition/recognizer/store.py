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
            for card in self.cards:
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
            candidate.ocr_number_match = bool(hints.local_id and card.local_id.lstrip("0") == hints.local_id.lstrip("0"))
            candidate.ocr_language_match = bool(hints.language and card.language == hints.language)
            candidate.ocr_hp_match = bool(hints.hp and card.hp == hints.hp)
            results.append(candidate)
            if len(results) >= limit:
                break
        return results
