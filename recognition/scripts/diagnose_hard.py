#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Degradation metrics for the hard fixtures vs normal ones (cause attribution D)."""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from recognizer.normalize import normalize_card

FIX = "data/fixtures"
HARD = ["rand-028-pt-BR|sm3-104", "rand-055-pt-BR|swsh9-138", "rand-077-pt-BR|sm1-82",
        "rand-078-pt-BR|sv08-052", "rand-086-pt-BR|sv03.5-066", "rand-045-pt-BR|sv07-107",
        "rand-080-pt-BR|swsh4.5-30"]
NORMAL = ["shroodle-normal", "charizard-rot90", "rand-001-pt-BR|xy4-73"]


def variance_of_laplacian(gray):
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def metrics(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bright = float(gray.mean())
    contrast = float(gray.std())
    blur = variance_of_laplacian(gray)
    # glare: fraction of pixels > 240
    glare_frac = float((gray > 240).mean())
    # dark: fraction < 40
    dark_frac = float((gray < 40).mean())
    # saturation mean (color cast indicator)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sat = float(hsv[..., 1].mean())
    return dict(bright=round(bright, 1), contrast=round(contrast, 1), blurLap=round(blur, 1),
                glareFrac=round(glare_frac, 4), darkFrac=round(dark_frac, 4), sat=round(sat, 1))


def main():
    gt = {e["fixtureId"]: e for e in json.load(open(f"{FIX}/ground-truth.json"))}
    print(f"{'fixture':<38} {'bright':>7} {'contrast':>8} {'blurLap':>8} {'glare':>7} {'dark':>7} {'sat':>6}  method")
    for group, ids in (("HARD", HARD), ("NORM", NORMAL)):
        for fid in ids + ([] if group == "HARD" else []):
            if fid not in gt:
                continue
            img = cv2.imdecode(np.fromfile(os.path.join(FIX, gt[fid]["image"]), dtype=np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            m = metrics(img)
            norm = normalize_card(img)
            print(f"{fid:<38} {m['bright']:>7} {m['contrast']:>8} {m['blurLap']:>8} {m['glareFrac']:>7} "
                  f"{m['darkFrac']:>7} {m['sat']:>6}  {norm.method}/{norm.confidence:.2f}")
            # also on the normalized card
            mn = metrics(norm.image)
            print(f"{'  -> normalized':<38} {mn['bright']:>7} {mn['contrast']:>8} {mn['blurLap']:>8} {mn['glareFrac']:>7} "
                  f"{mn['darkFrac']:>7} {mn['sat']:>6}")


if __name__ == "__main__":
    main()
