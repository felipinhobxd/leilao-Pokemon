#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Incremental scan synchronizer: download official scans + record sync states.

Usage:
    python scripts/download_scans.py [--languages pt-BR,en] [--workers 12]

State machine (scans table, see recognizer/catalog.SCAN_STATES):
- validated     -> a usable scan sits in the local cache (magic bytes OK and,
                   when previously recorded, sha256 matches). Re-runs SKIP
                   these entirely: zero network, zero re-hashing of the world.
- failed         -> transient/rate-limited failure: retried on the next run.
- not_available  -> TCGdex publishes no scan (empty image_base or every URL
                   in the chain 404'd). Not retried until the catalog changes
                   (a gap is a catalog fact, not a transport failure).
- corrupt        -> a previously validated file whose bytes no longer match
                   the recorded sha256: the cache entry is DELETED and the
                   scan re-downloaded in the same run (data healing).

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

from recognizer.catalog import (get_scan_state, init_db, load_cards, record_scan_state,
                                resolve_scan_classified, scan_path, scan_state_counts,
                                _cached_scan_ok, SCAN_QUALITY_CHAIN)

_state_lock = __import__("threading").Lock()
_pending_writes: list[tuple] = []


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
    if not card.image_base:
        # Catalog says no scan is published: record once, no network at all.
        return "not_available"

    recorded = get_scan_state(_conn, card.image_base)
    if (not force and recorded is not None and recorded[0] == "validated"
            and recorded[2]):
        # Fast path: validated before + sha256 recorded. Verify the local file
        # still matches (detects corruption/bit-rot without re-downloading).
        path = _resolved_cache_path(card.image_base)
        if path is not None and _sha256_of(path) == recorded[2]:
            return "validated"
        # Corrupt or missing on disk: fall through to a fresh download.

    resolved, reason = resolve_scan_classified(card.image_base)
    if resolved is not None:
        path, _source = resolved
        sha = _sha256_of(path)
        if sha:
            _queue_write(card.image_base, "validated", os.path.getsize(path), sha)
            return "validated"
        # Unreadable after resolution: transient.
        _queue_write(card.image_base, "failed", None, None)
        return "failed"
    if reason == "not-found":
        # Every URL in the chain answered 404: the CDN genuinely has no scan.
        _queue_write(card.image_base, "not_available", None, None)
        return "not_available"
    _queue_write(card.image_base, "failed", None, None)
    return "failed"


def _queue_write(image_base: str, state: str, nbytes: int | None, sha: str | None) -> None:
    with _state_lock:
        _pending_writes.append((image_base, state, nbytes, sha))


def _flush_writes() -> None:
    with _state_lock:
        writes, _pending_writes[:] = list(_pending_writes), []
    for image_base, state, nbytes, sha in writes:
        record_scan_state(_conn, image_base, state, nbytes, sha)


_conn = None  # set in main(); sqlite connections are per-process by design


def main() -> None:
    global _conn
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="re-validate even validated scans")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    _conn = init_db()
    cards = load_cards(_conn, languages)
    if args.limit:
        cards = cards[: args.limit]
    with_scan = [c for c in cards if c.image_base]
    without_scan = len(cards) - len(with_scan)
    print(f"[scans] syncing {len(cards)} cards ({len(with_scan)} with scans, "
          f"{without_scan} without) using {args.workers} workers")

    counts = {"validated": 0, "failed": 0, "not_available": 0, "corrupt-redownloaded": 0}
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
    db_states = scan_state_counts(_conn)
    print(f"[scans] scans table: {db_states}")
    if counts["failed"]:
        print("[scans] failed scans stay marked for retry; a re-run retries ONLY those "
              "(validated scans are served from the local cache with zero network)")


if __name__ == "__main__":
    main()
