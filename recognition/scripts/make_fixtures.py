#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate reproducible synthetic "photo-like" fixtures from official scans.

Real user photos live in benchmarks/card-recognition/private/ on the user's PC
(gitignored). This generator produces an equivalent *development* benchmark by
degrading official scans with the failure modes observed in production:

- perspective warp + tilt           - glare / specular highlights
- sleeve gloss (color cast + bloom) - shadow gradient
- rotation 0/90/180/270             - blur (motion + defocus)
- noise + JPEG artifacts            - low light + exposure swing
- partial crop                      - background scene around the card

It also emits the mandatory regression fixtures:
- shroodle-escia      : Shroodle whose OCR route is fed garbage ("escia")
- dragonair-wrong-ocr : Dragonair with a wrong OCR number (must NOT become Parasect)
- rotated-180         : card upside down
- languages           : pt-BR, en, ja
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.catalog import ensure_scan, init_db, load_cards

SEED = 20260915


def load_scan_bgr(path: str) -> np.ndarray | None:
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def resize_to_norm(image: np.ndarray, w: int = 600, h: int = 840) -> np.ndarray:
    return cv2.resize(image, (w, h), interpolation=cv2.INTER_AREA)


def perspective(image: np.ndarray, strength: float, rng: random.Random) -> np.ndarray:
    h, w = image.shape[:2]
    k = strength * 0.28 * min(w, h)
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    dst = np.array([
        [rng.uniform(0, k), rng.uniform(0, k)],
        [w - 1 - rng.uniform(0, k), rng.uniform(0, k)],
        [w - 1 - rng.uniform(0, k), h - 1 - rng.uniform(0, k)],
        [rng.uniform(0, k), h - 1 - rng.uniform(0, k)],
    ], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, matrix, (w, h), borderValue=(24, 22, 20))


def tilt(image: np.ndarray, degrees: float) -> np.ndarray:
    h, w = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return cv2.warpAffine(image, matrix, (w, h), borderValue=(24, 22, 20))


def glare(image: np.ndarray, rng: random.Random, strength: float = 1.0) -> np.ndarray:
    h, w = image.shape[:2]
    result = image.astype(np.float32)
    for _ in range(rng.randint(1, 3)):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        radius = rng.uniform(0.12, 0.42) * min(w, h)
        intensity = rng.uniform(60, 190) * strength
        yy, xx = np.mgrid[0:h, 0:w]
        mask = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * (radius / 2.2) ** 2))
        for c in range(3):
            result[:, :, c] = np.clip(result[:, :, c] + intensity * mask, 0, 255)
    return result.astype(np.uint8)


def sleeve_gloss(image: np.ndarray, rng: random.Random) -> np.ndarray:
    result = image.astype(np.float32)
    tint = np.array([rng.uniform(-14, 22), rng.uniform(-10, 16), rng.uniform(-16, 26)], dtype=np.float32)
    result += tint
    # soft bloom on bright areas
    bright = np.clip(result - 190, 0, None) * 0.35
    result += bright
    return np.clip(result, 0, 255).astype(np.uint8)


def shadow_gradient(image: np.ndarray, rng: random.Random) -> np.ndarray:
    h, w = image.shape[:2]
    angle = rng.uniform(0, np.pi)
    gradient = np.linspace(-0.45, 0.45, max(w, h))
    field = np.zeros((h, w), dtype=np.float32)
    if angle < np.pi / 2:
        field += gradient[:w][None, :]
    else:
        field += gradient[:h][:, None]
    strength = rng.uniform(0.25, 0.75)
    result = image.astype(np.float32) * (1.0 - strength * (field * 0.5 + 0.5)[..., None])
    return np.clip(result, 0, 255).astype(np.uint8)


def low_light(image: np.ndarray, rng: random.Random) -> np.ndarray:
    factor = rng.uniform(0.35, 0.62)
    result = (image.astype(np.float32) * factor)
    result += rng.uniform(0, 12)
    return np.clip(result, 0, 255).astype(np.uint8)


def blur(image: np.ndarray, rng: random.Random) -> np.ndarray:
    choice = rng.random()
    if choice < 0.5:
        k = rng.choice([3, 5, 7])
        return cv2.GaussianBlur(image, (k, k), 0)
    kernel = np.zeros((9, 9), dtype=np.float32)
    kernel[4, :] = 1.0 / 9.0  # horizontal motion blur
    return cv2.filter2D(image, -1, kernel)


def noise_jpeg(image: np.ndarray, rng: random.Random) -> np.ndarray:
    sigma = rng.uniform(2, 9)
    noisy = np.clip(image.astype(np.float32) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, sigma, image.shape), 0, 255).astype(np.uint8)
    quality = rng.randint(55, 88)
    ok, encoded = cv2.imencode(".jpg", noisy, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR) if ok else noisy


def crop_partial(image: np.ndarray, rng: random.Random) -> np.ndarray:
    h, w = image.shape[:2]
    frac = rng.uniform(0.04, 0.13)
    top = rng.random() < 0.5
    left = rng.random() < 0.5
    y0 = int(h * frac) if top else 0
    y1 = h if top else int(h * (1 - frac))
    x0 = int(w * frac) if left else 0
    x1 = w if left else int(w * (1 - frac))
    return image[y0:y1, x0:x1]


def scene_background(image: np.ndarray, rng: random.Random) -> np.ndarray:
    """Place the card on a plausible desk scene (card seen from slightly above)."""
    h, w = image.shape[:2]
    scale = rng.uniform(0.86, 0.97)
    cw, ch = int(w * scale), int(h * scale)
    card = cv2.resize(image, (cw, ch), interpolation=cv2.INTER_AREA)
    canvas_h, canvas_w = int(ch * 1.3), int(cw * 1.35)
    base = np.full((canvas_h, canvas_w, 3), (28, 24, 20), dtype=np.uint8)
    # wood-ish texture
    noise = np.random.default_rng(rng.randrange(1 << 30)).normal(0, 6, (canvas_h, canvas_w, 1))
    base = np.clip(base.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    y0 = (canvas_h - ch) // 2 + rng.randint(-12, 12)
    x0 = (canvas_w - cw) // 2 + rng.randint(-12, 12)
    y0, x0 = max(0, min(canvas_h - ch, y0)), max(0, min(canvas_w - cw, x0))
    # soft shadow under the card, computed on the full canvas
    full_mask = np.zeros((canvas_h, canvas_w), dtype=np.float32)
    full_mask[y0:y0 + ch, x0:x0 + cw] = 1.0
    shadow = cv2.GaussianBlur(full_mask, (63, 63), 0)
    base = (base.astype(np.float32) * (0.80 + 0.20 * shadow[..., None])).astype(np.uint8)
    base[y0:y0 + ch, x0:x0 + cw] = card
    return base


DEGRADATIONS = [glare, sleeve_gloss, shadow_gradient, low_light, blur, noise_jpeg]


def degrade(scan_bgr: np.ndarray, level: str, rng: random.Random) -> np.ndarray:
    image = resize_to_norm(scan_bgr)
    if level == "clean":
        return noise_jpeg(image, rng)
    if level == "hard":
        image = scene_background(perspective(image, 0.8, rng), rng)
        image = tilt(image, rng.uniform(-7, 7))
        for fn in DEGRADATIONS:
            image = fn(image, rng)
        if rng.random() < 0.5:
            image = crop_partial(image, rng)
        return image
    # normal
    image = scene_background(perspective(image, 0.45, rng), rng)
    image = tilt(image, rng.uniform(-4, 4))
    for fn in rng.sample(DEGRADATIONS, k=rng.randint(2, 4)):
        image = fn(image, rng)
    return image


def rotate(image: np.ndarray, code: int) -> np.ndarray:
    return {
        90: cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE),
        180: cv2.rotate(image, cv2.ROTATE_180),
        270: cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE),
    }.get(code, image)


def card_key(card) -> str:
    return f"{card.language}|{card.id}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/fixtures")
    parser.add_argument("--count", type=int, default=120)
    parser.add_argument("--hard-frac", type=float, default=0.3)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--only-local", action="store_true",
                        help="use only cards whose scans are already cached locally")
    parser.add_argument("--languages", default="pt-BR,en,ja")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    conn = init_db()
    languages = [x.strip() for x in args.languages.split(",") if x.strip()]
    pools = {}
    full = {}
    for language in languages:
        cards = load_cards(conn, [language])
        full[language] = cards
        if args.only_local:
            from recognizer.catalog import scan_path
            cards = [c for c in cards if os.path.exists(scan_path(c.image_base, "high.webp"))]
        pools[language] = cards
    all_pt = full["pt-BR"]      # anchors search the full pool (their scans download on demand)
    pt_local = pools.get("pt-BR", [])
    all_en = full.get("en", [])
    all_ja = full.get("ja", [])

    # mandatory regression anchors
    def find(cards, name, prefer_set=None):
        pool = [c for c in cards if c.name.lower() == name.lower()]
        if not pool:
            pool = [c for c in cards if name.lower() in c.name.lower()]
        if prefer_set:
            pool = sorted(pool, key=lambda c: c.set_id != prefer_set)
        return pool[0] if pool else None

    shroodle = find(all_pt, "Shroodle", "me01")  # noqa: kept for clarity of the anchors below
    en_sample = rng.sample(all_en, min(12, len(all_en))) if all_en else []
    ja_sample = rng.sample(all_ja, min(6, len(all_ja))) if all_ja else []

    anchors = []
    for card, tag, extra in [
        (find(all_pt, "Shroodle", "me01"), "shroodle-escia", {"ocr_override": {"name": "escia"}, "note": "OCR lê lixo; rota visual deve achar Shroodle"}),
        (find(all_pt, "Shroodle", "me01"), "shroodle-normal", None),
        (find(all_pt, "Dragonair"), "dragonair-wrong-number", {"ocr_override": {"cardNumber": "7/99"}, "note": "número errado não pode virar Parasect"}),
        (find(all_pt, "Parasect"), "parasect-decoy", None),
        (find(all_pt, "Pikachu"), "pikachu-rot180", {"rotate": 180}),
        (find(all_pt, "Charizard"), "charizard-rot90", {"rotate": 90}),
        (find(all_pt, "Shroodle", "me01"), "shroodle-hard", {"level": "hard"}),
        (find(all_en, "Shroodle"), "shroodle-en", None),
        (find(all_en, "Dragonair"), "dragonair-en", None),
    ]:
        if card is not None:
            anchors.append((card, tag, extra or {}))
    for card in en_sample + ja_sample:
        anchors.append((card, f"lang-{card.language}-{card.id}", {}))

    # random population from the available pools
    anchor_keys = {(a[0].language, a[0].id) for a in anchors}
    population = [c for c in pt_local if (c.language, c.id) not in anchor_keys]
    rng.shuffle(population)
    chosen = anchors + [(c, f"rand-{i:03d}-{card_key(c)}", {}) for i, c in enumerate(population[: args.count])]

    os.makedirs(args.out, exist_ok=True)
    entries = []
    for card, tag, extra in chosen:
        path = ensure_scan(card.image_base, "high.webp")
        if not path:
            continue
        scan = load_scan_bgr(path)
        if scan is None:
            continue
        level = extra.get("level") or ("hard" if rng.random() < args.hard_frac else "normal")
        photo = degrade(scan, level, rng)
        rotation = extra.get("rotate", 0)
        if rotation:
            photo = rotate(photo, rotation)
        filename = f"{tag}.jpg"
        out_file = os.path.join(args.out, filename)
        cv2.imwrite(out_file, photo, [cv2.IMWRITE_JPEG_QUALITY, 90])
        entries.append({
            "fixtureId": tag,
            "cardId": card.id,
            "name": card.name,
            "set": card.set_name,
            "set_id": card.set_id,
            "cardNumber": f"{card.local_id}/{card.denominator}" if card.denominator else card.local_id,
            "localId": card.local_id,
            "language": card.language,
            "level": level,
            "rotation": rotation,
            "image": filename,
            **({"ocrOverride": extra["ocr_override"]} if extra.get("ocr_override") else {}),
            **({"note": extra["note"]} if extra.get("note") else {}),
        })
    gt_path = os.path.join(args.out, "ground-truth.json")
    with open(gt_path, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, indent=2)
    print(f"[fixtures] {len(entries)} fixtures -> {gt_path}")
    langs = {}
    for e in entries:
        langs[e["language"]] = langs.get(e["language"], 0) + 1
    print(f"[fixtures] languages: {langs}")


if __name__ == "__main__":
    main()
