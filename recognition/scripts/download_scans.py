#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Incremental scan synchronizer: download official scans + record sync states.

Usage:
    python scripts/download_scans.py [--languages pt-BR,en,ja] [--workers 12]

State machine (scans table, see recognizer/catalog.SCAN_STATES):
- validated     -> a usable scan sits in the local cache (magic bytes OK,
                   decodes, dimensions plausible, sha256 matches the record).
                   Re-runs SKIP these entirely: zero network, zero re-hashing.
- failed         -> transient/rate-limited failure: retried on the next run.
- not_available  -> no scan published by ANY source (empty image_base AND
                   empty image_alt, or every URL in the chain 404'd). Not
                   retried until the catalog changes (a gap is a catalog
                   fact, not a transport failure).
- corrupt        -> a previously validated file whose bytes no longer match
                   the recorded sha256: the cache entry is DELETED and the
                   scan re-downloaded in the same run (data healing).

Image validation chain (HTTP 200 alone means nothing):
- magic bytes (JPEG/WebP/PNG/GIF) + minimum size (1 KB);
- full decode via PIL.Image.open() with OpenCV fallback;
- minimum dimensions (200x280: a scan downscaled to death is useless for
  SIFT verification);
- sha256 recorded at validation time (later runs detect bit-rot).

Resolution chain per card (see recognizer/catalog.resolve_scan_classified):
TCGdex own language -> EN mirror -> pokemon-tcg-data alt image (hi-res,
then small). The alt image is the LAST resort: it only serves cards with
no TCGdex scan at all, raising visual-index coverage.

Progress reporting includes a rate and an ETA estimate (exponentially
smoothed so a single fast/slow batch does not swing the projection), and the
final summary reports every state so coverage decisions use numbers.
"""
from __future__ import annotations

import argparse
import hashlib
import math
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import (MIN_SCAN_HEIGHT, MIN_SCAN_WIDTH, get_scan_state,
                                init_db, load_cards, record_scan_state,
                                resolve_scan_classified, scan_path,
                                scan_state_counts, _cached_scan_ok,
                                SCAN_QUALITY_CHAIN, _get_db_connection)

# Thread-local database connection for worker threads
_worker_db_local = threading.local()


def _get_worker_db() -> sqlite3.Connection:
    """Get or create thread-local DB connection for worker threads."""
    conn = getattr(_worker_db_local, 'connection', None)
    if conn is None:
        conn = _get_db_connection()
        _worker_db_local.connection = conn
    return conn


def _sync_card_with_semaphore(card, force: bool = False) -> str:
    """Wrapper that acquires the HTTP semaphore before calling sync_card."""
    # resolve_scan_classified now uses the internal semaphore
    return sync_card(card, force=force)


def _fmt_duration(seconds: float) -> str:
    if not math.isfinite(seconds) or seconds < 0:
        return "—"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, sec = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m{sec:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h{minutes:02d}m"


def _sha256_of(path: str) -> str | None:
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as fh:
            for block in iter(lambda: fh.read(1 << 20), b""):
                digest.update(block)
        return digest.hexdigest()
    except OSError:
        return None


def _decode_dimensions(path: str) -> tuple[int, int] | None:
    """Full decode + dimension check. None when the file is not a usable
    image (truncated, zero-dimension, or below the SIFT-useful floor).
    
    Uses PIL.Image.open() FIRST (with img.load() to force decode) for maximum
    format compatibility (WebP with alpha/VP8X, PNG, JPEG, GIF), falling back
    to OpenCV only if PIL fails. This handles WebPs that cv2.imdecode rejects
    in some Linux/Docker environments.
    """
    # Try PIL first — it handles WebP/VP8X, PNG with alpha, and other formats
    # that cv2.imdecode may reject depending on build flags/environment.
    try:
        from PIL import Image
        with Image.open(path) as img:
            img.load()  # Force full decode (catches truncated files)
            width, height = img.size
            if width >= MIN_SCAN_WIDTH and height >= MIN_SCAN_HEIGHT:
                return width, height
    except Exception:
        pass  # Fall through to OpenCV fallback
    
    # Fallback to OpenCV for environments where PIL is unavailable or fails
    import cv2
    import numpy as np
    try:
        data = np.fromfile(path, dtype=np.uint8)  # unicode-safe on Windows
    except OSError:
        return None
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3:
        return None
    height, width = image.shape[:2]
    if width < MIN_SCAN_WIDTH or height < MIN_SCAN_HEIGHT:
        return None
    return width, height


def _resolved_cache_path(image_base: str) -> str | None:
    """First cache path (own language or EN-mirror naming) that validates."""
    for quality in SCAN_QUALITY_CHAIN:
        path = scan_path(image_base, quality)
        if _cached_scan_ok(path):
            return path
        mirror = scan_path(image_base, f"en-{quality}")
        if _cached_scan_ok(mirror):
            return mirror
    return None


def sync_card(card, force: bool = False) -> str:
    """Bring ONE card's scan to a terminal state. Returns the state."""
    # The scan's stable identifier: the TCGdex asset base when there is one,
    # otherwise the second-source URL (never empty — every catalog row with
    # any image possibility must be trackable).
    scan_key = card.image_base or getattr(card, "image_alt", "") or ""
    if not scan_key:
        # No source publishes any image for this card: record once, no network.
        return "not_available"

    recorded = get_scan_state(_conn, scan_key)
    if (not force and recorded is not None and recorded[0] == "validated"
            and len(recorded) > 2 and recorded[2]):
        # Fast path: validated before + sha256 recorded. Verify the local file
        # still matches (detects corruption/bit-rot without re-downloading).
        path = _resolved_cache_path(scan_key) if card.image_base else None
        if path is None and getattr(card, "image_alt", ""):
            from recognizer.catalog import _ptcg_cache_path, PTCGDATA_QUALITY_CHAIN
            for q in PTCGDATA_QUALITY_CHAIN:
                candidate = _ptcg_cache_path(card.image_alt, q)
                if _cached_scan_ok(candidate):
                    path = candidate
                    break
        if path is not None and _sha256_of(path) == recorded[2]:
            return "validated"
        # Corrupt or missing on disk: fall through to a fresh download.

    resolved, reason = resolve_scan_classified(
        card.image_base or None, getattr(card, "image_alt", "") or None)
    if resolved is not None:
        path, source = resolved
        sha = _sha256_of(path)
        dims = _decode_dimensions(path)
        if sha and dims:
            _queue_write(scan_key, "validated", os.path.getsize(path), sha,
                         dims[0], dims[1], source)
            return "validated"
        if sha and not dims:
            # Downloaded file decodes badly / dimensions below the floor:
            # transient-quality image, retry later (maybe the CDN serves a
            # better variant after regeneration).
            _queue_write(scan_key, "failed", None, None)
            return "failed"
        # Unreadable after resolution: transient.
        _queue_write(scan_key, "failed", None, None)
        return "failed"
    if reason == "not-found":
        # Every URL of every source answered 404: a genuine catalog gap.
        _queue_write(scan_key, "not_available", None, None)
        return "not_available"
    _queue_write(scan_key, "failed", None, None)
    return "failed"


def _queue_write(scan_key: str, state: str, nbytes: int | None, sha: str | None,
                 width: int | None = None, height: int | None = None,
                 source: str = "") -> None:
    """Queue a scan state write for batch flush (thread-safe)."""
    # Each worker thread has its own pending_writes list via thread-local storage
    if not hasattr(_worker_db_local, 'pending_writes'):
        _worker_db_local.pending_writes = []
    _worker_db_local.pending_writes.append((scan_key, state, nbytes, sha, width, height, source))


def _flush_worker_writes() -> None:
    """Flush pending writes for the current thread."""
    if not hasattr(_worker_db_local, 'pending_writes'):
        return
    writes = _worker_db_local.pending_writes
    _worker_db_local.pending_writes = []
    conn = _get_worker_db()
    for scan_key, state, nbytes, sha, width, height, source in writes:
        record_scan_state(conn, scan_key, state, nbytes, sha, width, height, source)
    conn.commit()


_conn = None  # set in main(); kept for backwards compatibility


def main() -> None:
    global _conn
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,ja,es")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="re-validate even validated scans")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    _conn = init_db()  # Main thread connection for loading cards and final stats
    cards = load_cards(_conn, languages)
    if args.limit:
        cards = cards[: args.limit]
    with_scan = [c for c in cards if c.image_base]
    alt_only = [c for c in cards if not c.image_base and getattr(c, "image_alt", "")]
    without_scan = len(cards) - len(with_scan) - len(alt_only)
    print(f"[scans] syncing {len(cards)} cards ({len(with_scan)} with primary scans, "
          f"{len(alt_only)} second-source only, {without_scan} without any image) "
          f"using {args.workers} workers")

    counts = {"validated": 0, "failed": 0, "not_available": 0}
    done = 0
    started = time.time()
    smoothed_rate = 0.0

    def work(card):
        # Each worker thread uses its own DB connection via _get_worker_db()
        # resolve_scan_classified uses the internal HTTP semaphore
        return sync_card(card, force=args.force)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, card): card for card in cards}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                state = future.result()
            except Exception:  # noqa: BLE001 — one bad card must not kill the sync
                state = "failed"
            counts[state] = counts.get(state, 0) + 1
            done += 1
            if i % 500 == 0 or i == len(cards):
                elapsed = max(0.001, time.time() - started)
                rate = i / elapsed
                smoothed_rate = rate if smoothed_rate == 0.0 else 0.7 * smoothed_rate + 0.3 * rate
                remaining = (len(cards) - i) / max(0.01, smoothed_rate)
                eta = _fmt_duration(remaining)
                print(f"[scans] {i}/{len(cards)} ok={counts['validated']} "
                      f"failed={counts['failed']} not_available={counts['not_available']} "
                      f"({rate:.1f}/s · ETA {eta})", flush=True)
                # Flush all worker threads' pending writes
                _flush_worker_writes()

    # Final flush of all worker threads
    _flush_worker_writes()
    elapsed = time.time() - started
    print(f"[scans] finished in {elapsed:.1f}s: "
          f"validated={counts['validated']} failed={counts['failed']} "
          f"not_available={counts['not_available']}")
    db_states = scan_state_counts(_conn)
    print(f"[scans] scans table: {db_states}")
    if counts["failed"]:
        print("[scans] failed scans stay marked for retry; a re-run retries ONLY those "
              "(validated scans are served from the local cache with zero network)")


if __name__ == "__main__":
    main()
