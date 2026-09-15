# -*- coding: utf-8 -*-
"""Card detection, orientation and perspective rectification (OpenCV, CPU-fast).

Strategy
--------
1. Detect the card quad on a downscaled, edge-enhanced image:
   - contour-based largest near-convex quadrilateral (classic document scanner)
   - Hough-lines fallback when the card is partially cropped / low contrast
2. Order corners robustly and warp to a canonical 600x840 card.
3. Orientation (0/90/180/270):
   - 90/270 inferred from input aspect + quad geometry;
   - 0/180 cannot be inferred geometrically (text is horizontal either way):
     the caller embeds both orientations for retrieval and OCR tests both strips.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from .config import CARD_ASPECT, NORM_H, NORM_W


@dataclass
class NormalizedCard:
    image: np.ndarray          # BGR uint8, upright or 180-ambiguous
    rotated180: np.ndarray     # same card rotated 180 degrees
    rotation_code: int         # 0/90/180/270 applied to reach `image`
    method: str                # "quad-contour" | "quad-hough" | "aspect-fallback"
    confidence: float          # 0..1 quad detection confidence
    quad: Optional[np.ndarray] # 4x2 source corners in original image coords


def _ordered_corners(points: np.ndarray) -> np.ndarray:
    """Order 4 points as [top-left, top-right, bottom-right, bottom-left]."""
    pts = points.reshape(4, 2).astype(np.float32)
    d = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    tl = pts[int(np.argmin(d))]
    br = pts[int(np.argmax(d))]
    tr = pts[int(np.argmin(diff))]
    bl = pts[int(np.argmax(diff))]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def _quad_plausible(quad: np.ndarray) -> float:
    """Score how card-like a quadrilateral is (aspect + convexity + size)."""
    tl, tr, br, bl = quad
    wtop = float(np.linalg.norm(tr - tl))
    wbot = float(np.linalg.norm(br - bl))
    hleft = float(np.linalg.norm(bl - tl))
    hright = float(np.linalg.norm(br - tr))
    w = (wtop + wbot) / 2.0
    h = (hleft + hright) / 2.0
    if w <= 0 or h <= 0:
        return 0.0
    aspect = w / h
    aspect_score = max(0.0, 1.0 - abs(aspect - CARD_ASPECT) / 0.30)
    parallel = 1.0 - min(1.0, abs(wtop - wbot) / max(wtop, wbot, 1e-6))
    rectify = 1.0 - min(1.0, abs(hleft - hright) / max(hleft, hright, 1e-6))
    return float(0.55 * aspect_score + 0.25 * parallel + 0.20 * rectify)


def _detect_quad_contour(gray: np.ndarray) -> Optional[np.ndarray]:
    """Best quadrilateral across several binarization strategies.

    Real photos vary: glare kills Canny edges, dark desks make the card the
    brightest region (Otsu wins), uneven lighting favors adaptive thresholds.
    We score every plausible quad from every variant and keep the best.
    """
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    candidates: list[tuple[float, np.ndarray]] = []
    img_area = gray.shape[0] * gray.shape[1]

    edge_maps = []
    # (a) classic Canny on equalized gray
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    edge_maps.append(cv2.dilate(cv2.Canny(clahe, 40, 120), np.ones((3, 3), np.uint8)))
    # (b) Otsu bright-mask (card on darker scene)
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edge_maps.append(cv2.morphologyEx(otsu, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)))
    # (c) adaptive threshold gradients (uneven light)
    adaptive = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                      cv2.THRESH_BINARY, 31, -5)
    edge_maps.append(cv2.morphologyEx(adaptive, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)))

    for edges in edge_maps:
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < img_area * 0.08 or area > img_area * 0.99:
                continue
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
            if len(approx) != 4:
                # convex hull of large contours often closes glare-broken edges
                if area > img_area * 0.25:
                    hull = cv2.convexHull(contour)
                    approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
                if len(approx) != 4:
                    continue
            quad = _ordered_corners(approx)
            plausibility = _quad_plausible(quad)
            if plausibility < 0.35:
                continue  # not card-like at all
            # The card is the LARGEST card-like quad in a photo: area dominates,
            # plausibility refines. Inner boxes (attack text, artwork frame) are
            # smaller and must never beat the true card boundary.
            score = (plausibility ** 2) * ((area / img_area) ** 0.9)
            if score > 0.02:
                candidates.append((score, quad))
    if not candidates:
        return None
    candidates.sort(key=lambda item: -item[0])
    return candidates[0][1]


def _detect_quad_hough(gray: np.ndarray) -> Optional[np.ndarray]:
    """Hough-line intersection fallback for cropped/low-contrast cards."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    h, w = edges.shape
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180.0, threshold=max(40, w // 8),
                            minLineLength=min(w, h) // 3, maxLineGap=min(w, h) // 10)
    if lines is None:
        return None
    verticals, horizontals = [], []
    for x1, y1, x2, y2 in lines[:, 0]:
        dx, dy = float(x2 - x1), float(y2 - y1)
        length = math.hypot(dx, dy)
        if length < 1:
            continue
        angle = abs(math.degrees(math.atan2(dy, dx))) % 180.0
        if 80.0 <= angle <= 100.0:
            verticals.append((x1, y1, x2, y2))
        elif angle <= 12.0 or angle >= 168.0:
            horizontals.append((x1, y1, x2, y2))
    if len(verticals) < 2 or len(horizontals) < 2:
        return None

    def cluster(items: list[tuple]) -> list[tuple]:
        """Cluster parallel segments by midpoint offset; return the two extreme
        clusters as averaged lines (left/right or top/bottom)."""
        if len(items) < 2:
            return []
        ref = min(w, h)
        entries = []
        for seg in items:
            x1, y1, x2, y2 = seg
            # cluster axis: near-vertical segments -> x offset, near-horizontal -> y offset
            mid = ((x1 + x2) / 2.0) if abs(x2 - x1) < abs(y2 - y1) else ((y1 + y2) / 2.0)
            entries.append((mid, seg))
        entries.sort(key=lambda entry: entry[0])
        groups: list[list] = []  # each: [running_mid, [segments]]
        for mid, seg in entries:
            if groups and abs(mid - groups[-1][0]) < ref * 0.15:
                groups[-1][0] = (groups[-1][0] + mid) / 2.0
                groups[-1][1].append(seg)
            else:
                groups.append([mid, [seg]])
        if len(groups) < 2:
            return []

        def merge(group: list) -> tuple:
            segs = group[1]
            count = float(len(segs))
            return (
                sum(s[0] for s in segs) / count,
                sum(s[1] for s in segs) / count,
                sum(s[2] for s in segs) / count,
                sum(s[3] for s in segs) / count,
            )

        return [merge(groups[0]), merge(groups[-1])]

    vlines = cluster(verticals)
    hlines = cluster(horizontals)
    if len(vlines) < 2 or len(hlines) < 2:
        return None

    def inter(v, hh):
        vx1, vy1, vx2, vy2 = v
        hx1, hy1, hx2, hy2 = hh
        d = (vx2 - vx1) * (hy2 - hy1) - (vy2 - vy1) * (hx2 - hx1)
        if abs(d) < 1e-6:
            return None
        t = ((hx1 - vx1) * (hy2 - hy1) - (hy1 - vy1) * (hx2 - hx1)) / d
        return np.array([vx1 + t * (vx2 - vx1), vy1 + t * (vy2 - vy1)], dtype=np.float32)

    quad = []
    for v in vlines:
        for hh in hlines:
            p = inter(v, hh)
            if p is not None:
                quad.append(p)
    if len(quad) != 4:
        return None
    quad = _ordered_corners(np.array(quad))
    if _quad_plausible(quad) > 0.10:
        return quad
    return None


def _warp(src: np.ndarray, quad: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    return cv2.warpPerspective(src, matrix, (out_w, out_h), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)


def _rotate_bound(image: np.ndarray, code: int) -> np.ndarray:
    if code == 90:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if code == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if code == 270:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    return image


def gamma_auto(bgr: np.ndarray, target: float = 128.0) -> np.ndarray:
    """Gamma LUT that maps the mean luminance to `target`.

    Extreme low-light photos (mean brightness ~20-35) wreck global embeddings:
    the query lands far from every clean scan. Bake-off (2026-09-14) showed
    gamma-normalized queries rescue exactly those cases (e.g. rank 2 -> 1 on
    SigLIP2), while CLAHE/gray-world/pstretch alone do not.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    mean = float(np.clip(gray.mean(), 1e-3, 1.0))
    gamma = float(np.clip(np.log(target / 255.0) / np.log(mean), 0.2, 3.0))
    lut = (np.linspace(0, 1, 256) ** gamma * 255.0).astype(np.uint8)
    return cv2.LUT(bgr, lut)


def photometric_variants(bgr: np.ndarray) -> list[np.ndarray]:
    """Query-side views for retrieval: the raw card plus photometric normalizations.

    Retrieval takes the max similarity over views, so each variant can only
    help: raw wins on well-lit photos, gamma rescues dark/washed-out ones.
    """
    return [bgr, gamma_auto(bgr)]


def normalize_card(input_bgr: np.ndarray) -> NormalizedCard:
    """Detect the card, rectify perspective, and return the upright pair (0/180)."""
    image = input_bgr if input_bgr.ndim == 3 else cv2.cvtColor(input_bgr, cv2.COLOR_GRAY2BGR)
    h, w = image.shape[:2]
    scale = min(1.0, 900.0 / max(h, w))
    small = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1.0 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)

    quad, method, confidence = None, "", 0.0
    for detector, name in ((_detect_quad_contour, "quad-contour"), (_detect_quad_hough, "quad-hough")):
        quad = detector(gray)
        if quad is not None:
            method, confidence = name, _quad_plausible(quad)
            quad = quad / scale
            break

    rotation_code = 0
    if quad is not None:
        quad = _ordered_corners(quad)
        tl, tr, br, bl = quad
        width = np.linalg.norm(tr - tl)
        height = np.linalg.norm(bl - tl)
        # If the detected card is landscape in the source, the photo was rotated 90/270
        if width > height * 1.05:
            rotation_code = 90  # canonical orientation after rotating CCW
        warped = _warp(image, quad, NORM_W, NORM_H)
    else:
        method, confidence = "aspect-fallback", 0.0
        # center crop to card aspect
        ch, cw = image.shape[:2]
        crop_w = cw * 0.96
        crop_h = crop_w / CARD_ASPECT
        if crop_h > ch * 0.96:
            crop_h = ch * 0.96
            crop_w = crop_h * CARD_ASPECT
        if crop_w > cw * 0.96:
            crop_w = cw * 0.96
            crop_h = crop_w * CARD_ASPECT
        x0 = int((cw - crop_w) / 2)
        y0 = int((ch - crop_h) / 2)
        warped = image[y0:y0 + int(crop_h), x0:x0 + int(crop_w)]
        warped = cv2.resize(warped, (NORM_W, NORM_H), interpolation=cv2.INTER_CUBIC)

    upright = _rotate_bound(warped, rotation_code)
    return NormalizedCard(
        image=upright,
        rotated180=_rotate_bound(upright, 180),
        rotation_code=rotation_code,
        method=method,
        confidence=float(confidence),
        quad=quad,
    )
