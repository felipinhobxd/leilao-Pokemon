# -*- coding: utf-8 -*-
"""Cross-source reconciliation: merge, never blindly concatenate.

The second EN source (pokemon-tcg-data) is reconciled against the primary
(TCGdex) at CARD level using the key (language, set, normalized localId).
Set ids do NOT match 1:1 between sources ("swsh12.5" vs "swsh12pt5"), so
sets are matched first — by exact id, then by a name+releaseDate+cardCount
heuristic. NO set ids are hardcoded: a new expansion matches by the same
heuristics or is honestly reported as source-only.

Merge policy (deterministic, every disagreement ledgered in `conflicts`):
- image URL     : TCGdex wins (the pipeline's cache/scan chain is keyed on
                  its asset URLs); the pokemon-tcg-data image is kept as
                  image_alt and used for BACKFILL when TCGdex has no scan.
- rarity        : pokemon-tcg-data wins when TCGdex has none (the TCGdex set
                  listing never provides rarity; only the optional per-card
                  enrichment pass fills it).
- subtypes      : pokemon-tcg-data only (TCGdex set listing has none).
- name          : conflict recorded, TCGdex value kept (the recognition
                  fusion weights are calibrated on TCGdex names).
- denominator(M): conflict recorded, TCGdex official count kept (it feeds
                  the N/M evidence); pokemon-tcg-data printedTotal used only
                  when TCGdex lacks it.
- releaseDate   : conflict recorded, TCGdex kept (used for display only).

Cards present only in pokemon-tcg-data are INSERTED (source-tagged, with
image_alt so the scan chain can fetch their images). Cards present only in
TCGdex stay (they are already there). The gap report states both directions
plus the intersection — no source is treated as absolute truth.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

from .catalog import (SOURCES_LIMITLESS, SOURCES_PTCGDATA, SOURCES_TCGDEX,
                      CardRecord, _lock, record_conflict)
from .sources import PtcgCard, PtcgSet

# Printed collector numbers accepted by the cross-source merge: plain digits,
# prefixed alphanumerics ("TG05", "SVP-001", "SM99"), "PROMO-A"-style ids and
# slash/dot separators. Anything else (junk scraped off a page) never enters
# the merge mapping.
VALID_LOCAL_ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9/.-]*$", re.IGNORECASE)


def normalize_local_id(local_id: str) -> str:
    """Normalization for the reconciliation key: lowercase + strip leading
    zeros of the numeric part ("001" == "1"; "TG05" == "tg5"?? NO — the
    prefix is kept case-normalized but zeros after a letter prefix are
    meaningful ("TG05" vs "TG5" never coexist in one source, so a single
    canonical form is safe within a matched set pair)."""
    raw = str(local_id or "").strip().lower()
    if not raw:
        return ""
    match = re.match(r"^([a-z]+)0*(\d+)$", raw)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    if raw.isdigit():
        return raw.lstrip("0") or "0"
    return raw


def _normalize_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value or "")
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def _parse_release_date(value: str) -> Optional[str]:
    """pokemon-tcg-data uses 1999/01/09; TCGdex uses 1999/01/09 too (both
    YYYY/MM/DD). Normalize to comparable digits-only form."""
    digits = re.sub(r"\D", "", value or "")
    return digits if len(digits) == 8 else None


@dataclass
class SetMatchReport:
    """Which second-source sets matched which primary sets."""
    matched: dict[str, str] = field(default_factory=dict)   # ptcg set_id -> tcgdex set_id
    only_primary: list[str] = field(default_factory=list)   # TCGdex sets with no ptcg counterpart
    only_secondary: list[str] = field(default_factory=list)  # ptcg sets with no TCGdex counterpart


def match_sets(primary_sets: list[dict], ptcg_sets: list[PtcgSet]) -> SetMatchReport:
    """Match pokemon-tcg-data sets to TCGdex sets WITHOUT hardcoded ids.

    Pass 1 — exact id equality ("swsh9" == "swsh9").
    Pass 2 — normalized name equality with compatible release dates
             (±45 days) and card counts (printed_total vs official, ±2 to
             absorb off-by-one counting philosophies).
    Pass 3 — normalized name equality alone, ONLY when the candidate is
             unambiguous (exactly one name match on each side).

    Everything unmatched is reported (only_primary / only_secondary) —
    subsets like Trainer Galleries live only in TCGdex and appear there.
    """
    report = SetMatchReport()
    by_id = {s.get("id"): s for s in primary_sets if s.get("id")}
    used_primary: set[str] = set()

    # Pass 1: exact ids
    for p in ptcg_sets:
        if p.set_id in by_id:
            report.matched[p.set_id] = p.set_id
            used_primary.add(p.set_id)

    # Index unmatched primary sets by normalized name
    by_name: dict[str, list[str]] = {}
    for s in primary_sets:
        sid = s.get("id")
        if not sid or sid in used_primary:
            continue
        by_name.setdefault(_normalize_name(s.get("name") or ""), []).append(sid)

    # Pass 2: name + date + count
    for p in ptcg_sets:
        if p.set_id in report.matched:
            continue
        candidates = by_name.get(_normalize_name(p.name), [])
        if not candidates:
            continue
        p_date = _parse_release_date(p.release_date)
        good = []
        for sid in candidates:
            primary = by_id[sid]
            s_date = _parse_release_date(primary.get("releaseDate") or "")
            if p_date and s_date:
                try:
                    delta = abs(
                        time.mktime(time.strptime(p_date, "%Y%m%d"))
                        - time.mktime(time.strptime(s_date, "%Y%m%d")))
                except ValueError:
                    delta = None
                if delta is not None and delta > 45 * 86400:
                    continue
            counts = primary.get("cardCount") or {}
            official = int(counts.get("official") or counts.get("total") or 0)
            if official and p.printed_total and abs(official - p.printed_total) > 2:
                continue
            good.append(sid)
        if len(good) == 1:
            report.matched[p.set_id] = good[0]
            used_primary.add(good[0])
            by_name[_normalize_name(p.name)] = [s for s in candidates if s != good[0]]

    # Pass 3: unambiguous name match. The date guard still applies when both
    # sides publish a date: "Base" 1999 and a hypothetical modern "Base" are
    # NOT the same set, whatever the name says.
    def _dates_compatible(primary: dict, p: PtcgSet) -> bool:
        p_date = _parse_release_date(p.release_date)
        s_date = _parse_release_date(primary.get("releaseDate") or "")
        if not p_date or not s_date:
            return True  # unknown dates cannot contradict
        try:
            delta = abs(time.mktime(time.strptime(p_date, "%Y%m%d"))
                        - time.mktime(time.strptime(s_date, "%Y%m%d")))
        except ValueError:
            return True
        return delta <= 45 * 86400

    for p in ptcg_sets:
        if p.set_id in report.matched:
            continue
        candidates = [s for s in by_name.get(_normalize_name(p.name), [])
                      if s not in used_primary and _dates_compatible(by_id[s], p)]
        if len(candidates) == 1:
            report.matched[p.set_id] = candidates[0]
            used_primary.add(candidates[0])

    report.only_primary = sorted(sid for sid in by_id if sid not in used_primary)
    report.only_secondary = sorted(p.set_id for p in ptcg_sets if p.set_id not in report.matched)
    return report


@dataclass
class ReconcileReport:
    """Per-language reconciliation outcome (the gap detector's payload)."""
    language: str
    secondary_source: str = SOURCES_PTCGDATA
    matched_sets: int = 0
    only_primary_sets: list[str] = field(default_factory=list)
    only_secondary_sets: list[str] = field(default_factory=list)
    cards_both: int = 0
    cards_only_primary: int = 0
    cards_only_secondary: int = 0
    conflicts: int = 0
    enriched_rarity: int = 0
    enriched_subtypes: int = 0
    backfilled_image_alt: int = 0
    inserted_secondary_cards: int = 0
    failed_secondary_sets: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "secondarySource": self.secondary_source,
            "matchedSets": self.matched_sets,
            "onlyPrimarySets": self.only_primary_sets,
            "onlySecondarySets": self.only_secondary_sets,
            "cardsBoth": self.cards_both,
            "cardsOnlyPrimary": self.cards_only_primary,
            "cardsOnlySecondary": self.cards_only_secondary,
            "conflicts": self.conflicts,
            "enrichedRarity": self.enriched_rarity,
            "enrichedSubtypes": self.enriched_subtypes,
            "backfilledImageAlt": self.backfilled_image_alt,
            "insertedSecondaryCards": self.inserted_secondary_cards,
            "failedSecondarySets": self.failed_secondary_sets,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }


def _ptcg_image_alt(card: PtcgCard) -> str:
    """Preferred alternate image: hi-res when published, small otherwise."""
    return card.image_large or card.image_small or ""


def reconcile_ptcgdata(conn: sqlite3.Connection, listing: list[dict],
                       ptcg_sets: list[PtcgSet],
                       cards_by_set: dict[str, list[PtcgCard]]) -> ReconcileReport:
    """Merge the EN pokemon-tcg-data dataset into the catalog (language=en).

    Mutations are additive/enriching only: existing TCGdex rows are UPDATED
    in place (rarity/subtypes/image_alt/sources) — never deleted; their
    recognition-calibrated fields (name/denominator/image_base) change only
    through the ledgered conflict policy. Cards exclusive to pokemon-tcg-data
    are inserted with a synthetic id ("<setid>-<number>") and source tag.
    """
    report = ReconcileReport(language="en")
    matches = match_sets(listing, ptcg_sets)
    report.matched_sets = len(matches.matched)
    report.only_primary_sets = matches.only_primary
    report.only_secondary_sets = matches.only_secondary

    # Existing EN rows indexed by reconciliation key
    rows = conn.execute(
        "SELECT id, set_id, local_id, name, denominator, image_base, image_alt, rarity, subtypes, sources, hp "
        "FROM cards WHERE language='en'").fetchall()
    by_key: dict[str, tuple] = {}
    id_to_key: dict[str, str] = {}
    for row in rows:
        key = f"{row[1]}|{normalize_local_id(row[2])}"
        by_key[key] = row
        id_to_key[row[0]] = key

    inserts: list[CardRecord] = []
    with _lock:
        for ptcg_set_id, tcgdex_set_id in matches.matched.items():
            cards = cards_by_set.get(ptcg_set_id)
            if cards is None:
                report.failed_secondary_sets.append(ptcg_set_id)
                continue
            set_info = next((s for s in ptcg_sets if s.set_id == ptcg_set_id), None)
            for card in cards:
                norm = normalize_local_id(card.number)
                if not norm:
                    continue
                key = f"{tcgdex_set_id}|{norm}"
                existing = by_key.get(key)
                sources_patch = {SOURCES_PTCGDATA: {"number": card.number, "rarity": card.rarity}}
                if existing is None:
                    # Card only in pokemon-tcg-data: insert, source-tagged,
                    # with the alternate image so the scan chain can fetch it.
                    card_id = f"{tcgdex_set_id}-{card.number}"
                    inserts.append(CardRecord(
                        id=card_id, language="en", set_id=tcgdex_set_id,
                        set_name=(set_info.name if set_info else tcgdex_set_id),
                        serie_name=(set_info.series if set_info else ""),
                        serie_id="", local_id=card.number, name=card.name,
                        hp=card.hp,
                        denominator=set_info.printed_total if set_info else None,
                        image_base="",
                        variants="{}",
                        release_date=(set_info.release_date if set_info else ""),
                        scan_status="not_available",
                        canonical_id=f"{tcgdex_set_id}|{card.number}",
                        rarity=card.rarity,
                        subtypes=json.dumps(card.subtypes, ensure_ascii=False),
                        image_alt=_ptcg_image_alt(card),
                        sources=json.dumps(sources_patch, ensure_ascii=False),
                    ))
                    report.cards_only_secondary += 1
                    report.inserted_secondary_cards += 1
                    continue
                # Both sources have the card: enrich + ledger disagreements.
                (row_id, _sid, _lid, row_name, row_den, row_img, row_alt, row_rarity,
                 row_subtypes, row_sources, row_hp) = existing
                report.cards_both += 1
                updates: dict[str, object] = {}
                merged_sources = json.loads(row_sources or "{}")
                merged_sources.update(sources_patch)

                if not row_rarity and card.rarity:
                    updates["rarity"] = card.rarity
                    report.enriched_rarity += 1
                elif row_rarity and card.rarity and row_rarity != card.rarity:
                    record_conflict(conn, "en", row_id, SOURCES_TCGDEX, SOURCES_PTCGDATA,
                                    "rarity", row_rarity, card.rarity,
                                    f"kept:{SOURCES_TCGDEX}")
                    report.conflicts += 1
                if not row_subtypes or row_subtypes == "[]":
                    if card.subtypes:
                        updates["subtypes"] = json.dumps(card.subtypes, ensure_ascii=False)
                        report.enriched_subtypes += 1
                if _normalize_name(card.name) != _normalize_name(row_name or ""):
                    record_conflict(conn, "en", row_id, SOURCES_TCGDEX, SOURCES_PTCGDATA,
                                    "name", row_name, card.name, f"kept:{SOURCES_TCGDEX}")
                    report.conflicts += 1
                printed_total = None
                if set_info is not None:
                    printed_total = set_info.printed_total or None
                if row_den is None and printed_total is not None:
                    updates["denominator"] = printed_total
                elif (row_den is not None and printed_total is not None
                      and int(row_den) != int(printed_total)):
                    record_conflict(conn, "en", row_id, SOURCES_TCGDEX, SOURCES_PTCGDATA,
                                    "denominator", row_den, printed_total,
                                    f"kept:{SOURCES_TCGDEX}")
                    report.conflicts += 1
                if row_hp is None and card.hp is not None:
                    updates["hp"] = card.hp
                # image_alt backfill: only when the row has no TCGdex scan at
                # all — a working primary scan is always preferable.
                if (not row_img) and (not row_alt) and _ptcg_image_alt(card):
                    updates["image_alt"] = _ptcg_image_alt(card)
                    report.backfilled_image_alt += 1
                updates["sources"] = json.dumps(merged_sources, ensure_ascii=False)
                if updates:
                    assign = ", ".join(f"{col} = ?" for col in updates)
                    conn.execute(f"UPDATE cards SET {assign} WHERE id = ? AND language = 'en'",
                                 (*updates.values(), row_id))
        # Cards only in the primary source (present in TCGdex, absent in
        # pokemon-tcg-data): count them for the gap report.
        matched_keys = set()
        for ptcg_set_id, tcgdex_set_id in matches.matched.items():
            for card in cards_by_set.get(ptcg_set_id, []):
                norm = normalize_local_id(card.number)
                if norm:
                    matched_keys.add(f"{tcgdex_set_id}|{norm}")
        for key, row in by_key.items():
            if key not in matched_keys:
                report.cards_only_primary += 1
        conn.commit()
    if inserts:
        from .catalog import save_records
        save_records(conn, inserts)
    return report


def backfill_alt_images(conn: sqlite3.Connection, language: str, listing: list[dict],
                        ptcg_sets: list[PtcgSet],
                        cards_by_set: dict[str, list[PtcgCard]]) -> int:
    """Second-source image backfill for a NON-EN language (pt-BR).

    International sets share ids across TCGdex languages (pt-BR "sv01" is
    the same global set as en "sv01"), so a pt-BR card whose set matches a
    pokemon-tcg-data set can use the EN image as an artwork mirror — the
    exact same concept as the existing TCGdex en-mirror, on an independent
    CDN. Only rows with NO TCGdex scan and NO alt yet are touched.

    Returns the number of rows that gained an image_alt.
    """
    if language == "en":
        return 0
    return _backfill_alt_from_source(conn, language, listing, ptcg_sets, cards_by_set,
                                     number_of=lambda card: card.number,
                                     image_of=_ptcg_image_alt,
                                     source_tag=SOURCES_PTCGDATA)


def _limitless_image_alt(card) -> str:
    """Preferred Limitless image: the hi-res when published, small otherwise."""
    return card.image_large or card.image_small or ""


def backfill_limitless_images(conn: sqlite3.Connection, language: str, listing: list[dict],
                              limitless_sets: list,
                              cards_by_set: dict) -> int:
    """Third-source (Limitless TCG) image backfill for scanless rows.

    Same policy as the pokemon-tcg-data backfill: only rows with NO TCGdex
    scan AND no alt yet gain an image, matched by set (heuristic, no
    hardcoded ids) + normalized collector number. Collector numbers are
    merged as [A-Z0-9][A-Z0-9/.-]* (not digits-only), so Brazilian promo
    ids ("PROMO-A", "SVP-001", "TG05") pair with the catalog; a prefixed
    number also tail-matches a digits-only localId of the same set
    ("SVP-001" <-> "001" when the prefix equals the set id). Ambiguous
    tails (two different source numbers collapsing to the same tail) are
    NEVER used — ambiguity is reported by staying unfilled, not guessed.
    """
    return _backfill_alt_from_source(conn, language, listing, limitless_sets, cards_by_set,
                                     number_of=lambda card: card.number,
                                     image_of=_limitless_image_alt,
                                     source_tag=SOURCES_LIMITLESS)


def _backfill_alt_from_source(conn: sqlite3.Connection, language: str, listing: list[dict],
                              sets: list, cards_by_set: dict, *, number_of, image_of,
                              source_tag: str) -> int:
    """Generic image_alt backfill shared by the pokemon-tcg-data and
    Limitless paths: match sets by heuristic, index (set, number) -> image
    URL, fill scanless+altless rows, ledger `sources` per touched row."""
    matches = match_sets(listing, sets)
    # source card lookup, two indexes:
    #   full   -> (tcgdex set id, normalized number) -> image url  (exact id)
    #   tail   -> (tcgdex set id, normalized digits tail) -> image url, only
    #             for prefixed numbers whose prefix matches the set id, and
    #             only when the tail is UNAMBIGUOUS within the set
    alt_by_key: dict[str, str] = {}
    tail_by_key: dict[str, str] = {}
    tail_conflicts: set[str] = set()
    tail_source_numbers: dict[str, str] = {}
    for source_set_id, tcgdex_set_id in matches.matched.items():
        for card in cards_by_set.get(source_set_id, []):
            number = str(number_of(card) or "")
            url = image_of(card)
            if not number or not url or not VALID_LOCAL_ID_RE.match(number):
                continue
            norm = normalize_local_id(number)
            alt_by_key[f"{tcgdex_set_id}|{norm}"] = url
            tail_match = re.match(r"^([A-Za-z]+)[-/._]?(\d+)$", number)
            if tail_match and normalize_local_id(tail_match.group(1)) == normalize_local_id(tcgdex_set_id):
                tail_key = f"{tcgdex_set_id}|{normalize_local_id(tail_match.group(2))}"
                if tail_key in tail_by_key and tail_source_numbers[tail_key] != norm:
                    tail_conflicts.add(tail_key)  # two different cards claim this tail
                else:
                    tail_by_key[tail_key] = url
                    tail_source_numbers[tail_key] = norm
    rows = conn.execute(
        "SELECT id, set_id, local_id FROM cards "
        "WHERE language = ? AND (image_base IS NULL OR image_base = '') "
        "AND (image_alt IS NULL OR image_alt = '')", (language,)).fetchall()
    n = 0
    with _lock:
        for row_id, set_id, local_id in rows:
            url = alt_by_key.get(f"{set_id}|{normalize_local_id(local_id)}")
            if not url and str(local_id or "").isdigit():
                tail_key = f"{set_id}|{normalize_local_id(local_id)}"
                if tail_key in tail_by_key and tail_key not in tail_conflicts:
                    url = tail_by_key[tail_key]
            if not url:
                continue
            conn.execute("UPDATE cards SET image_alt = ? WHERE id = ? AND language = ?",
                         (url, row_id, language))
            # keep the sources ledger accurate without clobbering other entries
            row = conn.execute("SELECT sources FROM cards WHERE id = ? AND language = ?",
                               (row_id, language)).fetchone()
            if row and row[0]:
                try:
                    merged = json.loads(row[0])
                    merged.update({source_tag: {"image": url}})
                    conn.execute("UPDATE cards SET sources = ? WHERE id = ? AND language = ?",
                                 (json.dumps(merged, ensure_ascii=False), row_id, language))
                except json.JSONDecodeError:
                    pass
            n += 1
        conn.commit()
    return n


__all__ = [
    "normalize_local_id", "match_sets", "SetMatchReport", "ReconcileReport",
    "reconcile_ptcgdata", "backfill_alt_images", "backfill_limitless_images",
]
