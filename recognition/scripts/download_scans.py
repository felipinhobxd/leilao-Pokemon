#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Incremental scan synchronizer: download official scans + record sync states.

Usage:
    python scripts/download_scans.py [--languages pt-BR,en,ja] [--workers 12]

State machine (scans table, see recognizer/catalog.SCAN_STATES):
- validated     -> a usable scan sits in the local cache (magic bytes OK,
                    decodes, dimensions plausible, sha256 matches the record).
                    Re-runs SKIP these entirely: zero network, zero re-hashing
                    (only the sha256 of the cached file is re-verified).
- failed         -> transient/rate-limited failure: retried on the next run.
- not_available  -> no scan published by ANY source (empty image_base AND
                    empty image_alt, or every URL in the chain 404'd). Not
                    retried while the card's URL scope is unchanged (a gap is
                    a catalog fact, not a transport failure); re-probed when
                    the scope changes (a new source backfills image_alt) or
                    with --force.
- corrupt        -> a previously validated file whose bytes no longer match
                    the recorded sha256: the cache entry is DELETED and the
                    scan re-downloaded in the same run (data healing).

Image validation chain (HTTP 200 alone means nothing):
- magic bytes (JPEG/WebP/PNG/GIF) + minimum size (1 KB — valid PNGs/WebPs
  of simple cards compress below 4 KB);
- full decode, Pillow first (img.load() forces the decode), OpenCV as the
  fallback: WebP with alpha/VP8X and GIF decode reliably in Pillow on every
  environment, while some OpenCV builds (Linux/Docker) fail there — that
  marked real scans as `failed` in the 2026-09 sync;
- minimum dimensions (200x280: a scan downscaled to death is useless for
  SIFT verification);
- sha256 recorded at validation time (later runs detect bit-rot).

HTTP behavior: every request goes through recognizer.catalog._http_get,
which (since the 429 storm of the 2026-09 sync) enforces a global
threading.Semaphore(5) — 12 workers may queue, but only 5 requests are
active against api/assets.tcgdex.net at any instant — and retries with the
exponential backoff 5s/15s/45s/120s, honoring the server's Retry-After on
429/503 (rate-limit events are logged as `[http] rate limit …`).

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
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import (MIN_SCAN_HEIGHT, MIN_SCAN_WIDTH, get_scan_state,
                                init_db, load_cards, record_scan_state,
                                record_validated_mtime, resolve_scan_classified,
                                scan_path, scan_state_counts, _cached_scan_ok,
                                SCAN_QUALITY_CHAIN)

_state_lock = __import__("threading").Lock()
_tls = __import__("threading").local()
_pending_writes: list[tuple] = []
_pending_mtime_patches: list[tuple] = []


def _thread_conn():
    """Per-thread SQLite connection (thread-local): the 12 sync workers read
    scan states concurrently while WAL + busy_timeout serialize the writes.
    The old single shared connection (check_same_thread=False) was the
    'database is locked' factory under 12-way load (Fase 4.1). The main
    thread uses the same helper — load_cards/_flush_writes share its
    connection, so batched writes stay on one thread as before."""
    conn = getattr(_tls, "conn", None)
    if conn is None:
        conn = _tls.conn = init_db()
    return conn


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


def _decode_with_pillow(path: str) -> tuple[int, int] | None:
    """Pillow decode (WebP alpha/VP8X + GIF reliable on every platform).

    img.load() forces a FULL decode: a truncated file raises here instead of
    passing silently. Returns None when Pillow is absent or rejects the file
    (the OpenCV fallback then gets its chance).
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as img:
            img.load()
            width, height = img.size
        return int(width), int(height)
    except Exception:  # noqa: BLE001 — not decodable by Pillow
        return None


def _decode_with_opencv(path: str) -> tuple[int, int] | None:
    """OpenCV fallback decode (CI light environment ships no Pillow)."""
    try:
        import cv2
        import numpy as np
        data = np.fromfile(path, dtype=np.uint8)  # unicode-safe on Windows
        image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    except Exception:  # noqa: BLE001
        return None
    if image is None or image.ndim < 2:
        return None
    height, width = image.shape[:2]
    return int(width), int(height)


def _decode_dimensions(path: str) -> tuple[int, int] | None:
    """Full decode + dimension check. None when the file is not a usable
    image (truncated, zero-dimension, or below the SIFT-useful floor).

    Pillow decodes FIRST: WebP with an alpha/VP8X chunk and GIFs decode
    reliably there on every environment, while some OpenCV builds
    (Linux/Docker) fail exactly there — the 2026-09 sync marked real scans
    as `failed` for that reason. OpenCV stays as the fallback (and vice
    versa): a scan is only rejected when BOTH decoders reject it or its
    dimensions sit below the floor. WebP, JPEG, PNG and GIF are treated
    equally.
    """
    for decoder in (_decode_with_pillow, _decode_with_opencv):
        dims = decoder(path)
        if dims is not None:
            width, height = dims
            if not width or not height:
                return None
            if width < MIN_SCAN_WIDTH or height < MIN_SCAN_HEIGHT:
                return None
            return width, height
    return None


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


def _na_scope(card) -> str:
    """URL-scope fingerprint recorded with not_available rows: every URL the
    resolution chain consults for this card (own scan + second source). If a
    later catalog run CHANGES the scope (e.g. a new source backfills
    image_alt on a scanless card), the cached absence verdict no longer
    applies and the card is retried even without --force."""
    return "|".join((card.image_base or "", getattr(card, "image_alt", "") or ""))


def sync_card(card, force: bool = False) -> str:
    """Bring ONE card's scan to a terminal state. Returns the state."""
    # The scan's stable identifier: the TCGdex asset base when there is one,
    # otherwise the second-source URL (never empty — every catalog row with
    # any image possibility must be trackable).
    scan_key = card.image_base or getattr(card, "image_alt", "") or ""
    if not scan_key:
        # No source publishes any image for this card: record once, no network.
        return "not_available"

    recorded = get_scan_state(_thread_conn(), scan_key)
    recorded_mtime = recorded[5] if recorded is not None and len(recorded) > 5 else None
    if (not force and recorded is not None and recorded[0] == "validated"
            and len(recorded) > 2 and recorded[2]):
        # Fast path: validated before + sha256 recorded. The EXACT cache file
        # is derived from the recorded `source` (which quality/chain step
        # validated it) — one stat per card instead of probing the whole
        # quality chain; the probe chain remains as the fallback when the
        # derived path misses (row migrated from another layout etc.).
        path = None
        source_recorded = str(recorded[3] or "")
        if card.image_base and source_recorded:
            if source_recorded.startswith("ptcg-") and getattr(card, "image_alt", ""):
                from recognizer.catalog import _ptcg_cache_path
                quality = source_recorded[len("ptcg-"):]
                candidate = _ptcg_cache_path(card.image_alt, quality)
                if os.path.exists(candidate):
                    path = candidate
            else:
                candidate = scan_path(card.image_base, source_recorded)
                if os.path.exists(candidate):
                    path = candidate
        if path is None:
            path = _resolved_cache_path(scan_key) if card.image_base else None
            if path is None and getattr(card, "image_alt", ""):
                from recognizer.catalog import _ptcg_cache_path, PTCGDATA_QUALITY_CHAIN
                for q in PTCGDATA_QUALITY_CHAIN:
                    candidate = _ptcg_cache_path(card.image_alt, q)
                    if _cached_scan_ok(candidate):
                        path = candidate
                        break
        if path is not None:
            try:
                stat = os.stat(path)
            except OSError:
                stat = None
            # Stat-only skip: same file size + same mtime the recorded sha256
            # covers -> the bytes are unchanged, NO re-hash needed. This is
            # what makes a re-run over ~50k scans finish in seconds instead
            # of re-hashing gigabytes; any size/mtime change falls through
            # to the full sha verification (healing preserved).
            if (stat is not None and recorded_mtime is not None
                    and stat.st_size == recorded[1]
                    and int(stat.st_mtime) == recorded_mtime):
                return "validated"
            if stat is not None and _sha256_of(path) == recorded[2]:
                if recorded_mtime is None or stat.st_size != recorded[1]:
                    # legacy row (or size drift): backfill the mtime key so
                    # the NEXT run is stat-only (self-healing, one-time).
                    # Targeted UPDATE — a full row replace would blank
                    # width/height/source.
                    _queue_mtime_patch(scan_key, int(stat.st_mtime), stat.st_size)
                return "validated"
        # Corrupt or missing on disk: fall through to a fresh download.
    if (not force and recorded is not None and recorded[0] == "not_available"
            and len(recorded) > 3 and recorded[3]
            and recorded[3] == _na_scope(card)):
        # Fast path: this exact URL scope was proven absent on every source
        # in an earlier run (all URLs 404'd). not_available is a catalog
        # fact, not a transport failure — re-probe only when the scope
        # changes (a new source gained an image URL) or with --force.
        # Legacy rows without a recorded scope fall through once and are
        # re-marked WITH the scope (self-healing).
        return "not_available"

    resolved, reason = resolve_scan_classified(
        card.image_base or None, getattr(card, "image_alt", "") or None)
    if resolved is not None:
        path, source = resolved
        sha = _sha256_of(path)
        dims = _decode_dimensions(path)
        if sha and dims:
            _queue_write(scan_key, "validated", os.path.getsize(path), sha,
                         dims[0], dims[1], source,
                         validated_mtime=int(os.path.getmtime(path)))
            return "validated"
        if sha and not dims:
            # Downloaded/cached file decodes badly / dimensions below the
            # floor: transient-quality image, retry later (maybe the CDN
            # serves a better variant after regeneration). The file is
            # DELETED first: the cache-hit validator (magic + size) would
            # keep serving the same broken bytes back on every later run
            # and the card would never heal.
            from recognizer.catalog import _invalidate_cache
            _invalidate_cache(path)
            _queue_write(scan_key, "failed", None, None)
            return "failed"
        # Unreadable after resolution: transient.
        _queue_write(scan_key, "failed", None, None)
        return "failed"
    if reason == "not-found":
        # Every URL of every source answered 404: a genuine catalog gap.
        _queue_write(scan_key, "not_available", None, None,
                     source=_na_scope(card))
        return "not_available"
    _queue_write(scan_key, "failed", None, None)
    return "failed"


def _queue_write(scan_key: str, state: str, nbytes: int | None, sha: str | None,
                 width: int | None = None, height: int | None = None,
                 source: str = "", validated_mtime: int | None = None) -> None:
    with _state_lock:
        _pending_writes.append((scan_key, state, nbytes, sha, width, height, source, validated_mtime))


def _queue_mtime_patch(scan_key: str, mtime: int, nbytes: int | None) -> None:
    """Backfill the stat-only re-run key on an already-validated row WITHOUT
    touching width/height/source (a full row replace would blank them)."""
    with _state_lock:
        _pending_mtime_patches.append((scan_key, mtime, nbytes))


def _flush_writes() -> None:
    with _state_lock:
        writes, _pending_writes[:] = list(_pending_writes), []
        patches, _pending_mtime_patches[:] = list(_pending_mtime_patches), []
    for scan_key, state, nbytes, sha, width, height, source, validated_mtime in writes:
        record_scan_state(_thread_conn(), scan_key, state, nbytes, sha, width, height,
                          source, validated_mtime)
    for scan_key, mtime, nbytes in patches:
        record_validated_mtime(_thread_conn(), scan_key, mtime, nbytes)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,ja,es")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="re-validate even validated scans")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    cards = load_cards(_thread_conn(), languages)
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
                _flush_writes()

    _flush_writes()
    elapsed = time.time() - started
    print(f"[scans] finished in {elapsed:.1f}s: "
          f"validated={counts['validated']} failed={counts['failed']} "
          f"not_available={counts['not_available']}")
    db_states = scan_state_counts(_thread_conn())
    print(f"[scans] scans table: {db_states}")
    if counts["failed"]:
        print("[scans] failed scans stay marked for retry; a re-run retries ONLY those "
              "(validated scans are served from the local cache with zero network)")


if __name__ == "__main__":
    main()
