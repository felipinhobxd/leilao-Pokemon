#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download official scans (high.webp) into the local image cache.

Usage:
    python scripts/download_scans.py [--languages pt-BR,en] [--workers 12]

Progress reporting includes a rate and an ETA estimate (exponentially
smoothed so a single fast/slow batch does not swing the projection), and
failures are summarized at the end for a targeted re-run.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import ensure_scan, init_db, load_cards


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    cards = load_cards(conn, languages)
    if args.limit:
        cards = cards[: args.limit]
    print(f"[scans] downloading {len(cards)} scans with {args.workers} workers")

    done = failed = 0
    started = time.time()
    # Exponentially smoothed rate: robust ETA that tolerates CDN bursts.
    smoothed_rate = 0.0

    def work(card):
        path = ensure_scan(card.image_base, "high.webp")
        return path is not None

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, card): card for card in cards}
        for i, future in enumerate(as_completed(futures), 1):
            if future.result():
                done += 1
            else:
                failed += 1
            if i % 500 == 0 or i == len(cards):
                elapsed = max(0.001, time.time() - started)
                rate = i / elapsed
                smoothed_rate = rate if smoothed_rate == 0.0 else 0.7 * smoothed_rate + 0.3 * rate
                remaining = (len(cards) - i) / max(0.01, smoothed_rate)
                eta = _fmt_duration(remaining)
                print(f"[scans] {i}/{len(cards)} ok={done} failed={failed} "
                      f"({rate:.1f}/s · ETA {eta})", flush=True)
    print(f"[scans] finished: ok={done} failed={failed} in {time.time()-started:.1f}s")
    if failed:
        print("[scans] failed scans stay out of the cache; a re-run retries only those "
              "(successful ones are served from the local cache with zero network)")


if __name__ == "__main__":
    main()
