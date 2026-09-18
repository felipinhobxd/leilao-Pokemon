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
- Limitless TCG (api.limitlesstcg.com, requires LIMITLESS_API_KEY):
  sets + cards with printed collector numbers — the third image source,
  used to backfill image_alt on scanless pt-BR promos (pre-2011 Brazilian
  promos, magazine stamps, alphanumeric localIds) that TCGdex/pokemon-tcg-data
  do not cover. Probed every run; when unreachable/unauthenticated the gap
  is recorded in catalog.gaps.limitless with the reason — never fake
  coverage.
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
import os
from dataclasses import dataclass, field
from typing import Optional

from .catalog import _http_get

PTCGDATA_RAW_BASE = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"

# Limitless TCG developer API. Authenticated via X-Api-Key; base URL is
# overridable so a self-hosted mirror (or a future version bump) needs no
# code change. The key is read at call time (not import time) so tests can
# monkeypatch the environment.
LIMITLESS_API_BASE = os.environ.get("LIMITLESS_API_BASE", "https://api.limitlesstcg.com/v2")
LIMITLESS_API_KEY = os.environ.get("LIMITLESS_API_KEY", "")

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


# ---------------------------------------------------------------------- Limitless TCG
@dataclass
class LimitlessSet:
    """One set as published by Limitless TCG (native field names normalized).

    Attribute-compatible with PtcgSet on purpose: reconcile.match_sets
    works on (set_id, name, release_date, printed_total), so the same
    heuristics (exact id -> name+date+count) apply unchanged.
    """
    set_id: str
    name: str
    series: str = ""
    printed_total: int = 0
    total: int = 0
    release_date: str = ""
    ptcgo_code: str = ""


@dataclass
class LimitlessCard:
    """One card from Limitless TCG. `number` is the PRINTED collector number
    and may be alphanumeric ("SVP-001", "PROMO-A", "TG05") — the reconcile
    merge accepts [A-Z0-9][A-Z0-9/.-]* instead of digits-only."""
    set_id: str
    number: str
    name: str = ""
    rarity: str = ""
    subtypes: list = field(default_factory=list)
    image_small: str = ""
    image_large: str = ""
    hp: Optional[int] = None
    printed_total: Optional[int] = None
    release_date: str = ""
    set_name: str = ""
    series: str = ""


def limitless_headers() -> dict:
    """Auth headers (X-Api-Key). Empty key -> no header: the probe then
    reports the honest 401/403 instead of pretending to be configured."""
    key = os.environ.get("LIMITLESS_API_KEY", "") or LIMITLESS_API_KEY
    return {"X-Api-Key": key} if key else {}


def limitless_base() -> str:
    """API base (env overridable for mirrors; read at call time for tests)."""
    return os.environ.get("LIMITLESS_API_BASE", "") or LIMITLESS_API_BASE


def _limitless_payload(raw: bytes) -> list:
    """Limitless responses wrap lists in {"data": [...]} in some versions and
    return a bare list in others — accept both, reject anything else."""
    payload = json.loads(raw)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]
    raise RuntimeError("Unexpected Limitless payload shape")


def _limitless_images(entry: dict) -> tuple[str, str]:
    """(small, large) image URLs with tolerant key lookup (image/images,
    small/large, low/hiRes/hi). Absent -> ("", "")."""
    img = entry.get("image") or entry.get("images") or {}
    if isinstance(img, str):  # a bare URL field: treat it as the small variant
        return img, ""
    if not isinstance(img, dict):
        return "", ""
    small = img.get("small") or img.get("low") or img.get("url") or ""
    large = img.get("large") or img.get("hiRes") or img.get("hi") or img.get("full") or ""
    return str(small or ""), str(large or "")


def fetch_limitless_sets() -> list[LimitlessSet]:
    """All sets known to Limitless TCG (1 authenticated request)."""
    raw = _http_get(f"{limitless_base()}/sets", timeout=30.0, headers=limitless_headers())
    sets = []
    for s in _limitless_payload(raw):
        set_id = str(s.get("id") or s.get("code") or "")
        if not set_id:
            continue
        counts = s.get("cardCount") or {}
        total = s.get("total")
        if not isinstance(total, int):
            total = counts.get("total") if isinstance(counts, dict) else 0
        sets.append(LimitlessSet(
            set_id=set_id,
            name=str(s.get("name") or ""),
            series=str(s.get("series") or ""),
            printed_total=int(s.get("printedTotal")
                               or (counts.get("total") if isinstance(counts, dict) else 0) or 0),
            total=int(total or 0),
            release_date=str(s.get("releaseDate") or s.get("released") or ""),
            ptcgo_code=str(s.get("ptcgoCode") or s.get("code") or ""),
        ))
    return sets


def fetch_limitless_cards(set_id: str) -> list[LimitlessCard]:
    """All cards of one set from Limitless TCG (1 authenticated request).

    Field names are probed tolerantly (number/collectorNumber/localId,
    subtypes/types) because the dump format is documented by the provider,
    not by us — an unknown key must degrade to "" instead of crashing the
    catalog build.
    """
    raw = _http_get(f"{limitless_base()}/cards", timeout=30.0,
                    params={"set": set_id}, headers=limitless_headers())
    cards = []
    for c in _limitless_payload(raw):
        number = str(c.get("number") or c.get("collectorNumber") or c.get("localId") or "")
        if not number:
            continue
        small, large = _limitless_images(c)
        hp = c.get("hp")
        cards.append(LimitlessCard(
            set_id=set_id,
            number=number,
            name=str(c.get("name") or ""),
            rarity=str(c.get("rarity") or ""),
            subtypes=list(c.get("subtypes") or c.get("types") or []),
            image_small=small,
            image_large=large,
            hp=int(hp) if isinstance(hp, int) else (int(hp) if isinstance(hp, str) and hp.isdigit() else None),
        ))
    return cards


def fetch_limitless_all(on_set=None) -> tuple[list[LimitlessSet], dict[str, list[LimitlessCard]]]:
    """Full Limitless dataset (sets + cards per set). 1 + <n_sets> requests.

    on_set(set_id, n_cards, index, total) is an optional progress callback.
    A set whose card fetch fails transport retries is simply absent from the
    dict — the caller's gap detection treats it as a Limitless gap, never
    as "0 cards".
    """
    sets = fetch_limitless_sets()
    cards_by_set: dict[str, list[LimitlessCard]] = {}
    for i, s in enumerate(sets, 1):
        try:
            cards = fetch_limitless_cards(s.set_id)
        except Exception:  # noqa: BLE001 — transport failure: record gap
            continue
        for card in cards:
            card.printed_total = s.printed_total or None
            card.release_date = s.release_date
            card.set_name = s.name
            card.series = s.series
        cards_by_set[s.set_id] = cards
        if on_set:
            on_set(s.set_id, len(cards), i, len(sets))
    return sets, cards_by_set


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
        "limitless": {"available": True, "note": "3rd image source (pt-BR promo backfill, X-Api-Key)"},
    }
    for name, reason in UNAVAILABLE_SOURCES.items():
        status[name] = {"available": False, "note": reason}
    # Live probe of the working sources keeps the report truthful after
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
    # Limitless needs an API key; without one the probe says so honestly
    # instead of reporting a generic failure.
    if not limitless_headers():
        status["limitless"]["available"] = False
        status["limitless"]["note"] = "sem LIMITLESS_API_KEY configurada (auth X-Api-Key)"
    else:
        try:
            resp = requests.get(f"{limitless_base()}/sets", headers=limitless_headers(), timeout=15.0)
            if resp.status_code == 200:
                status["limitless"]["available"] = True
            elif resp.status_code in (401, 403):
                status["limitless"]["available"] = False
                status["limitless"]["note"] = f"HTTP {resp.status_code}: chave inválida/sem permissão"
            else:
                status["limitless"]["available"] = False
                status["limitless"]["note"] = f"HTTP {resp.status_code} em /sets"
        except Exception as exc:  # noqa: BLE001
            status["limitless"]["available"] = False
            status["limitless"]["note"] = f"transport failure: {str(exc)[:120]}"
    return status


__all__ = [
    "PtcgCard", "PtcgSet", "LimitlessCard", "LimitlessSet", "UNAVAILABLE_SOURCES",
    "fetch_ptcgdata_sets", "fetch_ptcgdata_cards", "fetch_ptcgdata_all",
    "fetch_tcgdex_card_details", "probe_sources",
    "fetch_limitless_sets", "fetch_limitless_cards", "fetch_limitless_all",
    "limitless_base", "limitless_headers",
]
