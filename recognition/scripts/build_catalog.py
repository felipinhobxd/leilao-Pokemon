#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the local card catalog (SQLite) from TCGdex.

Usage:
    python scripts/build_catalog.py [--languages pt-BR,en] [--refresh]

A language is only stamped `catalog.updated.<language>` when EVERY expected
set was fetched (network failures are retried at transport and set level). On
unresolved failures the partial data is still saved (INSERT OR REPLACE is
additive and never deletes good rows) but:
  - the completeness stamp is NOT written (a later run re-attempts the gaps);
  - the gap list lands in `catalog.gaps.<language>` for explicit reporting;
  - the script exits non-zero so scheduled jobs notice.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

from recognizer.catalog import (fetch_language_cards, get_meta, init_db,
                                save_records, set_meta)


def clear_meta(conn, key: str) -> None:
    conn.execute("DELETE FROM meta WHERE key = ?", (key,))
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--refresh", action="store_true", help="re-download even if cached")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    incomplete: list[str] = []
    for language in languages:
        stamp = get_meta(conn, f"catalog.updated.{language}")
        gaps = get_meta(conn, f"catalog.gaps.{language}")
        if stamp and not args.refresh and not gaps:
            count = conn.execute("SELECT COUNT(*) FROM cards WHERE language=?", (language,)).fetchone()[0]
            print(f"[catalog] {language}: {count} cards (cached at {stamp}) — use --refresh to update")
            continue
        reason = f" (gaps pending: {gaps})" if gaps else ""
        print(f"[catalog] downloading {language}{reason} …")
        started = time.time()
        records, report = fetch_language_cards(language)
        n = save_records(conn, records)  # additive: partial data never deletes good rows
        if report.failed_sets:
            incomplete.append(language)
            gaps_payload = json.dumps({
                "failedSets": report.failed_sets,
                "expected": report.expected_sets,
                "succeeded": report.succeeded_sets,
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }, ensure_ascii=False)
            set_meta(conn, f"catalog.gaps.{language}", gaps_payload)
            preview = ", ".join(report.failed_sets[:8]) + ("…" if len(report.failed_sets) > 8 else "")
            print(f"[catalog] {language}: {n} cards saved but INCOMPLETE — "
                  f"{len(report.failed_sets)}/{report.expected_sets} sets failed ({preview})")
            print(f"[catalog] {language}: completeness stamp NOT updated; run again to retry the gaps")
        else:
            set_meta(conn, f"catalog.updated.{language}", time.strftime("%Y-%m-%dT%H:%M:%S"))
            clear_meta(conn, f"catalog.gaps.{language}")
            print(f"[catalog] {language}: {n} cards in {time.time()-started:.1f}s "
                  f"({report.succeeded_sets}/{report.expected_sets} sets, complete)")
    total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"[catalog] total: {total} cards")
    if incomplete:
        print(f"[catalog] INCOMPLETE languages: {', '.join(incomplete)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
