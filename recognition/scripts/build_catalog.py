#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the local card catalog (SQLite) from multiple sources.

Usage:
    python scripts/build_catalog.py [--languages pt-BR,en,ja,es]
                                    [--refresh] [--no-card-details]
                                    [--only-missing-details]

Sources:
- TCGdex (primary, dynamic discovery — series/sets/cards, all languages);
- pokemon-tcg-data (EN: reconciliation + rarity/subtypes + image backfill);
- official sites that are not programmatically consumable are probed and
  their unavailability recorded in the coverage report (no fake coverage).

Language classes (see recognizer/catalog.py):
- CORE (pt-BR, en, ja): the recognition catalog runs on these. A core
  language that cannot be completed BLOCKS the install (exit 1) — a silent
  gap here would permanently hide cards from identification.
- OPTIONAL (es): metadata-only. A gap is WARNED, recorded in
  catalog.gaps.<language> and retried on the next run — it must NEVER block
  the installation.

INCREMENTAL SYNC (no --refresh needed for new content):
- Every run re-reads the 1-request sets listing per language and diffs it
  against the stored per-set census (catalog.sets_census.<lang>).
- New sets and sets whose card counts changed are fetched; untouched sets
  are skipped. A new expansion released tomorrow is discovered and fetched
  automatically — no code change, no --refresh.
- Gap-only retry: sets that failed last time (catalog.gaps.<lang>) are
  re-fetched; good rows are never re-downloaded or deleted.

CARD-DETAILS PASS (rarity + variants per card):
- TCGdex set listings carry no rarity/variants; only the per-card endpoint
  does. This optional pass (ON by default for core languages) enriches
  cards missing rarity, incrementally (only NULL-rarity rows), with its own
  stamp (catalog.details.<lang>) and gap list (catalog.details_gaps.<lang>).
- Disable with --no-card-details (or RECOGNITION_CATALOG_CARD_DETAILS=0).

COMPLETENESS:
- A language is stamped `catalog.updated.<language>` ONLY when EVERY
  expected set was fetched. Partial data is still saved (additive, never
  deletes good rows) and the gaps land in catalog.gaps.<language>.
- The coverage report (per language + per source: union / intersection /
  only-A / only-B / conflicts / backfills) is stored in
  catalog.coverage.<language> and printed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import (CORE_LANGUAGES, OPTIONAL_LANGUAGES, LANG_CODE,
                                fetch_language_cards, fetch_sets_listing, get_meta,
                                init_db, save_records, set_meta, sets_census)
from recognizer.reconcile import backfill_alt_images, reconcile_ptcgdata, reconcile_limitless_ptbr
from recognizer.sources import (fetch_ptcgdata_all, fetch_limitless_all, fetch_tcgdex_card_details,
                                probe_sources)

LISTING_FAILED_MARKER = "__listing_failed__"

# A set that fails this many CONSECUTIVE runs is classified
# "upstream-unavailable": the endpoint is broken on the source side (e.g.
# TCGdex currently returns HTTP 503 for the ja "SM1+"-style subset set ids
# and their cards are absent from the global listing too). Such a gap is
# still recorded and still retried on every run (in case the source heals),
# but it no longer BLOCKS a core language — a permanently broken upstream
# endpoint must not make the install impossible. Verified live 2026-09-17:
# 5 ja sets (SM1+, sm2+, SM3+, SM4+, SM5+ / 336 cards) are listing-only
# ghosts on api.tcgdex.net.
UPSTREAM_UNAVAILABLE_AFTER = 3


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


def _sync_language(conn, language: str, refresh: bool, verbose: bool = True) -> str:
    """One TCGdex language sync. Returns 'complete' | 'partial' | 'failed' | 'skipped'."""
    core = language in CORE_LANGUAGES
    stamp = get_meta(conn, f"catalog.updated.{language}")
    gaps = get_meta(conn, f"catalog.gaps.{language}")
    census_raw = get_meta(conn, f"catalog.sets_census.{language}")

    # ---- incremental diff: what must be fetched this run? ------------------
    to_fetch: list[str] | None = None  # None = everything (first run/refresh)
    listing_cache: list[dict] | None = None
    reason = ""
    if not refresh:
        try:
            listing_cache = fetch_sets_listing(language)
        except Exception as exc:  # noqa: BLE001 — listing transport failure
            if stamp and not gaps:
                # A previously COMPLETE language whose listing now fails:
                # keep the good data, warn, and DO NOT touch the stamp (the
                # catalog content is still the last-known-complete state).
                if verbose:
                    print(f"[catalog] {language}: listing FAILED ({exc}) — "
                          f"keeping the last complete sync from {stamp}")
                return "skipped"
            _record_listing_failure(conn, language, core, exc)
            return "failed"
        current = sets_census(listing_cache)
        if census_raw:
            try:
                previous = json.loads(census_raw)
            except json.JSONDecodeError:
                previous = {}
            changed = [sid for sid, counts in current.items()
                       if sid not in previous or previous[sid] != counts]
            # sets that vanished from the listing are informational only:
            # their rows stay in the DB (never delete), the census just moves on
            if not changed and not gaps:
                count = conn.execute("SELECT COUNT(*) FROM cards WHERE language=?",
                                     (language,)).fetchone()[0]
                if verbose:
                    print(f"[catalog] {language}: {count} cards — up to date "
                          f"({len(current)} sets, census unchanged since {stamp})")
                return "skipped"
            if changed:
                to_fetch = changed
                reason = f" ({len(changed)} new/changed set(s))"
        elif stamp or gaps:
            # stamped but no census (pre-census catalog): rebuild census by
            # fetching everything once.
            to_fetch = None

    # ---- fetch (full / changed-only / gap-only) ----------------------------
    sets_filter = None
    if not refresh:
        gap_sets = _pending_gap_sets(gaps)
        if to_fetch and gap_sets:
            sets_filter = sorted(set(to_fetch) | set(gap_sets))
        elif to_fetch:
            sets_filter = to_fetch
        elif gap_sets:
            sets_filter = gap_sets
    if verbose:
        n = len(sets_filter) if sets_filter is not None else "all"
        print(f"[catalog] downloading {language}{reason} — sets: {n}")
    started = time.time()

    try:
        records, report = fetch_language_cards(language, sets_filter=sets_filter)
        listing = listing_cache if listing_cache is not None else fetch_sets_listing(language)
    except Exception as exc:  # noqa: BLE001 — listing/transport failure
        _record_listing_failure(conn, language, core, exc)
        return "failed"

    save_records(conn, records)  # additive: partial data never deletes good rows
    # refresh the census with what the listing now says (even on partial
    # fetches: the census describes the SOURCE, the gaps describe OUR state)
    set_meta(conn, f"catalog.sets_census.{language}",
             json.dumps(sets_census(listing), ensure_ascii=False))

    n_scans = sum(1 for r in records if r.image_base)
    if report.failed_sets:
        # Consecutive-failure accounting: sets failing every run become
        # "upstream-unavailable" after UPSTREAM_UNAVAILABLE_AFTER attempts
        # (recorded, retried, but no longer install-blocking).
        try:
            previous = json.loads(gaps or "{}")
        except json.JSONDecodeError:
            previous = {}
        attempts = dict(previous.get("attempts") or {})
        for sid in report.failed_sets:
            attempts[sid] = int(attempts.get(sid, 0)) + 1
        for sid in list(attempts):
            if sid not in report.failed_sets:
                attempts.pop(sid)  # healed: reset its counter
        upstream_limited = all(n >= UPSTREAM_UNAVAILABLE_AFTER for n in attempts.values()) \
            and bool(attempts)
        set_meta(conn, f"catalog.gaps.{language}", json.dumps({
            "failedSets": report.failed_sets,
            "attempts": attempts,
            "upstreamLimited": upstream_limited,
            "expected": report.expected_sets,
            "succeeded": report.succeeded_sets,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }, ensure_ascii=False))
        preview = ", ".join(report.failed_sets[:8]) + ("…" if len(report.failed_sets) > 8 else "")
        if verbose:
            print(f"[catalog] {language}: {len(records)} cards saved but INCOMPLETE — "
                  f"{len(report.failed_sets)}/{report.expected_sets} sets failed ({preview})")
            if upstream_limited:
                print(f"[catalog] {language}: every failing set is upstream-unavailable "
                      f"(>{UPSTREAM_UNAVAILABLE_AFTER} consecutive attempts) — recorded as a "
                      f"source-side gap, NOT blocking the install")
        return "partial-upstream" if upstream_limited else "partial"
    set_meta(conn, f"catalog.updated.{language}", time.strftime("%Y-%m-%dT%H:%M:%S"))
    clear_meta(conn, f"catalog.gaps.{language}")
    if verbose:
        suffix = f" (+{report.succeeded_sets} set(s) incremental)" if sets_filter else ""
        print(f"[catalog] {language}: {len(records)} cards ({n_scans} with scans, "
              f"{len(records) - n_scans} scan not_available) in {time.time()-started:.1f}s "
              f"({report.succeeded_sets}/{report.expected_sets} sets, complete){suffix}")
    return "complete"


def _record_listing_failure(conn, language: str, core: bool, exc: Exception) -> None:
    if core:
        print(f"[catalog] {language}: CORE language listing FAILED ({exc}) — install blocked")
    else:
        set_meta(conn, f"catalog.gaps.{language}", json.dumps({
            "failedSets": [LISTING_FAILED_MARKER],
            "expected": 0, "succeeded": 0,
            "error": str(exc)[:300],
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }, ensure_ascii=False))
        print(f"[catalog] {language}: optional language listing FAILED ({exc}) — "
              f"gaps recorded, install continues")


# ---------------------------------------------------------------- card details
def _card_details_pass(conn, language: str, limit: int = 0) -> None:
    """Enrich cards with rarity + variants from the TCGdex per-card endpoint.

    Incremental: only rows whose rarity is still empty are fetched. Own
    stamp (catalog.details.<lang>) + gap list; a failed card is retried on
    the next run. Politeness: a small sleep between requests (the endpoint
    is one-request-per-card, and TCGdex is a free community API).
    """
    code = LANG_CODE.get(language)
    if not code:
        return
    pending = conn.execute(
        "SELECT id FROM cards WHERE language = ? AND (rarity IS NULL OR rarity = '')",
        (language,)).fetchall()
    if not pending:
        print(f"[catalog] {language}: card details complete (no rows missing rarity)")
        return
    ids = [row[0] for row in pending]
    if limit:
        ids = ids[:limit]
    print(f"[catalog] {language}: enriching {len(ids)} card(s) with per-card details "
          f"(rarity/variants) …")
    done = failed = 0
    started = time.time()
    for i, card_id in enumerate(ids, 1):
        payload = fetch_tcgdex_card_details(code, card_id)
        if payload is None:
            failed += 1
            time.sleep(0.3)
            continue
        rarity = payload.get("rarity") or ""
        variants = json.dumps(payload.get("variants") or {}, ensure_ascii=False)
        sources = {f"tcgdex-card": {"id": card_id}}
        conn.execute(
            "UPDATE cards SET rarity = ?, variants = ? WHERE id = ? AND language = ?",
            (rarity, variants, card_id, language))
        # keep the sources ledger accurate without clobbering other entries
        row = conn.execute("SELECT sources FROM cards WHERE id = ? AND language = ?",
                           (card_id, language)).fetchone()
        if row and row[0]:
            try:
                merged = json.loads(row[0])
                merged.update(sources)
                conn.execute("UPDATE cards SET sources = ? WHERE id = ? AND language = ?",
                             (json.dumps(merged, ensure_ascii=False), card_id, language))
            except json.JSONDecodeError:
                pass
        done += 1
        if i % 50 == 0:
            conn.commit()
            rate = i / max(0.001, time.time() - started)
            eta = (len(ids) - i) / max(0.1, rate)
            print(f"[catalog] {language}: details {i}/{len(ids)} "
                  f"({rate:.1f}/s · ETA {int(eta)}s)", flush=True)
        time.sleep(0.05)  # politeness to the free API
    conn.commit()
    set_meta(conn, f"catalog.details.{language}", json.dumps({
        "enriched": done, "failed": failed,
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }, ensure_ascii=False))
    print(f"[catalog] {language}: details done — {done} enriched, {failed} failed "
          f"(failed rows retry on the next run)")


# ------------------------------------------------------------------- coverage
def _coverage_report(conn, language: str) -> dict:
    """Real coverage numbers for one language (cards/identities/images)."""
    row = conn.execute(
        """SELECT COUNT(*), COUNT(DISTINCT set_id), COUNT(DISTINCT canonical_id),
                  SUM(image_base != ''), SUM(scan_status = 'not_available'),
                  SUM(image_alt != '')
           FROM cards WHERE language = ?""", (language,)).fetchone()
    scans = dict(conn.execute(
        "SELECT state, COUNT(*) FROM scans GROUP BY state").fetchall())
    conflicts = conn.execute(
        "SELECT COUNT(*) FROM conflicts WHERE language = ?", (language,)).fetchone()[0]
    return {
        "language": language,
        "cards": row[0] or 0,
        "sets": row[1] or 0,
        "identities": row[2] or 0,
        "withPrimaryScan": row[3] or 0,
        "scanNotAvailable": row[4] or 0,
        "withAltImage": row[5] or 0,
        "scanStates": scans,
        "conflicts": conflicts,
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", default="pt-BR,en,ja,es")
    parser.add_argument("--refresh", action="store_true", help="re-download even if unchanged")
    parser.add_argument("--no-card-details", action="store_true",
                        help="skip the per-card rarity/variants enrichment pass")
    parser.add_argument("--details-limit", type=int, default=0,
                        help="cap per-card enrichment (testing / slow links)")
    args = parser.parse_args()

    card_details = (not args.no_card_details
                    and os.environ.get("RECOGNITION_CATALOG_CARD_DETAILS", "1") != "0")

    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    conn = init_db()
    incomplete_core: list[str] = []
    incomplete_optional: list[str] = []
    status: dict[str, str] = {}

    # ---- source availability (honest, probed, recorded) --------------------
    source_status = probe_sources()
    set_meta(conn, "sources.status", json.dumps(source_status, ensure_ascii=False))
    for name, info in source_status.items():
        mark = "OK " if info["available"] else "N/A"
        print(f"[catalog] source {name}: {mark} — {info['note']}")

    # ---- per-language TCGdex sync (incremental) -----------------------------
    for language in languages:
        outcome = _sync_language(conn, language, args.refresh)
        status[language] = outcome
        if outcome == "failed":
            if language in CORE_LANGUAGES:
                incomplete_core.append(language)
            else:
                incomplete_optional.append(language)
        elif outcome == "partial":  # transport-failure gaps still block core
            if language in CORE_LANGUAGES:
                incomplete_core.append(language)
            else:
                incomplete_optional.append(language)
        # "partial-upstream": every remaining gap is source-side broken —
        # recorded + retried, but deliberately NOT install-blocking.

    # ---- second source: pokemon-tcg-data (EN reconcile + pt backfill) -------
    ptcg_sets = ptcg_cards = None
    if source_status.get("pokemon-tcg-data", {}).get("available"):
        try:
            print("[catalog] fetching pokemon-tcg-data (EN) …")
            ptcg_sets, ptcg_cards = fetch_ptcgdata_all(
                on_set=lambda sid, n, i, total: print(
                    f"\r[catalog] pokemon-tcg-data {i}/{total} sets", end="", flush=True)
                if i % 20 == 0 or i == total else None)
            print(f"\n[catalog] pokemon-tcg-data: {len(ptcg_sets)} sets, "
                  f"{sum(len(v) for v in ptcg_cards.values())} cards")
        except Exception as exc:  # noqa: BLE001
            print(f"[catalog] pokemon-tcg-data fetch FAILED ({exc}) — "
                  f"EN stays single-source this run, gaps recorded")
            set_meta(conn, "catalog.gaps.pokemon-tcg-data", json.dumps({
                "error": str(exc)[:300], "at": time.strftime("%Y-%m-%dT%H:%M:%S")}))
    else:
        print("[catalog] pokemon-tcg-data unavailable — EN stays single-source this run")
        set_meta(conn, "catalog.gaps.pokemon-tcg-data", json.dumps({
            "error": "source unavailable", "at": time.strftime("%Y-%m-%dT%H:%M:%S")}))

    # ---- third source: Limitless TCG (PT-BR promos + alphanumeric localIds) --
    limitless_sets = limitless_cards = None
    if source_status.get("limitless-tcg", {}).get("available") and "pt-BR" in languages:
        try:
            print("[catalog] fetching Limitless TCG (PT-BR) …")
            limitless_sets, limitless_cards = fetch_limitless_all("pt-BR",
                on_set=lambda sid, n, i, total: print(
                    f"\r[catalog] Limitless TCG {i}/{total} sets", end="", flush=True)
                if i % 20 == 0 or i == total else None)
            print(f"\n[catalog] Limitless TCG: {len(limitless_sets)} sets, "
                  f"{sum(len(v) for v in limitless_cards.values())} cards (PT-BR)")
        except Exception as exc:  # noqa: BLE001
            print(f"[catalog] Limitless TCG fetch FAILED ({exc}) — "
                  f"PT-BR stays single-source this run, gaps recorded")
            set_meta(conn, "catalog.gaps.limitless-tcg", json.dumps({
                "error": str(exc)[:300], "at": time.strftime("%Y-%m-%dT%H:%M:%S")}))
    else:
        if "pt-BR" in languages:
            print("[catalog] Limitless TCG unavailable or PT-BR not requested — "
                  "PT-BR stays single-source this run")
            set_meta(conn, "catalog.gaps.limitless-tcg", json.dumps({
                "error": "source unavailable or language not requested",
                "at": time.strftime("%Y-%m-%dT%H:%M:%S")}))

    if ptcg_sets is not None:
        # EN: full reconciliation (merge + conflicts + gap report)
        try:
            en_listing = fetch_sets_listing("en")
            report = reconcile_ptcgdata(conn, en_listing, ptcg_sets, ptcg_cards)
            set_meta(conn, "catalog.coverage.en", json.dumps(report.to_dict(), ensure_ascii=False))
            print(f"[catalog] reconcile EN: sets matched={report.matched_sets} "
                  f"only-tcgdex={len(report.only_primary_sets)} "
                  f"only-ptcgdata={len(report.only_secondary_sets)} | cards "
                  f"both={report.cards_both} only-tcgdex={report.cards_only_primary} "
                  f"only-ptcgdata={report.cards_only_secondary} | conflicts={report.conflicts} "
                  f"rarity+={report.enriched_rarity} alt-image+={report.backfilled_image_alt} "
                  f"inserted={report.inserted_secondary_cards}")
        except Exception as exc:  # noqa: BLE001
            print(f"[catalog] EN reconciliation FAILED ({exc}) — gaps recorded")
            set_meta(conn, "catalog.gaps.reconcile-en", json.dumps({
                "error": str(exc)[:300], "at": time.strftime("%Y-%m-%dT%H:%M:%S")}))
        # pt-BR: artwork-mirror backfill for scanless cards of international sets
        if "pt-BR" in languages:
            try:
                pt_listing = fetch_sets_listing("pt-BR")
                n = backfill_alt_images(conn, "pt-BR", pt_listing, ptcg_sets, ptcg_cards)
                print(f"[catalog] pt-BR: {n} scanless card(s) gained a second-source "
                      f"artwork mirror (image_alt) from pokemon-tcg-data")
            except Exception as exc:  # noqa: BLE001
                print(f"[catalog] pt-BR image backfill from pokemon-tcg-data FAILED ({exc})")

    # ---- Limitless TCG reconciliation for PT-BR -------------------------------
    if limitless_sets is not None and "pt-BR" in languages:
        try:
            pt_listing = fetch_sets_listing("pt-BR")
            report = reconcile_limitless_ptbr(conn, pt_listing, limitless_sets, limitless_cards)
            set_meta(conn, "catalog.coverage.pt-BR-limitless", json.dumps(report.to_dict(), ensure_ascii=False))
            print(f"[catalog] reconcile PT-BR (Limitless): sets matched={report.matched_sets} "
                  f"only-tcgdex={len(report.only_primary_sets)} "
                  f"only-limitless={len(report.only_secondary_sets)} | cards "
                  f"both={report.cards_both} only-tcgdex={report.cards_only_primary} "
                  f"only-limitless={report.cards_only_secondary} | conflicts={report.conflicts} "
                  f"rarity+={report.enriched_rarity} alt-image+={report.backfilled_image_alt} "
                  f"inserted={report.inserted_secondary_cards}")
        except Exception as exc:  # noqa: BLE001
            print(f"[catalog] PT-BR reconciliation with Limitless FAILED ({exc}) — gaps recorded")
            set_meta(conn, "catalog.gaps.reconcile-pt-BR-limitless", json.dumps({
                "error": str(exc)[:300], "at": time.strftime("%Y-%m-%dT%H:%M:%S")}))

    # ---- per-card details pass (rarity/variants) ----------------------------
    if card_details:
        for language in languages:
            if language in CORE_LANGUAGES:
                _card_details_pass(conn, language, limit=args.details_limit)

    # ---- final coverage report ----------------------------------------------
    print("[catalog] coverage:")
    total = with_scans = not_available = 0
    for language in languages:
        cov = _coverage_report(conn, language)
        set_meta(conn, f"catalog.coverage.{language}", json.dumps(cov, ensure_ascii=False))
        total += cov["cards"]; with_scans += cov["withPrimaryScan"]
        not_available += cov["scanNotAvailable"]
        print(f"[catalog]   {language}: {cov['cards']} cards · {cov['sets']} sets · "
              f"{cov['identities']} identities · scans {cov['withPrimaryScan']} primary "
              f"+ {cov['withAltImage']} alt · not_available {cov['scanNotAvailable']} · "
              f"conflicts {cov['conflicts']}")
    print(f"[catalog] total: {total} cards ({with_scans} with primary scans, "
          f"{not_available} scan not_available — still candidates via alt images/OCR)")

    if incomplete_core:
        print(f"[catalog] INCOMPLETE CORE languages (install blocked): {', '.join(incomplete_core)}")
        print("[catalog] run again to retry only the gaps")
    if incomplete_optional:
        print(f"[catalog] incomplete OPTIONAL languages (non-blocking): {', '.join(incomplete_optional)}")
    for language in languages:
        if status.get(language) == "partial-upstream":
            gaps = json.loads(get_meta(conn, f"catalog.gaps.{language}") or "{}")
            print(f"[catalog] {language}: PARTIAL (upstream-unavailable sets: "
                  f"{', '.join(gaps.get('failedSets', [])[:8])}"
                  f"{'…' if len(gaps.get('failedSets', [])) > 8 else ''}) — "
                  f"source-side gap, retried on every run, not blocking")
    if incomplete_core:
        sys.exit(1)


if __name__ == "__main__":
    main()
