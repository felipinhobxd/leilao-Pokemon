#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download official scans (high.webp) into the local image cache.

Usage:
    python scripts/download_scans.py [--languages pt-BR,en] [--workers 12]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import ensure_scan, init_db, load_cards


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
            if i % 500 == 0:
                rate = i / max(0.001, time.time() - started)
                print(f"[scans] {i}/{len(cards)} ok={done} failed={failed} ({rate:.1f}/s)")
    print(f"[scans] finished: ok={done} failed={failed} in {time.time()-started:.1f}s")


if __name__ == "__main__":
    main()
