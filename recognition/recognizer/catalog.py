# -*- coding: utf-8 -*-
"""TCGdex catalog → local SQLite + scan cache (local-first, offline-capable)."""
from __future__ import annotations

import json
import os
import random
import re
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

# Catalog language classes:
# - CORE languages must be COMPLETE for the recognition service to be useful
#   (pt-BR/en index is what identification runs on): a failed core fetch
#   blocks the installer (non-zero exit).
# - OPTIONAL languages are metadata-only (es/ja): a gap degrades those
#   languages' coverage but must never block installation — the failure is
#   recorded in catalog.gaps.<lang> and a later run retries just the gaps.
CORE_LANGUAGES = ("pt-BR", "en")
OPTIONAL_LANGUAGES = ("es", "ja")

_lock = threading.Lock()

# Thread-local requests.Session: connection pooling without cross-thread
# sharing (requests.Session is NOT documented as thread-safe). Each worker
# thread reuses its own TCP/TLS connections to api/assets.tcgdex.net
# instead of paying a fresh TLS handshake per download.
_session_local = threading.local()


def _get_session() -> requests.Session:
    """Per-thread Session with keep-alive pooling."""
    session = getattr(_session_local, "session", None)
    if session is None:
        session = requests.Session()
        # Conservative pool: many short-lived download threads each hold 1-2
        # connections; the CDN is httpbin-style HTTP/1.1 so 10 is plenty.
        adapter = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=4)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _session_local.session = session
    return session


class HttpRateLimited(RuntimeError):
    """HTTP 429 that could not be waited out inside _http_get.

    Carries the server-provided Retry-After (seconds) when present so callers
    can decide how long to back off instead of hammering the CDN."""

    def __init__(self, url: str, retry_after: Optional[float] = None):
        super().__init__(f"HTTP 429 for {url} (Retry-After: {retry_after})")
        self.retry_after = retry_after


_HTTP_STATUS_RE = re.compile(r"HTTP (\d{3})")


def _parse_retry_after(resp) -> Optional[float]:
    """Retry-After header in delta-seconds form (HTTP-date form is ignored)."""
    raw = resp.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


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
    # Scan availability class for THIS card (coverage reporting + sync):
    #   ""                 -> an official scan exists (image_base set)
    #   "not_available"    -> TCGdex lists the card but publishes no scan for
    #                          it (promos without images, /tcgp/ redirects).
    #                          The card is STILL a route-B (OCR/text) candidate:
    #                          dropping it from the catalog used to make it
    #                          invisible to identification entirely.
    scan_status: str = ""


# Scan sync states (scans table): the incremental synchronizer's state machine.
#   validated     -> downloaded (or already cached), magic-bytes OK, sha256 recorded
#   failed        -> transport/transient failure: retry on the next run
#   not_available -> no scan published (empty image_base, or every URL 404'd)
SCAN_STATES = ("validated", "failed", "not_available")


def _http_get(url: str, timeout: float = 30.0, retries: int = 3) -> bytes:
    """Fetch with failure-class-aware retries:

    - 200            -> payload;
    - 404            -> FileNotFoundError immediately (definitive, never retried);
    - 429            -> respect Retry-After when it is short, otherwise raise
                        HttpRateLimited so callers back off instead of hammering;
    - 5xx            -> exponential backoff with jitter, bounded retries;
    - timeout/conn   -> bounded retries with the same backoff;
    - other 4xx      -> surfaced as RuntimeError after the bounded retries.
    """
    last = None
    for attempt in range(retries):
        try:
            resp = _get_session().get(url, timeout=timeout)
            if resp.status_code == 200:
                return resp.content
            if resp.status_code == 404:
                raise FileNotFoundError(url)
            if resp.status_code == 429:
                retry_after = _parse_retry_after(resp)
                if attempt + 1 >= retries or (retry_after or 0.0) > 120.0:
                    raise HttpRateLimited(url, retry_after)
                # honor a short Retry-After once instead of the default backoff
                time.sleep(min(retry_after if retry_after is not None else 0.8 * (attempt + 1), 60.0))
                last = HttpRateLimited(url, retry_after)
                continue
            last = RuntimeError(f"HTTP {resp.status_code} for {url}")
        except (FileNotFoundError, HttpRateLimited):
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
        time.sleep(0.8 * (2 ** attempt) + random.uniform(0.0, 0.4))
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


def _classify_failure(exc: Exception) -> str:
    """Map a transport exception to a negative-cache class.

    - HttpRateLimited -> "rate-limited" (server asked us to slow down)
    - FileNotFoundError -> "not-found" (HTTP 404, definitive per URL)
    - anything else (timeout, conn refused, 5xx, HTTP-date 429) -> "transient"
    """
    if isinstance(exc, HttpRateLimited):
        return "rate-limited"
    if isinstance(exc, FileNotFoundError):
        return "not-found"
    return "transient"


def resolve_scan_classified(image_base: Optional[str]) -> tuple[Optional[tuple[str, str]], str]:
    """Resolve a usable scan AND report why it failed.

    Returns ((path, source) | None, reason) with reason in
    {"ok", "no-base", "not-found", "transient", "rate-limited"}.

    The reason feeds the pipeline's TTL-classified negative cache:
    - "not-found"   -> every URL in the chain answered 404: a definitive gap
                       on the CDN, safe to remember for hours;
    - "transient"   -> timeout / connection error / 5xx / 200-with-HTML:
                       the scan may exist, retry soon;
    - "rate-limited"-> 429: back off and retry later, do not hammer.
    Priority when several failures mix: rate-limited > transient > not-found
    (a chain that mixed 404s with timeouts has NOT been proven absent).
    """
    if not image_base:
        return None, "no-base"
    saw_rate_limited = saw_transient = saw_not_found = False

    def _note(exc: Exception) -> None:
        nonlocal saw_rate_limited, saw_transient, saw_not_found
        kind = _classify_failure(exc)
        if kind == "rate-limited":
            saw_rate_limited = True
        elif kind == "transient":
            saw_transient = True
        else:
            saw_not_found = True

    def _finish_fail() -> str:
        if saw_rate_limited:
            return "rate-limited"
        if saw_transient:
            return "transient"
        if saw_not_found:
            return "not-found"
        return "transient"  # nothing recorded (e.g. only invalid payloads)

    chain = list(SCAN_QUALITY_CHAIN)
    # 1. own-language cache hit (most common path: zero network)
    for q in chain:
        path = scan_path(image_base, q)
        if _cached_scan_ok(path):
            return (path, q), "ok"
        elif os.path.exists(path):
            _invalidate_cache(path)
    mirror_base = _en_mirror_base(image_base)
    # 2. EN-mirror cache hit
    if mirror_base:
        for q in chain:
            cached = scan_path(image_base, f"en-{q}")
            if _cached_scan_ok(cached):
                return (cached, f"en-{q}"), "ok"
            elif os.path.exists(cached):
                _invalidate_cache(cached)
    # 3. own-language downloads
    for q in chain:
        try:
            data = _http_get(scan_url(image_base, q), timeout=25.0)
        except Exception as exc:  # noqa: BLE001
            _note(exc)
            continue
        if not _looks_like_image(data):
            # HTTP 200 with an HTML error page: not provably absent -> transient
            saw_transient = True
            continue
        return (_cache_scan(image_base, q, data), q), "ok"
    # 4. EN-mirror download (same artwork, same local id in mirrored sets)
    if mirror_base:
        for q in chain:
            try:
                data = _http_get(scan_url(mirror_base, q), timeout=25.0)
            except Exception as exc:  # noqa: BLE001
                _note(exc)
                continue
            if not _looks_like_image(data):
                saw_transient = True
                continue
            return (_cache_scan(image_base, f"en-{q}", data), f"en-{q}"), "ok"
    return None, _finish_fail()


def resolve_scan(image_base: Optional[str]) -> Optional[tuple[str, str]]:
    """Resolve a usable scan for an asset base.

    Returns (local_path, source) with source in
    {"high.webp", "low.webp", "en-high.webp", "en-low.webp"}, or None.
    See resolve_scan_classified() for the failure reason variant used by the
    pipeline's negative cache.

    Order (cache-first, zero network on the hot path):
      1. own-language cache (validated by magic bytes; corrupt entries are
         removed and treated as misses)
      2. EN-mirror cache
      3. own-language download (high -> low)
      4. EN-mirror download (same artwork, same local id in mirrored sets)
    Every download is validated by magic bytes so HTML error pages never
    enter the cache.
    """
    return resolve_scan_classified(image_base)[0]


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
        scan_status TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (id, language)
    )""")
    # Migration for catalogs built before scan_status existed.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(cards)")}
    if "scan_status" not in columns:
        conn.execute("ALTER TABLE cards ADD COLUMN scan_status TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_lang ON cards(language)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name)")
    # Scan sync state machine: one row per asset base. `validated` rows carry
    # the sha256 recorded at download time so later runs can detect corrupt
    # cache files (magic bytes alone miss mid-file corruption).
    conn.execute("""CREATE TABLE IF NOT EXISTS scans (
        image_base TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        bytes INTEGER,
        sha256 TEXT,
        updated_at TEXT
    )""")
    conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def record_scan_state(conn: sqlite3.Connection, image_base: str, state: str,
                       nbytes: Optional[int] = None, sha256: Optional[str] = None) -> None:
    """Persist the sync state of one scan (see SCAN_STATES)."""
    if state not in SCAN_STATES:
        raise ValueError(f"Unknown scan state {state!r}")
    with _lock:
        conn.execute("""INSERT OR REPLACE INTO scans (image_base, state, bytes, sha256, updated_at)
            VALUES (?,?,?,?,?)""",
            (image_base, state, nbytes, sha256, time.strftime("%Y-%m-%dT%H:%M:%S")))
        conn.commit()


def get_scan_state(conn: sqlite3.Connection, image_base: str) -> Optional[tuple]:
    """(state, bytes, sha256) recorded for an asset base, if any."""
    row = conn.execute("SELECT state, bytes, sha256 FROM scans WHERE image_base = ?", (image_base,)).fetchone()
    return tuple(row) if row else None


def scan_state_counts(conn: sqlite3.Connection) -> dict[str, int]:
    """Rows per scan state (sync reporting: downloaded/failed/not_available)."""
    return {state: count for state, count in conn.execute(
        "SELECT state, COUNT(*) FROM scans GROUP BY state")}


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


def fetch_language_cards(language: str,
                         sets_filter: Optional[list[str]] = None) -> tuple[list[CardRecord], FetchReport]:
    """Download full card list for a language via the set endpoints.

    A set that still fails after the transport retries plus one set-level
    retry is REPORTED (FetchReport.failed_sets) instead of being silently
    skipped: the caller decides whether the result may be stamped complete.

    sets_filter: when given (gap-only retry), only those set ids are fetched —
    the sets listing is still consulted so unknown ids are reported, but sets
    that already succeeded in an earlier run are NOT re-downloaded. The DB
    write stays INSERT OR REPLACE, so untouched rows keep their good data.
    """
    code = LANG_CODE.get(language)
    if not code:
        raise ValueError(f"Unsupported language {language}")
    raw = _http_get(f"{TCGDEX_BASE}/{code}/sets?pagination:itemsPerPage=500&pagination:page=1")
    sets = json.loads(raw)
    if not isinstance(sets, list):
        raise RuntimeError(f"Unexpected sets payload for {code}")
    if sets_filter is not None:
        wanted = {s for s in sets_filter if s}
        sets = [sset for sset in sets if sset.get("id") in wanted]
        missing_from_listing = sorted(wanted - {sset.get("id") for sset in sets})
    else:
        missing_from_listing = []
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
            # Coverage: a card WITHOUT a published official scan is still a
            # real, identifiable card — it stays in the catalog as a route-B
            # (OCR/text) candidate with scan_status="not_available" instead
            # of being dropped outright (which made it invisible to any
            # identification). Cards with scans keep the empty status and the
            # visual index keeps working exactly as before.
            usable_image = bool(image) and "/tcgp/" not in image
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
                image_base=image if usable_image else "",
                variants=json.dumps(card.get("variants") or {}, ensure_ascii=False),
                release_date=detail.get("releaseDate") or "",
                scan_status="" if usable_image else "not_available",
            ))
    # A gap-set id that vanished from the listing (set renamed/removed) is a
    # definitive failure for the retry: report it instead of silently success.
    failed.extend(missing_from_listing)
    report = FetchReport(language=language, expected_sets=expected + len(missing_from_listing),
                         succeeded_sets=expected + len(missing_from_listing) - len(failed),
                         failed_sets=failed)
    return records, report


def save_records(conn: sqlite3.Connection, records: Iterable[CardRecord]) -> int:
    count = 0
    with _lock:
        for r in records:
            conn.execute("""INSERT OR REPLACE INTO cards
                (id, language, set_id, set_name, serie_name, serie_id, local_id, name,
                 hp, denominator, image_base, variants, release_date, scan_status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (r.id, r.language, r.set_id, r.set_name, r.serie_name, r.serie_id,
                 r.local_id, r.name, r.hp, r.denominator, r.image_base, r.variants, r.release_date,
                 getattr(r, "scan_status", "")))
            count += 1
        conn.commit()
    return count


def load_cards(conn: sqlite3.Connection, languages: Optional[list[str]] = None) -> list[CardRecord]:
    langs = languages or list(LANGUAGES)
    placeholders = ",".join("?" for _ in langs)
    rows = conn.execute(f"""SELECT id, language, set_id, set_name, serie_name, serie_id,
        local_id, name, hp, denominator, image_base, variants, release_date, scan_status
        FROM cards WHERE language IN ({placeholders}) ORDER BY language, set_id, local_id""", langs).fetchall()
    return [CardRecord(
        id=row[0], language=row[1], set_id=row[2], set_name=row[3], serie_name=row[4],
        serie_id=row[5], local_id=row[6], name=row[7], hp=row[8], denominator=row[9],
        image_base=row[10] or "", variants=row[11] or "{}", release_date=row[12] or "",
        scan_status=row[13] if len(row) > 13 else "",
    ) for row in rows]


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None
