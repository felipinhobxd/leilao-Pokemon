#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Targeted embedding bake-off on the REMAINING hard failures (phased, disk-cached).

Phases (each fits a single foreground run):
  prep                 full-index ranks, confuser selection, pool definition
  model <name>         embed mini-index pool with one model -> cache + ranks
  probes               photometric/crop probes on the cached dinov3-vits16 pool
  analyze              aggregate everything into a final report

Cause codes tested:
  A embedding model   B normalization   C resolution
  D photometric       E catalog/reprint  F ranking/fusion
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import random
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import ensure_scan, init_db, load_cards
from recognizer.embed import get_model
from recognizer.normalize import normalize_card

FIXTURES = "data/fixtures"
OUT_DIR = "data/bakeoff"
POOL_JSON = os.path.join(OUT_DIR, "pool.json")
FAST_MODELS = ["dinov3-vits16", "dinov2-small", "dinov3-vitb16"]
SLOW_MODELS = ["dinov3-vits16-392", "siglip2-base-384"]
BATCH = 8
N_CONFUSERS = 10

HARD_MISS_IDS = [
    "rand-028-pt-BR|sm3-104",
    "rand-055-pt-BR|swsh9-138",
    "rand-077-pt-BR|sm1-82",
    "rand-078-pt-BR|sv08-052",
    "rand-086-pt-BR|sv03.5-066",
]
REPRINT_IDS = ["rand-045-pt-BR|sv07-107", "rand-080-pt-BR|swsh4.5-30"]


# ----------------------------------------------------------------- utilities
def load_image(path: str):
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def load_scan_bgr(path: str):
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def clahe_bgr(bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    lab[..., 0] = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(lab[..., 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def gray_world(bgr: np.ndarray) -> np.ndarray:
    img = bgr.astype(np.float32)
    means = img.reshape(-1, 3).mean(axis=0)
    means[means == 0] = 1.0
    img *= (means.mean() / means)[None, None, :]
    return np.clip(img, 0, 255).astype(np.uint8)


def gamma_auto(bgr: np.ndarray, target: float = 128.0) -> np.ndarray:
    """Gamma that maps the mean luminance to `target` (fixes extreme low light)."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    mean = float(np.clip(gray.mean(), 1e-3, 1.0))
    gamma = float(np.log(target / 255.0) / np.log(mean))
    gamma = float(np.clip(gamma, 0.2, 3.0))
    lut = (np.linspace(0, 1, 256) ** gamma * 255.0).astype(np.uint8)
    return cv2.LUT(bgr, lut)


def pstretch(bgr: np.ndarray, lo_pct: float = 0.5, hi_pct: float = 99.5) -> np.ndarray:
    """Per-channel percentile stretch: p_lo -> 0, p_hi -> 255 (fixes dark + washed)."""
    out = bgr.copy()
    for ch in range(3):
        chn = bgr[..., ch]
        lo, hi = np.percentile(chn, [lo_pct, hi_pct])
        if hi - lo < 8:  # near-flat channel: leave alone
            continue
        out[..., ch] = np.clip((chn.astype(np.float32) - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)
    return out


def artwork_crop(bgr: np.ndarray) -> np.ndarray:
    h, w = bgr.shape[:2]
    return bgr[int(0.07 * h):int(0.55 * h), int(0.08 * w):int(0.92 * w)]


PHOTOMETRIC_VARIANTS = {
    "raw": None,
    "clahe": clahe_bgr,
    "grayworld": gray_world,
    "gammaAuto": gamma_auto,
    "pstretch": pstretch,
    "gammaAuto+clahe": lambda b: clahe_bgr(gamma_auto(b)),
    "pstretch+clahe": lambda b: clahe_bgr(pstretch(b)),
}


def rank_report(q_emb: np.ndarray, matrix: np.ndarray, ids: list[str], truth_key: str):
    sims = (q_emb @ matrix.T).max(axis=0) if q_emb.ndim == 2 else q_emb @ matrix.T
    order = np.argsort(-sims)
    ids_arr = np.array(ids)
    truth_rows = np.where(ids_arr == truth_key)[0]
    rank = int(np.where(order == truth_rows[0])[0][0]) + 1 if len(truth_rows) else 999
    top1_i = int(order[0])
    sim_truth = float(sims[truth_rows[0]]) if len(truth_rows) else -1.0
    return {
        "rank": rank,
        "simTruth": sim_truth,
        "top1Id": ids[top1_i],
        "simTop1": float(sims[top1_i]),
        "margin": float(sims[top1_i] - sim_truth),
        "top5": [ids[int(r)] for r in order[:5]],
    }


def embed_pool(model, pool_keys, by_key, transform=None):
    """Batched embedding over pool cards -> (matrix, ids, seconds). Rows aligned to ids."""
    out, ids, buf, keys_buf = [], [], [], []
    t0 = time.time()

    def flush():
        if not buf:
            return
        out.append(model.embed(buf))
        ids.extend(keys_buf)
        buf.clear()
        keys_buf.clear()

    for k in pool_keys:
        path = ensure_scan(by_key[k].image_base, "high.webp")
        if not path:
            continue
        img = load_scan_bgr(path)
        if img is None:
            continue
        buf.append(transform(img) if transform is not None else img)
        keys_buf.append(k)
        if len(buf) >= BATCH:
            flush()
    flush()
    matrix = np.concatenate(out, axis=0) if out else np.zeros((0, model.dim), np.float32)
    return matrix, ids, time.time() - t0


def load_sample():
    gt = {e["fixtureId"]: e for e in json.load(open(f"{FIXTURES}/ground-truth.json"))}
    hard = [f for f in HARD_MISS_IDS if f in gt]
    normal = [e["fixtureId"] for e in json.load(open(f"{FIXTURES}/ground-truth.json"))
              if e.get("level") == "normal"][:5]
    reprints = [f for f in REPRINT_IDS if f in gt]
    return gt, hard, normal, reprints, hard + normal + reprints


# ------------------------------------------------------------------- phases
def phase_prep():
    os.makedirs(OUT_DIR, exist_ok=True)
    gt, hard, normal, reprints, sample = load_sample()
    conn = init_db()
    cards = load_cards(conn, ["pt-BR"])
    by_key = {f"pt-BR|{c.id}": c for c in cards}

    queries = {}
    for fid in sample:
        img = load_image(os.path.join(FIXTURES, gt[fid]["image"]))
        norm = normalize_card(img)
        queries[fid] = {"method": norm.method, "conf": round(float(norm.confidence), 2),
                        "rot": norm.rotation_code}
        print(f"  norm {fid:<38} method={norm.method:<15} conf={norm.confidence:.2f}")

    full = np.load("data/card-index/embeddings/dinov3-vits16.npz", allow_pickle=True)
    full_ids, full_matrix = list(map(str, full["ids"])), full["matrix"].astype(np.float32)
    cur = get_model("dinov3-vits16")
    print(f"\n[prep] full-index ranks ({len(full_ids)} cards, dinov3-vits16@224):")
    full_ranks, confusers = {}, set()
    for fid in sample:
        img = load_image(os.path.join(FIXTURES, gt[fid]["image"]))
        norm = normalize_card(img)
        q = cur.embed([norm.image, norm.rotated180])
        rep = rank_report(q, full_matrix, full_ids, f"pt-BR|{gt[fid]['cardId']}")
        full_ranks[fid] = rep
        lvl = gt[fid].get("level", "?")
        print(f"  {fid:<38} [{lvl}] rank={rep['rank']:<5} simTruth={rep['simTruth']:.3f} "
              f"top1={rep['top1Id']:<28} simTop1={rep['simTop1']:.3f}")
        sims = (q @ full_matrix.T).max(axis=0)
        order = np.argsort(-sims)[:N_CONFUSERS]
        confusers.update(full_ids[int(r)] for r in order)

    truth_keys = {f"pt-BR|{gt[fid]['cardId']}" for fid in sample}
    rng = random.Random(7)
    pool_big = sorted(truth_keys | confusers)
    rest = [k for k in by_key if k not in set(pool_big)]
    pool_big += rng.sample(rest, 500)                    # fast models: 500 distractors
    pool_small = sorted(truth_keys | confusers)
    pool_small += rng.sample(rest, 250)                  # slow models: 250 distractors

    data = {"sample": sample, "hard": hard, "normal": normal, "reprints": reprints,
            "truthKeys": sorted(truth_keys), "confusers": sorted(confusers),
            "poolBig": pool_big, "poolSmall": pool_small,
            "normalization": queries, "fullRanks": full_ranks}
    with open(POOL_JSON, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(f"\n[prep] pool: big={len(pool_big)} small={len(pool_small)} -> {POOL_JSON}")


def phase_model(name: str):
    meta = json.load(open(POOL_JSON))
    gt = {e["fixtureId"]: e for e in json.load(open(f"{FIXTURES}/ground-truth.json"))}
    conn = init_db()
    by_key = {f"pt-BR|{c.id}": c for c in load_cards(conn, ["pt-BR"])}
    pool = meta["poolBig"] if name in FAST_MODELS else meta["poolSmall"]

    model = get_model(name)
    matrix, ids, t_embed = embed_pool(model, pool, by_key)
    np.savez_compressed(os.path.join(OUT_DIR, f"mini-{name}.npz"), matrix=matrix, ids=np.array(ids, dtype=object))
    print(f"[model] {name}: embedded {len(ids)} scans in {t_embed:.1f}s ({len(ids)/max(.001,t_embed):.1f}/s)")

    rows, t0 = {}, time.time()
    for fid in meta["sample"]:
        norm = normalize_card(load_image(os.path.join(FIXTURES, gt[fid]["image"])))
        q = model.embed([norm.image, norm.rotated180])
        rows[fid] = rank_report(q, matrix, ids, f"pt-BR|{gt[fid]['cardId']}")
    t_q = time.time() - t0

    hard = meta["hard"]
    top1 = sum(1 for f in meta["sample"] if rows[f]["rank"] == 1)
    top5 = sum(1 for f in meta["sample"] if rows[f]["rank"] <= 5)
    print(f"[model] {name}: Top1={top1}/{len(rows)} Top5={top5}/{len(rows)} | "
          f"hard ranks={[rows[f]['rank'] for f in hard]} | query {t_q:.1f}s")
    for f in meta["sample"]:
        r = rows[f]
        tag = "HARD" if f in hard else ("REPRINT" if f in meta["reprints"] else "ok")
        flag = "" if r["rank"] == 1 else "  <-- MISS"
        print(f"  [{tag:<7}] {f:<38} rank={r['rank']:<4} simTruth={r['simTruth']:.3f} "
              f"simTop1={r['simTop1']:.3f} margin={r['margin']:+.3f}{flag}")

    with open(os.path.join(OUT_DIR, f"model-{name}.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": name, "n": len(ids), "embedSeconds": t_embed,
                   "querySeconds": t_q, "rows": rows}, fh, ensure_ascii=False, indent=1)
    del model, matrix
    gc.collect()


def phase_probes():
    meta = json.load(open(POOL_JSON))
    gt = {e["fixtureId"]: e for e in json.load(open(f"{FIXTURES}/ground-truth.json"))}
    conn = init_db()
    by_key = {f"pt-BR|{c.id}": c for c in load_cards(conn, ["pt-BR"])}
    pool = meta["poolBig"]
    cache = np.load(os.path.join(OUT_DIR, "mini-dinov3-vits16.npz"), allow_pickle=True)
    matrix, ids = cache["matrix"].astype(np.float32), list(map(str, cache["ids"]))
    model = get_model("dinov3-vits16")
    hard = meta["hard"]

    print("[probes] photometric variants on hard fixtures (mini-index, dinov3-vits16@224):")
    photometric = {}
    for variant, fn in PHOTOMETRIC_VARIANTS.items():
        rows = {}
        for fid in meta["sample"]:
            norm = normalize_card(load_image(os.path.join(FIXTURES, gt[fid]["image"])))
            if fn is None:
                q = model.embed([norm.image, norm.rotated180])
            else:
                q = model.embed([fn(norm.image), fn(norm.rotated180)])
            rows[fid] = rank_report(q, matrix, ids, f"pt-BR|{gt[fid]['cardId']}")
        hard_ranks = [rows[f]["rank"] for f in hard]
        hard_sims = [round(rows[f]["simTruth"], 3) for f in hard]
        top1 = sum(1 for f in meta["sample"] if rows[f]["rank"] == 1)
        print(f"  {variant:<16} Top1={top1}/{len(rows)} hard ranks={hard_ranks} hard simTruth={hard_sims}")
        photometric[variant] = rows

    print("\n[probes] artwork-crop embedding (query+scans cropped, dinov3-vits16@224):")
    matrix_c, ids_c, _ = embed_pool(model, pool, by_key, transform=artwork_crop)
    rows = {}
    for fid in meta["sample"]:
        norm = normalize_card(load_image(os.path.join(FIXTURES, gt[fid]["image"])))
        q = model.embed([artwork_crop(norm.image), artwork_crop(norm.rotated180)])
        rows[fid] = rank_report(q, matrix_c, ids_c, f"pt-BR|{gt[fid]['cardId']}")
    hard_ranks = [rows[f]["rank"] for f in hard]
    top1 = sum(1 for f in meta["sample"] if rows[f]["rank"] == 1)
    print(f"  artworkCrop      Top1={top1}/{len(rows)} hard ranks={hard_ranks}")
    for f in hard:
        r = rows[f]
        print(f"    {f}: rank={r['rank']} simTruth={r['simTruth']:.3f} top1={r['top1Id']} simTop1={r['simTop1']:.3f}")

    print("\n[probes] crop + photometric combo on hard fixtures:")
    for variant in ("gammaAuto", "pstretch", "gammaAuto+clahe"):
        fn = PHOTOMETRIC_VARIANTS[variant]
        rows = {}
        for fid in hard:
            norm = normalize_card(load_image(os.path.join(FIXTURES, gt[fid]["image"])))
            q = model.embed([artwork_crop(fn(norm.image)), artwork_crop(fn(norm.rotated180))])
            rows[fid] = rank_report(q, matrix_c, ids_c, f"pt-BR|{gt[fid]['cardId']}")
        print(f"  crop+{variant:<12} hard ranks={[rows[f]['rank'] for f in hard]} "
              f"simTruth={[round(rows[f]['simTruth'], 3) for f in hard]}")

    with open(os.path.join(OUT_DIR, "probes.json"), "w", encoding="utf-8") as fh:
        json.dump({"photometric": {k: {f: v for f, v in r.items()} for k, r in photometric.items()}},
                  fh, ensure_ascii=False, indent=1, default=str)


def phase_analyze():
    meta = json.load(open(POOL_JSON))
    files = [f for f in os.listdir(OUT_DIR) if f.startswith("model-") and f.endswith(".json")]
    print(f"{'model':<24} {'n':>5} {'Top1':>5} {'Top5':>5} {'hardRanks':<28} {'embed s':>8}")
    for fname in sorted(files):
        d = json.load(open(os.path.join(OUT_DIR, fname)))
        hard_ranks = [d["rows"][f]["rank"] for f in meta["hard"]]
        top1 = sum(1 for f in d["rows"] if d["rows"][f]["rank"] == 1)
        top5 = sum(1 for f in d["rows"] if d["rows"][f]["rank"] <= 5)
        print(f"{d['name']:<24} {d['n']:>5} {top1:>5} {top5:>5} {str(hard_ranks):<28} {d['embedSeconds']:>8.1f}")
    if os.path.exists(os.path.join(OUT_DIR, "probes.json")):
        print("\nprobe details in probes.json / logs above")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["prep", "model", "probes", "analyze"])
    parser.add_argument("--name", default="dinov3-vits16")
    args = parser.parse_args()
    if args.phase == "prep":
        phase_prep()
    elif args.phase == "model":
        phase_model(args.name)
    elif args.phase == "probes":
        phase_probes()
    else:
        phase_analyze()


if __name__ == "__main__":
    main()
