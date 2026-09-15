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


def _magic_ok(head: bytes) -> bool:
    if head[:3] == b"\xff\xd8\xff":
        return True  # JPEG
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return True  # WebP
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return True  # PNG
    if head[:4] == b"GIF8":
        return True  # GIF
    return False


def _looks_like_image(data: bytes) -> bool:
    if not data or len(data) < _MIN_SCAN_BYTES:
        return False
    return _magic_ok(data[:16])


def _cached_scan_ok(path: str) -> bool:
    """Cache-hit validation: a previously downloaded file must still look like
    an image (>= 4 KB + magic bytes). The CDN returns HTTP 200 + HTML for some
    missing scans; older caches and interrupted writes can hold such garbage,
    and `exists && size > 0` happily serves it back forever.
    """
    try:
        if not os.path.exists(path) or os.path.getsize(path) < _MIN_SCAN_BYTES:
            return False
        with open(path, "rb") as fh:
            head = fh.read(16)
    except OSError:
        return False
    return _magic_ok(head)


def _invalidate_cache(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


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


def resolve_scan(image_base: Optional[str]) -> Optional[tuple[str, str]]:
    """Resolve a usable scan for an asset base.

    Returns (local_path, source) with source in
    {"high.webp", "low.webp", "en-high.webp", "en-low.webp"}, or None.

    Order (cache-first, zero network on the hot path):
      1. own-language cache (validated by magic bytes; corrupt entries are
         removed and treated as misses)
      2. EN-mirror cache
      3. own-language download (high -> low)
      4. EN-mirror download (same artwork, same local id in mirrored sets)
    Every download is validated by magic bytes so HTML error pages never
    enter the cache.
    """
    if not image_base:
        return None
    chain = list(SCAN_QUALITY_CHAIN)
    # 1. own-language cache hit (most common path: zero network)
    for q in chain:
        path = scan_path(image_base, q)
        if _cached_scan_ok(path):
            return path, q
        elif os.path.exists(path):
            _invalidate_cache(path)
    mirror_base = _en_mirror_base(image_base)
    # 2. EN-mirror cache hit
    if mirror_base:
        for q in chain:
            cached = scan_path(image_base, f"en-{q}")
            if _cached_scan_ok(cached):
                return cached, f"en-{q}"
            elif os.path.exists(cached):
                _invalidate_cache(cached)
    # 3. own-language downloads
    for q in chain:
        try:
            data = _http_get(scan_url(image_base, q), timeout=25.0)
        except Exception:
            continue
        if not _looks_like_image(data):
            continue
        return _cache_scan(image_base, q, data), q
    # 4. EN-mirror download (same artwork, same local id in mirrored sets)
    if mirror_base:
        for q in chain:
            try:
                data = _http_get(scan_url(mirror_base, q), timeout=25.0)
            except Exception:
                continue
            if not _looks_like_image(data):
                continue
            return _cache_scan(image_base, f"en-{q}", data), f"en-{q}"
    return None


def ensure_scan(image_base: str, quality: str = "high.webp") -> Optional[str]:
    """Download-once local cache for an official scan. Returns local path or None.

    See resolve_scan() for the full resolution chain (quality fallback + EN
    mirror + magic-byte validation on downloads AND cache hits).
    """
    resolved = resolve_scan(image_base)
    return resolved[0] if resolved is not None else None


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


@dataclass
class FetchReport:
    """Per-language fetch outcome. A catalog build is only COMPLETE when
    failed_sets is empty; partial data must never be stamped as updated."""
    language: str
    expected_sets: int
    succeeded_sets: int
    failed_sets: list[str]

    @property
    def ok(self) -> bool:
        return not self.failed_sets


def fetch_language_cards(language: str) -> tuple[list[CardRecord], FetchReport]:
    """Download full card list for a language via the set endpoints.

    A set that still fails after the transport retries plus one set-level
    retry is REPORTED (FetchReport.failed_sets) instead of being silently
    skipped: the caller decides whether the result may be stamped complete.
    """
    code = LANG_CODE.get(language)
    if not code:
        raise ValueError(f"Unsupported language {language}")
    raw = _http_get(f"{TCGDEX_BASE}/{code}/sets?pagination:itemsPerPage=500&pagination:page=1")
    sets = json.loads(raw)
    if not isinstance(sets, list):
        raise RuntimeError(f"Unexpected sets payload for {code}")
    records: list[CardRecord] = []
    failed: list[str] = []
    expected = 0
    for sset in sets:
        set_id = sset.get("id")
        if not set_id:
            continue
        expected += 1
        detail = None
        for attempt in range(2):  # set-level retry on top of _http_get retries
            try:
                detail = json.loads(_http_get(f"{TCGDEX_BASE}/{code}/sets/{set_id}", timeout=30.0))
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        if detail is None:
            failed.append(set_id)
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
    report = FetchReport(language=language, expected_sets=expected,
                         succeeded_sets=expected - len(failed), failed_sets=failed)
    return records, report


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
