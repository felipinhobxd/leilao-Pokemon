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
#   (the pt-BR/en/ja catalog is what identification runs on): a failed core
#   fetch blocks the installer (non-zero exit). JA was promoted to CORE in the
#   2026-09 catalog round: EN + JA + pt-BR is the declared objective, and a
#   silent ja gap would hide every Japanese card from identification.
# - OPTIONAL languages are metadata-only (es): a gap degrades those
#   languages' coverage but must never block installation — the failure is
#   recorded in catalog.gaps.<lang> and a later run retries just the gaps.
CORE_LANGUAGES = ("pt-BR", "en", "ja")
OPTIONAL_LANGUAGES = ("es",)

_lock = threading.RLock()
# RLock (reentrant): the reconciler runs INSIDE the write lock and calls
# record_conflict/save_records helpers that acquire it again — a plain Lock
# deadlocked there. Reentrancy is same-thread only; cross-thread semantics
# (mutual exclusion) are unchanged.

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
    # ---------------------------------------------------------- catalog v2
    # Identity vs printing: each ROW is a printing (language x set x localId x
    # variant); canonical_id drops the language and links the language twins
    # of the same international set (en sv01-025 <-> pt-BR sv01-025).
    canonical_id: str = ""
    # Rarity as published by the source ("Rare", "Illustration Rare", …).
    # Empty when no source provides it — never guessed.
    rarity: str = ""
    # JSON list of subtypes/tags (["Stage 2", "ex"] from pokemon-tcg-data).
    subtypes: str = "[]"
    # Alternate image URL from a SECOND source (pokemon-tcg-data
    # images.pokemontcg.io hi-res). Used by the scan chain as a last-resort
    # backfill when TCGdex publishes no scan for the card: same artwork,
    # independent CDN. Empty when the second source has no image either.
    image_alt: str = ""
    # JSON map of which sources cover this printing + their native ids:
    #   {"tcgdex": {"id": "sv01-025"}, "pokemon-tcg-data": {"number": "25"}}
    sources: str = "{}"


# Scan sync states (scans table): the incremental synchronizer's state machine.
#   validated     -> downloaded (or already cached), magic-bytes OK, sha256 recorded
#   failed        -> transport/transient failure: retry on the next run
#   not_available -> no scan published (empty image_base, or every URL 404'd)
SCAN_STATES = ("validated", "failed", "not_available")

# Sources that may contribute to one catalog row (reconciliation bookkeeping).
SOURCES_TCGDEX = "tcgdex"
SOURCES_PTCGDATA = "pokemon-tcg-data"
SOURCES_LIMITLESS = "limitless"


# Global HTTP concurrency cap: sync workers (12 by default) may QUEUE, but
# only this many requests are ACTIVE against api/assets.tcgdex.net at any
# instant. The 2026-09 sync collapse (10.380 failed / 842s) was Cloudflare
# HTTP 429s from an unthrottled 12-worker fan-out; the semaphore is the
# systemic fix and the backoff schedule below is the safety net.
_HTTP_CONCURRENCY_LIMIT = 5
_HTTP_SEMAPHORE = threading.Semaphore(_HTTP_CONCURRENCY_LIMIT)

# Exponential backoff between attempts (seconds): 5 -> 15 -> 45 -> 120
# (max 4 attempts by default). Sleeps happen OUTSIDE the semaphore so a
# rate-limited URL never stalls the other workers' active slots.
_HTTP_BACKOFF_SECONDS = (5.0, 15.0, 45.0, 120.0)


def _backoff_for(attempt: int) -> float:
    return _HTTP_BACKOFF_SECONDS[min(attempt, len(_HTTP_BACKOFF_SECONDS) - 1)]


def _http_get(url: str, timeout: float = 30.0, retries: int = 4,
              headers: Optional[dict] = None, params: Optional[dict] = None) -> bytes:
    """Fetch with failure-class-aware retries under a global concurrency cap.

    - 200            -> payload;
    - 404            -> FileNotFoundError immediately (definitive, never retried);
    - 429/503        -> Retry-After honored when short (<=120s, logged);
                        otherwise the exponential schedule 5s/15s/45s/120s
                        applies; a longer server demand raises HttpRateLimited
                        so callers back off instead of hammering;
    - other 5xx      -> same exponential backoff with jitter, bounded retries;
    - timeout/conn   -> bounded retries with the same backoff;
    - other 4xx      -> surfaced as RuntimeError after the bounded retries.

    headers/params are passed through to the session request (used by the
    Limitless API for X-Api-Key auth and set filters).
    """
    host = url.split("/")[2] if "://" in url else url
    last = None
    for attempt in range(retries):
        try:
            with _HTTP_SEMAPHORE:
                resp = _get_session().get(url, timeout=timeout,
                                          headers=headers, params=params)
            if resp.status_code == 200:
                return resp.content
            if resp.status_code == 404:
                raise FileNotFoundError(url)
            if resp.status_code in (429, 503):
                retry_after = _parse_retry_after(resp)
                if attempt + 1 >= retries or (retry_after or 0.0) > 120.0:
                    raise HttpRateLimited(url, retry_after)
                # honor the server's Retry-After; fall back to the
                # exponential schedule when the header is absent
                wait = retry_after if retry_after is not None else _backoff_for(attempt)
                reason = f"Retry-After: {retry_after}" if retry_after is not None \
                    else "backoff exponencial"
                print(f"[http] rate limit ({resp.status_code}) em {host}: "
                      f"aguardando {min(wait, 120.0):.0f}s ({reason})", flush=True)
                time.sleep(min(wait, 120.0))
                last = HttpRateLimited(url, retry_after)
                continue
            last = RuntimeError(f"HTTP {resp.status_code} for {url}")
        except (FileNotFoundError, HttpRateLimited):
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
        time.sleep(_backoff_for(attempt) + random.uniform(0.0, 1.0))
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
# The floor is low on purpose: perfectly valid PNGs/WebPs of simple cards
# (basic Energy, old Trainers) compress below 4 KB, and rejecting them
# marked real cards as `failed` in the 2026-09 sync. Magic bytes are the
# actual gate against CDN HTML error pages; the byte floor only filters
# empty/1-pixel stubs.
_MIN_SCAN_BYTES = 1024


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
    an image (>= 1 KB + magic bytes). The CDN returns HTTP 200 + HTML for some
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


# ---------------------------------------------------------------------------
# pokemon-tcg-data image backfill (second source, last resort).
# images.pokemontcg.io serves <set>/<number>.png (~240x330) and
# <set>/<number>_hires.png (~600x825+). The hi-res variant is the one worth
# indexing; the small one is accepted only as a final fallback so a card with
# no TCGdex scan at all still enters the visual index (a 240 px scan verifies
# worse than a 600 px one, but it beats "invisible").
PTCGDATA_IMAGE_BASE = "https://images.pokemontcg.io"
PTCGDATA_QUALITY_CHAIN = ("hires", "small")


def _ptcg_url(alt_url: str, quality: str) -> Optional[str]:
    """Derive the fetch URL for a quality variant of a pokemon-tcg-data image.

    alt_url is stored in the DB as the HI-RES url (.../<set>/<n>_hires.png);
    the small variant is the same path without the _hires suffix."""
    if not alt_url:
        return None
    dot = alt_url.rfind(".")
    suffix = alt_url[dot:] if dot > alt_url.rfind("/") else ".png"
    if "_hires" in alt_url:
        stem = alt_url[: alt_url.index("_hires")]
        return alt_url if quality == "hires" else f"{stem}{suffix}"
    # stored as the plain (small) url: hi-res is the derived one
    if quality == "small":
        return alt_url
    return f"{alt_url[:dot]}_hires{suffix}" if dot > 0 else None


def _ptcg_cache_path(alt_url: str, quality: str) -> str:
    """Local cache path for a second-source image (own namespace, never
    colliding with the TCGdex asset cache)."""
    tail = alt_url[len(PTCGDATA_IMAGE_BASE):].strip("/") if alt_url.startswith(PTCGDATA_IMAGE_BASE) else alt_url.strip("/").replace("/", "_")
    stem, dot = tail[: tail.rfind(".")], tail[tail.rfind("."):]
    return os.path.join(IMAGE_CACHE_DIR, "ptcg", f"{stem}.{quality}{dot}")


def _cache_ptcg(alt_url: str, quality: str, data: bytes) -> str:
    path = _ptcg_cache_path(alt_url, quality)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return path


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


def resolve_scan_classified(image_base: Optional[str],
                            alt_url: Optional[str] = None) -> tuple[Optional[tuple[str, str]], str]:
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

    alt_url: SECOND-SOURCE image (pokemon-tcg-data hi-res, same artwork)
    consulted only after the whole TCGdex chain (own language + EN mirror)
    failed. A card with no TCGdex scan at all still gets a usable image —
    this is what raises visual-index coverage instead of silently dropping
    scanless cards.
    """
    if not image_base and not alt_url:
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
    if image_base:
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
    # 5. second-source backfill (pokemon-tcg-data image, same artwork):
    #    cache first, then download hires -> small. The small variant is
    #    accepted so scanless cards still enter the visual index.
    if alt_url:
        for q in PTCGDATA_QUALITY_CHAIN:
            cached = _ptcg_cache_path(alt_url, q)
            if _cached_scan_ok(cached):
                return (cached, f"ptcg-{q}"), "ok"
            elif os.path.exists(cached):
                _invalidate_cache(cached)
        for q in PTCGDATA_QUALITY_CHAIN:
            url = _ptcg_url(alt_url, q)
            if not url:
                continue
            try:
                data = _http_get(url, timeout=25.0)
            except Exception as exc:  # noqa: BLE001
                _note(exc)
                continue
            if not _looks_like_image(data):
                saw_transient = True
                continue
            return (_cache_ptcg(alt_url, q, data), f"ptcg-{q}"), "ok"
    return None, _finish_fail()


def resolve_scan(image_base: Optional[str],
                 alt_url: Optional[str] = None) -> Optional[tuple[str, str]]:
    """Resolve a usable scan for an asset base.

    Returns (local_path, source) with source in
    {"high.webp", "low.webp", "en-high.webp", "en-low.webp",
     "ptcg-hires", "ptcg-small"}, or None.
    See resolve_scan_classified() for the failure reason variant used by the
    pipeline's negative cache.

    Order (cache-first, zero network on the hot path):
      1. own-language cache (validated by magic bytes; corrupt entries are
         removed and treated as misses)
      2. EN-mirror cache
      3. own-language download (high -> low)
      4. EN-mirror download (same artwork, same local id in mirrored sets)
      5. second-source image (pokemon-tcg-data, alt_url): cache then download
    Every download is validated by magic bytes so HTML error pages never
    enter the cache.
    """
    return resolve_scan_classified(image_base, alt_url)[0]


def ensure_scan(image_base: str, quality: str = "high.webp",
                alt_url: Optional[str] = None) -> Optional[str]:
    """Download-once local cache for an official scan. Returns local path or None.

    See resolve_scan() for the full resolution chain (quality fallback + EN
    mirror + second-source backfill + magic-byte validation on downloads AND
    cache hits).
    """
    resolved = resolve_scan(image_base, alt_url)
    return resolved[0] if resolved is not None else None


# Minimum plausible dimensions for a card scan (a 600x840 scan downscaled to
# death is useless for SIFT; anything below this is rejected at sync time).
MIN_SCAN_WIDTH = 200
MIN_SCAN_HEIGHT = 280


def init_db(db_path: str = CATALOG_DB) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    # Cross-connection contention WAITS instead of raising
    # "database is locked": mandatory now that sync workers each hold
    # their own connection (thread-local). WAL still allows only one
    # writer at a time — busy_timeout makes the others queue politely.
    conn.execute("PRAGMA busy_timeout=5000")
    # Schema work (tables, migrations, backfills) stays under the RLock:
    # a worker calling init_db() for its thread-local connection must
    # never race another thread's migration. Data reads/writes do NOT
    # take the lock (per-thread connections + busy_timeout handle them).
    with _lock:
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
        rarity TEXT NOT NULL DEFAULT '',
        subtypes TEXT NOT NULL DEFAULT '[]',
        canonical_id TEXT NOT NULL DEFAULT '',
        image_alt TEXT NOT NULL DEFAULT '',
        sources TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (id, language)
    )""")
        # Migrations for catalogs built before each column existed (additive:
        # never touches good rows, works on the user's existing cards.sqlite).
        columns = {row[1] for row in conn.execute("PRAGMA table_info(cards)")}
        if "scan_status" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN scan_status TEXT NOT NULL DEFAULT ''")
        if "rarity" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN rarity TEXT NOT NULL DEFAULT ''")
        if "subtypes" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN subtypes TEXT NOT NULL DEFAULT '[]'")
        if "canonical_id" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN canonical_id TEXT NOT NULL DEFAULT ''")
        if "image_alt" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN image_alt TEXT NOT NULL DEFAULT ''")
        if "sources" not in columns:
            conn.execute("ALTER TABLE cards ADD COLUMN sources TEXT NOT NULL DEFAULT '{}'")
        # Existing catalogs predate identity: backfill canonical_id from
        # (set_id, local_id) once, in SQL (fast, idempotent). The EXISTS
        # guard keeps the COMMON case (nothing to backfill) read-only — a
        # write transaction left open here was the real 'database is locked'
        # under 12 concurrent init_db() calls (each connection would hold
        # its own uncommitted write lock until the caller's first commit).
        if conn.execute("SELECT EXISTS(SELECT 1 FROM cards WHERE canonical_id = '')").fetchone()[0]:
            conn.execute("""UPDATE cards SET canonical_id = set_id || '|' || local_id
                            WHERE canonical_id = ''""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_lang ON cards(language)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_canonical ON cards(canonical_id)")
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
        scan_columns = {row[1] for row in conn.execute("PRAGMA table_info(scans)")}
        if "width" not in scan_columns:
            conn.execute("ALTER TABLE scans ADD COLUMN width INTEGER")
        if "height" not in scan_columns:
            conn.execute("ALTER TABLE scans ADD COLUMN height INTEGER")
        if "source" not in scan_columns:
            conn.execute("ALTER TABLE scans ADD COLUMN source TEXT NOT NULL DEFAULT ''")
        # Multi-source reconciliation ledger: one row per disputed FIELD.
        # Nothing is ever overwritten silently — every cross-source disagreement
        # lands here with both values and the deterministic resolution applied.
        conn.execute("""CREATE TABLE IF NOT EXISTS conflicts (
        language TEXT NOT NULL,
        card_key TEXT NOT NULL,
        source_a TEXT NOT NULL,
        source_b TEXT NOT NULL,
        field TEXT NOT NULL,
        value_a TEXT,
        value_b TEXT,
        resolution TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (language, card_key, field)
    )""")
        conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        # NEVER return with an open write transaction: each thread-local
        # connection would hold its own uncommitted write lock (see the
        # backfill note above) and block every other connection forever.
        conn.commit()
    return conn


def record_scan_state(conn: sqlite3.Connection, image_base: str, state: str,
                       nbytes: Optional[int] = None, sha256: Optional[str] = None,
                       width: Optional[int] = None, height: Optional[int] = None,
                       source: str = "") -> None:
    """Persist the sync state of one scan (see SCAN_STATES).

    image_base is the scan's stable identifier: the TCGdex asset base, or
    (for second-source images) the pokemon-tcg-data URL itself. width/height
    are recorded at validation time (decode + dimension check); source is
    which chain step resolved ("high.webp", "ptcg-hires", …).

    No process-wide lock here: callers use per-thread connections (WAL +
    busy_timeout serialize writers natively) and the common sync write path
    is batched through a single flush thread anyway. The RLock stays for
    schema work (init_db) and the reconciler's batch paths.
    """
    if state not in SCAN_STATES:
        raise ValueError(f"Unknown scan state {state!r}")
    conn.execute("""INSERT OR REPLACE INTO scans (image_base, state, bytes, sha256, width, height, source, updated_at)
        VALUES (?,?,?,?,?,?,?,?)""",
        (image_base, state, nbytes, sha256, width, height, source,
         time.strftime("%Y-%m-%dT%H:%M:%S")))
    conn.commit()


def get_scan_state(conn: sqlite3.Connection, image_base: str) -> Optional[tuple]:
    """(state, bytes, sha256, source) recorded for an asset base, if any.

    source carries which chain step resolved a validated row ("high.webp",
    "ptcg-hires", …) and, for not_available rows, the URL-scope fingerprint
    the absence verdict covers (see download_scans._na_scope).

    The cursor is explicitly closed BEFORE any write happens on the same
    connection: an unclosed single-row SELECT keeps the statement (and its
    read snapshot) alive, and a read->write transaction upgrade is the one
    SQLite path that does NOT honor busy_timeout — that was the real
    'database is locked' under 12 workers."""
    cur = conn.execute("SELECT state, bytes, sha256, source FROM scans WHERE image_base = ?", (image_base,))
    try:
        row = cur.fetchone()
    finally:
        cur.close()
    return tuple(row) if row else None


def scan_state_counts(conn: sqlite3.Connection) -> dict[str, int]:
    """Rows per scan state (sync reporting: downloaded/failed/not_available)."""
    cur = conn.execute("SELECT state, COUNT(*) FROM scans GROUP BY state")
    try:
        rows = cur.fetchall()
    finally:
        cur.close()
    return dict(rows)


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


def fetch_sets_listing(language: str) -> list[dict]:
    """Dynamic discovery: the CURRENT sets listing for a language (1 request).

    This is what makes new expansions findable without code changes: the
    listing is re-read on every catalog run and diffed against the stored
    per-set census (see build_catalog). No set ids are hardcoded anywhere.
    """
    code = LANG_CODE.get(language)
    if not code:
        raise ValueError(f"Unsupported language {language}")
    raw = _http_get(f"{TCGDEX_BASE}/{code}/sets?pagination:itemsPerPage=500&pagination:page=1")
    sets = json.loads(raw)
    if not isinstance(sets, list):
        raise RuntimeError(f"Unexpected sets payload for {code}")
    return sets


def sets_census(listing: list[dict]) -> dict[str, dict]:
    """Per-set card counts from a listing (the incremental-sync diff basis)."""
    census = {}
    for sset in listing:
        set_id = sset.get("id")
        if not set_id:
            continue
        counts = sset.get("cardCount") or {}
        census[set_id] = {"total": int(counts.get("total") or 0),
                          "official": int(counts.get("official") or 0)}
    return census


def fetch_language_cards(language: str,
                         sets_filter: Optional[list[str]] = None) -> tuple[list[CardRecord], FetchReport]:
    """Download full card list for a language via the set endpoints.

    A set that still fails after the transport retries plus one set-level
    retry is REPORTED (FetchReport.failed_sets) instead of being silently
    skipped: the caller decides whether the result may be stamped complete.

    sets_filter: when given (gap-only retry or incremental sync), only those
    set ids are fetched — the sets listing is still consulted so unknown ids
    are reported, but sets that already succeeded in an earlier run are NOT
    re-downloaded. The DB write stays INSERT OR REPLACE, so untouched rows
    keep their good data.

    Every record carries its identity (canonical_id = set|localId, links
    language twins of international sets) and its source bookkeeping.
    """
    code = LANG_CODE.get(language)
    if not code:
        raise ValueError(f"Unsupported language {language}")
    sets = fetch_sets_listing(language)
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
            local_id = str(card.get("localId") or "")
            records.append(CardRecord(
                id=card["id"],
                language=language,
                set_id=set_id,
                set_name=detail.get("name") or set_id,
                serie_name=serie.get("name") or "",
                serie_id=serie.get("id") or "",
                local_id=local_id,
                name=card.get("name") or "",
                hp=int(card["hp"]) if isinstance(card.get("hp"), int) else None,
                denominator=int(denominator) if denominator else None,
                image_base=image if usable_image else "",
                variants=json.dumps(card.get("variants") or {}, ensure_ascii=False),
                release_date=detail.get("releaseDate") or "",
                scan_status="" if usable_image else "not_available",
                canonical_id=f"{set_id}|{local_id}",
                sources=json.dumps({SOURCES_TCGDEX: {"id": card["id"]}}, ensure_ascii=False),
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
                 hp, denominator, image_base, variants, release_date, scan_status,
                 rarity, subtypes, canonical_id, image_alt, sources)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (r.id, r.language, r.set_id, r.set_name, r.serie_name, r.serie_id,
                 r.local_id, r.name, r.hp, r.denominator, r.image_base, r.variants, r.release_date,
                 getattr(r, "scan_status", ""),
                 getattr(r, "rarity", ""), getattr(r, "subtypes", "[]"),
                 getattr(r, "canonical_id", "") or f"{r.set_id}|{r.local_id}",
                 getattr(r, "image_alt", ""), getattr(r, "sources", "{}")))
            count += 1
        conn.commit()
    return count


_CARD_COLUMNS = """id, language, set_id, set_name, serie_name, serie_id,
    local_id, name, hp, denominator, image_base, variants, release_date, scan_status,
    rarity, subtypes, canonical_id, image_alt, sources"""


def load_cards(conn: sqlite3.Connection, languages: Optional[list[str]] = None) -> list[CardRecord]:
    langs = languages or list(LANGUAGES)
    placeholders = ",".join("?" for _ in langs)
    rows = conn.execute(f"""SELECT {_CARD_COLUMNS}
        FROM cards WHERE language IN ({placeholders}) ORDER BY language, set_id, local_id""", langs).fetchall()
    return [_record_from_row(row) for row in rows]


def _record_from_row(row: tuple) -> CardRecord:
    """Build a CardRecord from a SELECT of _CARD_COLUMNS (old schemas that
    lack the v2 columns are tolerated via len checks)."""
    def _at(index: int, default):
        return row[index] if len(row) > index and row[index] is not None else default
    return CardRecord(
        id=row[0], language=row[1], set_id=row[2], set_name=_at(3, ""), serie_name=_at(4, ""),
        serie_id=_at(5, ""), local_id=row[6], name=row[7], hp=row[8], denominator=row[9],
        image_base=_at(10, ""), variants=_at(11, "{}"), release_date=_at(12, ""),
        scan_status=_at(13, ""),
        rarity=_at(14, ""), subtypes=_at(15, "[]"),
        canonical_id=_at(16, "") or (f"{row[2]}|{row[6]}" if len(row) > 6 else ""),
        image_alt=_at(17, ""), sources=_at(18, "{}"),
    )


def record_conflict(conn: sqlite3.Connection, language: str, card_key: str,
                    source_a: str, source_b: str, field: str,
                    value_a, value_b, resolution: str) -> None:
    """Ledger one cross-source disagreement (never a silent overwrite)."""
    with _lock:
        conn.execute("""INSERT OR REPLACE INTO conflicts
            (language, card_key, source_a, source_b, field, value_a, value_b, resolution, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (language, card_key, source_a, source_b, field,
             str(value_a) if value_a is not None else None,
             str(value_b) if value_b is not None else None,
             resolution, time.strftime("%Y-%m-%dT%H:%M:%S")))
        conn.commit()


def conflict_counts(conn: sqlite3.Connection, language: Optional[str] = None) -> dict:
    """Conflicts per language (or total per field) for coverage reporting."""
    if language:
        rows = conn.execute("SELECT field, COUNT(*) FROM conflicts WHERE language=? GROUP BY field",
                            (language,)).fetchall()
    else:
        rows = conn.execute("SELECT language, COUNT(*) FROM conflicts GROUP BY language").fetchall()
    return dict(rows)


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> Optional[str]:
    cur = conn.execute("SELECT value FROM meta WHERE key = ?", (key,))
    try:
        row = cur.fetchone()
    finally:
        cur.close()
    return row[0] if row else None
