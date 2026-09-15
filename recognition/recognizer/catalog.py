# -*- coding: utf-8 -*-
"""TCGdex catalog → local SQLite + scan cache (local-first, offline-capable)."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Iterable, Optional

import requests

from .config import CATALOG_DB, IMAGE_CACHE_DIR, LANGUAGES

TCGDEX_BASE = "https://api.tcgdex.net/v2"
ASSETS_BASE = "https://assets.tcgdex.net"

# Language map: app language -> TCGdex language code
LANG_CODE = {"pt-BR": "pt", "en": "en", "es": "es", "ja": "ja"}
CODE_LANG = {v: k for k, v in LANG_CODE.items()}

_lock = threading.Lock()


@dataclass
class CardRecord:
    id: str
    language: str  # app language (pt-BR, en, es, ja)
    set_id: str
    set_name: str
    serie_name: str
    serie_id: str
    local_id: str
    name: str
    hp: Optional[int]
    denominator: Optional[int]
    image_base: str  # https://assets.tcgdex.net/<lang>/<serie>/<set>/<localId>
    variants: str  # json
    release_date: str


def _http_get(url: str, timeout: float = 30.0, retries: int = 3) -> bytes:
    last = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code == 200:
                return resp.content
            if resp.status_code == 404:
                raise FileNotFoundError(url)
            last = RuntimeError(f"HTTP {resp.status_code} for {url}")
        except FileNotFoundError:
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
        time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def scan_path(image_base: str, quality: str = "high.webp") -> str:
    """Local cache path for an official scan."""
    # https://assets.tcgdex.net/pt/me/me01/091 -> pt/me/me01/091/high.webp
    tail = image_base[len(ASSETS_BASE):].strip("/")
    return os.path.join(IMAGE_CACHE_DIR, tail, quality)


def scan_url(image_base: str, quality: str = "high.webp") -> str:
    return f"{image_base}/{quality}"


# Quality fallback chain: ~1.2% of catalog scans lack high.webp on the CDN
# (404) but are available as low.webp. Without the chain those cards silently
# drop out of the index (catalog gap, cause G) and the pipeline can only
# match same-artwork reprints of them. NOTE: bare "png"/"jpg" URLs return
# HTTP 200 with an HTML error page, so downloads are validated by magic
# bytes before entering the cache.
SCAN_QUALITY_CHAIN = ("high.webp", "low.webp")

# Image magic bytes (JPEG / WebP / PNG / GIF) with a minimum plausible size
# for a card scan; anything else (HTML error pages, redirects) is rejected.
_MIN_SCAN_BYTES = 4096


def _looks_like_image(data: bytes) -> bool:
    if not data or len(data) < _MIN_SCAN_BYTES:
        return False
    head = data[:16]
    if head[:3] == b"\xff\xd8\xff":
        return True  # JPEG
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return True  # WebP
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return True  # PNG
    if head[:4] == b"GIF8":
        return True  # GIF
    return False


def _cache_scan(image_base: str, quality: str, data: bytes) -> str:
    path = scan_path(image_base, quality)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return path


def _en_mirror_base(image_base: str) -> Optional[str]:
    """English asset base for a localized card, when it exists."""
    for lang in ("pt", "es", "ja", "fr", "de", "it"):
        marker = f"/{lang}/"
        if marker in image_base:
            return image_base.replace(marker, "/en/", 1)
    return None


def ensure_scan(image_base: str, quality: str = "high.webp") -> Optional[str]:
    """Download-once local cache for an official scan. Returns local path or None.

    Tries the requested quality first, then the fallback chain, then (for
    non-English cards) the English mirror of the same card: when the localized
    scan is absent from the CDN the EN artwork still identifies the card, so
    the index can cover it instead of leaving a retrieval gap. Every download
    is validated by magic bytes so HTML error pages never enter the cache.
    Cached files (including EN mirrors) are checked before any network call.
    """
    chain = list(SCAN_QUALITY_CHAIN)
    if quality in chain:
        chain.remove(quality)
        chain.insert(0, quality)
    # 1. own-language cache hit (most common path: zero network)
    for q in chain:
        path = scan_path(image_base, q)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return path
    mirror_base = _en_mirror_base(image_base)
    # 2. EN-mirror cache hit
    if mirror_base:
        for q in chain:
            cached = scan_path(image_base, f"en-{q}")
            if os.path.exists(cached) and os.path.getsize(cached) > 0:
                return cached
    # 3. own-language downloads
    for q in chain:
        try:
            data = _http_get(scan_url(image_base, q), timeout=25.0)
        except Exception:
            continue
        if not _looks_like_image(data):
            continue
        return _cache_scan(image_base, q, data)
    # 4. EN-mirror download (same artwork, same local id in mirrored sets)
    if mirror_base:
        for q in chain:
            try:
                data = _http_get(scan_url(mirror_base, q), timeout=25.0)
            except Exception:
                continue
            if not _looks_like_image(data):
                continue
            return _cache_scan(image_base, f"en-{q}", data)
    return None


def init_db(db_path: str = CATALOG_DB) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS cards (
        id TEXT NOT NULL,
        language TEXT NOT NULL,
        set_id TEXT NOT NULL,
        set_name TEXT,
        serie_name TEXT,
        serie_id TEXT,
        local_id TEXT NOT NULL,
        name TEXT NOT NULL,
        hp INTEGER,
        denominator INTEGER,
        image_base TEXT,
        variants TEXT,
        release_date TEXT,
        PRIMARY KEY (id, language)
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_lang ON cards(language)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name)")
    conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def fetch_language_cards(language: str) -> list[CardRecord]:
    """Download full card list for a language via the set endpoints (includes set metadata)."""
    code = LANG_CODE.get(language)
    if not code:
        raise ValueError(f"Unsupported language {language}")
    raw = _http_get(f"{TCGDEX_BASE}/{code}/sets?pagination:itemsPerPage=500&pagination:page=1")
    sets = json.loads(raw)
    if not isinstance(sets, list):
        raise RuntimeError(f"Unexpected sets payload for {code}")
    records: list[CardRecord] = []
    for sset in sets:
        set_id = sset.get("id")
        if not set_id:
            continue
        try:
            detail_raw = _http_get(f"{TCGDEX_BASE}/{code}/sets/{set_id}", timeout=30.0)
            detail = json.loads(detail_raw)
        except Exception:
            continue
        card_count = detail.get("cardCount") or {}
        denominator = card_count.get("official") or card_count.get("total")
        serie = detail.get("serie") or {}
        for card in detail.get("cards") or []:
            image = card.get("image")
            if not image or "/tcgp/" in image:
                continue  # no official scan available
            variants = card.get("variants") or {}
            records.append(CardRecord(
                id=card["id"],
                language=language,
                set_id=set_id,
                set_name=detail.get("name") or set_id,
                serie_name=serie.get("name") or "",
                serie_id=serie.get("id") or "",
                local_id=str(card.get("localId") or ""),
                name=card.get("name") or "",
                hp=int(card["hp"]) if isinstance(card.get("hp"), int) else None,
                denominator=int(denominator) if denominator else None,
                image_base=image,
                variants=json.dumps(variants, ensure_ascii=False),
                release_date=detail.get("releaseDate") or "",
            ))
    return records


def save_records(conn: sqlite3.Connection, records: Iterable[CardRecord]) -> int:
    count = 0
    with _lock:
        for r in records:
            conn.execute("""INSERT OR REPLACE INTO cards
                (id, language, set_id, set_name, serie_name, serie_id, local_id, name,
                 hp, denominator, image_base, variants, release_date)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (r.id, r.language, r.set_id, r.set_name, r.serie_name, r.serie_id,
                 r.local_id, r.name, r.hp, r.denominator, r.image_base, r.variants, r.release_date))
            count += 1
        conn.commit()
    return count


def load_cards(conn: sqlite3.Connection, languages: Optional[list[str]] = None) -> list[CardRecord]:
    langs = languages or list(LANGUAGES)
    placeholders = ",".join("?" for _ in langs)
    rows = conn.execute(f"""SELECT id, language, set_id, set_name, serie_name, serie_id,
        local_id, name, hp, denominator, image_base, variants, release_date
        FROM cards WHERE language IN ({placeholders}) ORDER BY language, set_id, local_id""", langs).fetchall()
    return [CardRecord(
        id=row[0], language=row[1], set_id=row[2], set_name=row[3], serie_name=row[4],
        serie_id=row[5], local_id=row[6], name=row[7], hp=row[8], denominator=row[9],
        image_base=row[10] or "", variants=row[11] or "{}", release_date=row[12] or "",
    ) for row in rows]


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None
