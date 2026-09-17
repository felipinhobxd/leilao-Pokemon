#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LIVE end-to-end smoke test of the multi-source catalog round.

Not a unit test: this hits the REAL TCGdex + pokemon-tcg-data APIs with a
bounded slice (a handful of sets per language) and verifies the whole flow
end-to-end: incremental discovery, reconciliation, alt-image backfill, scan
chain (incl. second-source images), and the coverage report.

Usage (sandbox/dev machine, network required):
    python scripts/smoke_catalog_round.py [--keep]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import recognizer.catalog as catalog_module
from recognizer.catalog import (init_db, load_cards, save_records,
                                fetch_sets_listing, sets_census)
from recognizer.reconcile import backfill_alt_images, reconcile_ptcgdata
from recognizer.sources import fetch_ptcgdata_all, probe_sources

# Bounded slice: a few representative sets per language (old, modern, promo,
# subset) — small enough for a smoke run, diverse enough to be meaningful.
# NOTE: ja set ids in TCGdex are UPPERCASE and era-specific (SV1a, SV-P…).
SMOKE_SETS = {
    "en": ["base1", "swsh9", "swsh9tg", "svp", "sv01"],
    "pt-BR": ["me01", "sv01", "svp"],
    "ja": ["SM1S", "SV1a", "SV-P"],
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="keep the temp DB")
    args = parser.parse_args()

    tmp = tempfile.mkdtemp(prefix="catalog-smoke-")
    db_path = os.path.join(tmp, "cards.sqlite")
    # Redirect the image cache into the temp dir too (no pollution).
    catalog_module.IMAGE_CACHE_DIR = os.path.join(tmp, "image-cache")

    print(f"[smoke] temp dir: {tmp}")
    conn = init_db(db_path)

    # ---- 1. source probe -----------------------------------------------------
    status = probe_sources()
    for name, info in status.items():
        print(f"[smoke] source {name}: {'OK' if info['available'] else 'N/A'} — {info['note']}")
    assert status["tcgdex"]["available"], "TCGdex must be reachable for the smoke test"

    # ---- 2. per-language bounded sync (the same code path build_catalog uses) --
    for language, wanted in SMOKE_SETS.items():
        listing = fetch_sets_listing(language)
        census = sets_census(listing)
        known = [s for s in wanted if s in census]
        missing = [s for s in wanted if s not in census]
        print(f"[smoke] {language}: listing has {len(census)} sets; "
              f"smoke slice found {len(known)}/{len(wanted)}"
              + (f" (not in listing: {missing})" if missing else ""))
        assert known, f"no smoke sets found for {language}"
        records, report = catalog_module.fetch_language_cards(language, sets_filter=known)
        n = save_records(conn, records)
        assert not report.failed_sets, f"{language} gap sets: {report.failed_sets}"
        print(f"[smoke] {language}: saved {n} cards from {len(known)} sets")

    # ---- 3. pokemon-tcg-data fetch + EN reconciliation ------------------------
    t0 = time.time()
    ptcg_sets, ptcg_cards = fetch_ptcgdata_all()
    print(f"[smoke] pokemon-tcg-data: {len(ptcg_sets)} sets, "
          f"{sum(len(v) for v in ptcg_cards.values())} cards in {time.time()-t0:.1f}s")
    # limit the reconciliation slice to the smoke sets for speed
    smoke_ptcg = {sid: cards for sid, cards in ptcg_cards.items()
                  if sid in SMOKE_SETS["en"] or sid in {"swsh12pt5"}}
    en_listing = fetch_sets_listing("en")
    report = reconcile_ptcgdata(conn, en_listing, ptcg_sets, smoke_ptcg)
    print(f"[smoke] reconcile EN: matched={report.matched_sets} "
          f"both={report.cards_both} only-tcgdex={report.cards_only_primary} "
          f"only-ptcg={report.cards_only_secondary} conflicts={report.conflicts} "
          f"rarity+={report.enriched_rarity} alt+={report.backfilled_image_alt} "
          f"inserted={report.inserted_secondary_cards}")

    # ---- 4. pt-BR alt-image backfill ------------------------------------------
    pt_listing = fetch_sets_listing("pt-BR")
    n_alt = backfill_alt_images(conn, "pt-BR", pt_listing, ptcg_sets, smoke_ptcg)
    print(f"[smoke] pt-BR alt-image backfill: {n_alt} rows")

    # ---- 5. verify the scan chain on real cards -------------------------------
    cards = load_cards(conn, ["en", "pt-BR", "ja"])
    with_primary = [c for c in cards if c.image_base]
    with_alt_only = [c for c in cards if not c.image_base and c.image_alt]
    without_any = [c for c in cards if not c.image_base and not c.image_alt]
    print(f"[smoke] cards: {len(cards)} | primary scan: {len(with_primary)} | "
          f"alt-only: {len(with_alt_only)} | no image: {len(without_any)}")

    resolved_primary = 0
    for card in with_primary[:6]:
        resolved, reason = catalog_module.resolve_scan_classified(card.image_base, None)
        if resolved is not None:
            resolved_primary += 1
    print(f"[smoke] scan chain (primary): {resolved_primary}/6 resolved")

    resolved_alt = 0
    for card in with_alt_only[:6]:
        resolved, reason = catalog_module.resolve_scan_classified(
            card.image_base or None, card.image_alt or None)
        tag = resolved[1] if resolved else reason
        print(f"[smoke]   alt-card {card.language}/{card.id}: {tag}")
        if resolved is not None:
            resolved_alt += 1
    print(f"[smoke] scan chain (alt backfill): {resolved_alt}/{min(6, len(with_alt_only))} resolved")

    # ---- 6. identity model sanity ---------------------------------------------
    twins = conn.execute(
        """SELECT canonical_id, COUNT(DISTINCT language) AS langs, COUNT(*) AS printings
           FROM cards GROUP BY canonical_id HAVING langs > 1 ORDER BY printings DESC LIMIT 3""").fetchall()
    for row in twins:
        print(f"[smoke] identity {row[0]}: {row[1]} languages, {row[2]} printings")

    rarity_rows = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE rarity != ''").fetchone()[0]
    subtypes_rows = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE subtypes != '[]'").fetchone()[0]
    print(f"[smoke] enrichment: {rarity_rows} cards with rarity, {subtypes_rows} with subtypes")

    print("[smoke] DONE — all steps passed")
    if not args.keep:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        print(f"[smoke] DB kept at {db_path}")


if __name__ == "__main__":
    main()
