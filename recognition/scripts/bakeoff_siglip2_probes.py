#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Addendum probes: SigLIP2 + crop / pstretch combos on the cached mini-index."""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from recognizer.embed import get_model
from recognizer.normalize import normalize_card
from recognizer.catalog import init_db, load_cards, ensure_scan
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakeoff_embeddings import (FIXTURES, OUT_DIR, load_image, artwork_crop, pstretch,
                                gamma_auto, clahe_bgr, rank_report, embed_pool)

def main():
    meta = json.load(open(os.path.join(OUT_DIR, "pool.json")))
    gt = {e["fixtureId"]: e for e in json.load(open(f"{FIXTURES}/ground-truth.json"))}
    conn = init_db()
    by_key = {f"pt-BR|{c.id}": c for c in load_cards(conn, ["pt-BR"])}
    pool = meta["poolSmall"]
    cache = np.load(os.path.join(OUT_DIR, "mini-siglip2-base-384.npz"), allow_pickle=True)
    matrix, ids = cache["matrix"].astype(np.float32), list(map(str, cache["ids"]))
    model = get_model("siglip2-base-384")
    sample, hard = meta["sample"], meta["hard"]

    print("=== who beats the truth (rank-2 details, siglip2 raw) ===")
    for f in hard + meta["reprints"]:
        d = json.load(open(os.path.join(OUT_DIR, "model-siglip2-base-384.json")))
        r = d["rows"][f]
        if r["rank"] > 1:
            print(f"  {f}: rank={r['rank']} simTruth={r['simTruth']:.3f} "
                  f"top1={r['top1Id']} simTop1={r['simTop1']:.3f} top5={r['top5'][:3]}")

    print("\n=== siglip2 query variants (raw cached pool) ===")
    variants = {
        "raw": None, "clahe": clahe_bgr, "pstretch": pstretch,
        "gammaAuto": gamma_auto, "pstretch+clahe": lambda b: clahe_bgr(pstretch(b)),
    }
    for vname, fn in variants.items():
        rows = {}
        for fid in sample:
            norm = normalize_card(load_image(os.path.join(FIXTURES, gt[fid]["image"])))
            if fn is None:
                q = model.embed([norm.image, norm.rotated180])
            else:
                q = model.embed([fn(norm.image), fn(norm.rotated180)])
            rows[fid] = rank_report(q, matrix, ids, f"pt-BR|{gt[fid]['cardId']}")
        hard_ranks = [rows[f]["rank"] for f in hard]
        reprint_ranks = [rows[f]["rank"] for f in meta["reprints"]]
        top1 = sum(1 for f in sample if rows[f]["rank"] == 1)
        print(f"  {vname:<14} Top1={top1}/12 hard={hard_ranks} reprint={reprint_ranks} "
              f"simTruth={[round(rows[f]['simTruth'], 3) for f in hard]}")

    print("\n=== siglip2 + artwork-crop (re-embed pool cropped) ===")
    matrix_c, ids_c, _ = embed_pool(model, pool, by_key, transform=artwork_crop)
    for vname, fn in (("crop", None), ("crop+pstretch", pstretch), ("crop+gammaAuto", gamma_auto)):
        rows = {}
        for fid in sample:
            norm = normalize_card(load_image(os.path.join(FIXTURES, gt[fid]["image"])))
            pair = ([artwork_crop(norm.image), artwork_crop(norm.rotated180)] if fn is None else
                    [artwork_crop(fn(norm.image)), artwork_crop(fn(norm.rotated180))])
            q = model.embed(pair)
            rows[fid] = rank_report(q, matrix_c, ids_c, f"pt-BR|{gt[fid]['cardId']}")
        hard_ranks = [rows[f]["rank"] for f in hard]
        reprint_ranks = [rows[f]["rank"] for f in meta["reprints"]]
        top1 = sum(1 for f in sample if rows[f]["rank"] == 1)
        print(f"  {vname:<16} Top1={top1}/12 hard={hard_ranks} reprint={reprint_ranks} "
              f"simTruth={[round(rows[f]['simTruth'], 3) for f in hard]}")
        for f in hard + meta["reprints"]:
            r = rows[f]
            if r["rank"] > 1:
                print(f"     MISS {f}: rank={r['rank']} simTruth={r['simTruth']:.3f} "
                      f"top1={r['top1Id']} simTop1={r['simTop1']:.3f} margin={r['margin']:+.3f}")

    print("\n=== dinov3-vits16@224 + artwork-crop full sample (for comparison) ===")
    cache2 = np.load(os.path.join(OUT_DIR, "mini-dinov3-vits16.npz"), allow_pickle=True)
    model2 = get_model("dinov3-vits16")


if __name__ == "__main__":
    main()
