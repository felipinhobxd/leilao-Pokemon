#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the local card catalog (SQLite) from TCGdex.

Usage:
    python scripts/build_catalog.py [--languages pt-BR,en] [--refresh]
"""
from __future__ import annotations

import argparse
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

from recognizer.catalog import fetch_language_cards, get_meta, init_db, save_records, set_meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--refresh", action="store_true", help="re-download even if cached")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    for language in languages:
        stamp = get_meta(conn, f"catalog.updated.{language}")
        if stamp and not args.refresh:
            count = conn.execute("SELECT COUNT(*) FROM cards WHERE language=?", (language,)).fetchone()[0]
            print(f"[catalog] {language}: {count} cards (cached at {stamp}) — use --refresh to update")
            continue
        print(f"[catalog] downloading {language} …")
        started = time.time()
        records = fetch_language_cards(language)
        n = save_records(conn, records)
        set_meta(conn, f"catalog.updated.{language}", time.strftime("%Y-%m-%dT%H:%M:%S"))
        print(f"[catalog] {language}: {n} cards with scans in {time.time()-started:.1f}s")
    total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"[catalog] total: {total} cards")


if __name__ == "__main__":
    main()
