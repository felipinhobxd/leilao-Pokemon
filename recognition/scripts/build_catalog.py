#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the local card catalog (SQLite) from TCGdex.

Usage:
    python scripts/build_catalog.py [--languages pt-BR,en] [--refresh]

Language classes (see recognizer/catalog.py):
- CORE (pt-BR, en): the recognition index runs on these. A core language that
  cannot be completed BLOCKS the install (exit 1) — a silent gap here would
  permanently hide cards from identification.
- OPTIONAL (es, ja): metadata-only languages. A gap is WARNED, recorded in
  catalog.gaps.<language> and retried on the next run — it must NEVER block
  the installation (an incomplete ja set degrades ja metadata, nothing else).

Completeness semantics per language:
- A language is only stamped `catalog.updated.<language>` when EVERY expected
  set was fetched (transport retries + set-level retry apply first).
- On unresolved failures the partial data is still saved (INSERT OR REPLACE
  is additive and never deletes good rows), the stamp is NOT written, and the
  gap list lands in `catalog.gaps.<language>` for explicit reporting.
- A rerun with pending gaps retries ONLY the failed sets (sets_filter), not
  the whole language: good rows are untouched, the retry is fast.
- When the sets listing itself fails, the language is handled by its class
  (core -> block, optional -> record a listing-failed gap marker and move on).
"""

from __future__ import annotations

import argparse
import json
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

from recognizer.catalog import (CORE_LANGUAGES, OPTIONAL_LANGUAGES,
                                fetch_language_cards, get_meta, init_db,
                                save_records, set_meta)

LISTING_FAILED_MARKER = "__listing_failed__"


def clear_meta(conn, key: str) -> None:
    conn.execute("DELETE FROM meta WHERE key = ?", (key,))
    conn.commit()


def _pending_gap_sets(gaps_raw: str | None) -> list[str] | None:
    """Parse catalog.gaps.<language> into a sets_filter for a gap-only retry."""
    if not gaps_raw:
        return None
    try:
        payload = json.loads(gaps_raw)
    except json.JSONDecodeError:
        return None
    failed = payload.get("failedSets") or []
    return [s for s in failed if isinstance(s, str) and s and s != LISTING_FAILED_MARKER] or None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,es,ja")
    parser.add_argument("--refresh", action="store_true", help="re-download even if cached")
    args = parser.parse_args()

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    incomplete_core: list[str] = []
    incomplete_optional: list[str] = []

    for language in languages:
        core = language in CORE_LANGUAGES
        stamp = get_meta(conn, f"catalog.updated.{language}")
        gaps = get_meta(conn, f"catalog.gaps.{language}")
        if stamp and not args.refresh and not gaps:
            count = conn.execute("SELECT COUNT(*) FROM cards WHERE language=?", (language,)).fetchone()[0]
            print(f"[catalog] {language}: {count} cards (cached at {stamp}) — use --refresh to update")
            continue

        # Gap-only retry: re-fetch ONLY the sets that failed last time. Good
        # rows were already saved additively and are not touched.
        sets_filter = None
        if gaps and not args.refresh:
            sets_filter = _pending_gap_sets(gaps)
        reason = f" (retrying {len(sets_filter)} gap set(s))" if sets_filter else (f" (gaps pending: {gaps})" if gaps else "")
        print(f"[catalog] downloading {language}{reason} …")
        started = time.time()

        try:
            records, report = fetch_language_cards(language, sets_filter=sets_filter)
        except Exception as exc:  # noqa: BLE001 — listing/transport failure
            # The sets listing itself failed: no per-set knowledge at all.
            if core:
                incomplete_core.append(language)
                print(f"[catalog] {language}: CORE language fetch FAILED ({exc}) — install blocked")
                continue
            incomplete_optional.append(language)
            set_meta(conn, f"catalog.gaps.{language}", json.dumps({
                "failedSets": [LISTING_FAILED_MARKER],
                "expected": 0, "succeeded": 0,
                "error": str(exc)[:300],
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }, ensure_ascii=False))
            print(f"[catalog] {language}: optional language fetch FAILED ({exc}) — "
                  f"gaps recorded, install continues")
            continue

        n = save_records(conn, records)  # additive: partial data never deletes good rows
        if report.failed_sets:
            gaps_payload = json.dumps({
                "failedSets": report.failed_sets,
                "expected": report.expected_sets,
                "succeeded": report.succeeded_sets,
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }, ensure_ascii=False)
            set_meta(conn, f"catalog.gaps.{language}", gaps_payload)
            preview = ", ".join(report.failed_sets[:8]) + ("…" if len(report.failed_sets) > 8 else "")
            if core:
                incomplete_core.append(language)
                print(f"[catalog] {language}: {n} cards saved but INCOMPLETE — "
                      f"{len(report.failed_sets)}/{report.expected_sets} sets failed ({preview})")
                print(f"[catalog] {language}: CORE language incomplete — install blocked; "
                      f"run again to retry the gaps")
            else:
                incomplete_optional.append(language)
                print(f"[catalog] {language}: {n} cards saved, OPTIONAL language incomplete — "
                      f"{len(report.failed_sets)}/{report.expected_sets} sets failed ({preview}); "
                      f"install continues, gaps recorded for retry")
        else:
            set_meta(conn, f"catalog.updated.{language}", time.strftime("%Y-%m-%dT%H:%M:%S"))
            clear_meta(conn, f"catalog.gaps.{language}")
            suffix = f" (gap retry: +{report.succeeded_sets} set(s))" if sets_filter else ""
            print(f"[catalog] {language}: {n} cards in {time.time()-started:.1f}s "
                  f"({report.succeeded_sets}/{report.expected_sets} sets, complete){suffix}")

    total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"[catalog] total: {total} cards")
    if incomplete_core:
        print(f"[catalog] INCOMPLETE CORE languages (install blocked): {', '.join(incomplete_core)}")
    if incomplete_optional:
        print(f"[catalog] incomplete OPTIONAL languages (non-blocking): {', '.join(incomplete_optional)}")
    if incomplete_core:
        sys.exit(1)


if __name__ == "__main__":
    main()
