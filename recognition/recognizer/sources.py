# -*- coding: utf-8 -*-
"""Multi-source catalog fetchers beyond the primary TCGdex set endpoints.

Sources (2026-09 catalog round):
- TCGdex per-card endpoint: rarity + variants (+ illustrator), one request
  per card. Used by the optional enrichment pass; incremental + gap-tracked.
- pokemon-tcg-data (github.com/PokemonTCG/pokemon-tcg-data, raw JSON):
  EN-only historical dataset, one file per set (~177 requests total). Gives
  number/rarity/subtypes/images for essentially every EN card — an
  independent second source for reconciliation, gap detection and image
  backfill (images.pokemontcg.io).
- Official sources that are NOT programmatically consumable are probed and
  their unavailability RECORDED (honest reporting, no fake coverage):
  * pokemon.com — Incapsula JS challenge on every card URL.
  * pokemon-card.com — JS application, no server-rendered card data, no
    public JSON API (the search results are rendered client-side).
  * cartasdepokemon.com.br — JS application with a stale sitemap (every
    expansion URL in it 404s).

Nothing in this module hardcodes set ids: pokemon-tcg-data sets are matched
to TCGdex sets by identity heuristics (see reconcile.match_sets).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional

from .catalog import _http_get

PTCGDATA_RAW_BASE = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"

# Official sources that cannot be consumed by a plain-HTTP synchronizer.
# Probed on every catalog build; the result lands in the coverage report so
# "source unavailable" is an explicit, recorded fact — never a silent hole.
UNAVAILABLE_SOURCES = {
    "pokemon.com": "Incapsula JS challenge (bot protection) on every card page",
    "pokemon-card.com": "client-side rendered search, no public JSON API",
    "cartasdepokemon.com.br": "client-side rendered app, sitemap entries 404",
}


@dataclass
class PtcgCard:
    """One EN card from pokemon-tcg-data (native field names preserved)."""
    set_id: str
    number: str  # collector number as printed ("1", "101", "GG07", "SM99")
    name: str
    rarity: str = ""
    subtypes: list = field(default_factory=list)
    image_small: str = ""
    image_large: str = ""
    hp: Optional[int] = None
    printed_total: Optional[int] = None
    release_date: str = ""
    set_name: str = ""
    series: str = ""


@dataclass
class PtcgSet:
    set_id: str
    name: str
    series: str
    printed_total: int
    total: int
    release_date: str
    ptcgo_code: str = ""


def fetch_ptcgdata_sets() -> list[PtcgSet]:
    """All EN sets known to pokemon-tcg-data (1 request)."""
    raw = _http_get(f"{PTCGDATA_RAW_BASE}/sets/en.json", timeout=30.0)
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise RuntimeError("Unexpected pokemon-tcg-data sets payload")
    return [PtcgSet(
        set_id=s.get("id") or "",
        name=s.get("name") or "",
        series=s.get("series") or "",
        printed_total=int(s.get("printedTotal") or 0),
        total=int(s.get("total") or 0),
        release_date=s.get("releaseDate") or "",
        ptcgo_code=s.get("ptcgoCode") or "",
    ) for s in payload if s.get("id")]


def fetch_ptcgdata_cards(set_id: str) -> list[PtcgCard]:
    """All cards of one EN set from pokemon-tcg-data (1 request per set)."""
    raw = _http_get(f"{PTCGDATA_RAW_BASE}/cards/en/{set_id}.json", timeout=30.0)
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected pokemon-tcg-data payload for {set_id}")
    cards = []
    for c in payload:
        images = c.get("images") or {}
        hp = c.get("hp")
        cards.append(PtcgCard(
            set_id=set_id,
            number=str(c.get("number") or ""),
            name=c.get("name") or "",
            rarity=c.get("rarity") or "",
            subtypes=list(c.get("subtypes") or []),
            image_small=images.get("small") or "",
            image_large=images.get("large") or "",
            hp=int(hp) if isinstance(hp, str) and hp.isdigit() else (hp if isinstance(hp, int) else None),
        ))
    return cards


def fetch_ptcgdata_all(on_set=None) -> tuple[list[PtcgSet], dict[str, list[PtcgCard]]]:
    """Full EN dataset (sets + cards). ~1 + <n_sets> requests.

    on_set(set_id, n_cards, index, total) is an optional progress callback.
    Returns (sets, {set_id: cards}). A set whose card file fails transport
    retries is simply absent from the dict — the caller's gap detection
    treats it as a pokemon-tcg-data gap, never as "0 cards".
    """
    sets = fetch_ptcgdata_sets()
    cards_by_set: dict[str, list[PtcgCard]] = {}
    for i, s in enumerate(sets, 1):
        try:
            cards = fetch_ptcgdata_cards(s.set_id)
        except Exception:  # noqa: BLE001 — transport failure: record gap
            continue
        for card in cards:
            card.printed_total = s.printed_total
            card.release_date = s.release_date
            card.set_name = s.name
            card.series = s.series
        cards_by_set[s.set_id] = cards
        if on_set:
            on_set(s.set_id, len(cards), i, len(sets))
    return sets, cards_by_set


def fetch_tcgdex_card_details(language_code: str, card_id: str) -> Optional[dict]:
    """TCGdex per-card endpoint: rarity + variants + illustrator.

    Returns None on transport failure (caller records a gap); a JSON dict on
    success. The per-card endpoint is the only TCGdex surface that carries
    rarity — the set listings do not.
    """
    try:
        raw = _http_get(f"https://api.tcgdex.net/v2/{language_code}/cards/{card_id}", timeout=25.0)
    except Exception:  # noqa: BLE001
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) and "id" in payload else None


def probe_sources() -> dict:
    """Record the availability of every configured source (honest coverage).

    Probing is cheap (HEAD-ish GET with small timeout, no parsing): the
    point is to document WHY a source contributes nothing, so the coverage
    report can say "unavailable: <reason>" instead of silently omitting it.
    """
    import requests

    status: dict = {
        "tcgdex": {"available": True, "note": "primary source (sets + cards, all languages)"},
        "pokemon-tcg-data": {"available": True, "note": "EN reconciliation + rarity + images"},
    }
    for name, reason in UNAVAILABLE_SOURCES.items():
        status[name] = {"available": False, "note": reason}
    # Live probe of the two working sources keeps the report truthful after
    # outages (a source that starts failing is reported unavailable).
    try:
        resp = requests.get("https://api.tcgdex.net/v2/en/series", timeout=15.0)
        status["tcgdex"]["available"] = resp.status_code == 200
        if resp.status_code != 200:
            status["tcgdex"]["note"] = f"HTTP {resp.status_code} on /en/series"
    except Exception as exc:  # noqa: BLE001
        status["tcgdex"]["available"] = False
        status["tcgdex"]["note"] = f"transport failure: {str(exc)[:120]}"
    try:
        resp = requests.get(f"{PTCGDATA_RAW_BASE}/sets/en.json", timeout=15.0)
        status["pokemon-tcg-data"]["available"] = resp.status_code == 200
        if resp.status_code != 200:
            status["pokemon-tcg-data"]["note"] = f"HTTP {resp.status_code} on sets/en.json"
    except Exception as exc:  # noqa: BLE001
        status["pokemon-tcg-data"]["available"] = False
        status["pokemon-tcg-data"]["note"] = f"transport failure: {str(exc)[:120]}"
    return status


__all__ = [
    "PtcgCard", "PtcgSet", "UNAVAILABLE_SOURCES",
    "fetch_ptcgdata_sets", "fetch_ptcgdata_cards", "fetch_ptcgdata_all",
    "fetch_tcgdex_card_details", "probe_sources",
]
