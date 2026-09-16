# -*- coding: utf-8 -*-
"""Local feature extraction + geometric verification.

Matchers
--------
- sift    : OpenCV SIFT + ratio-test mutual NN + RANSAC homography (classic, CPU)
- akaze   : OpenCV AKAZE variant (faster, less robust)
- aliked  : ALIKED-n16 (ONNX) + LightGlue (ONNX) + RANSAC homography (learned)

Verification score for planar card matching: RANSAC inlier count and inlier
ratio on an estimated homography are near-conclusive evidence that the photo
and the official scan show the same physical print.
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import onnxruntime as ort

from .config import MODELS_DIR
from .ort_session import OrtSession

_SESSION_OPTS = ort.SessionOptions()
_SESSION_OPTS.intra_op_num_threads = max(1, (os.cpu_count() or 2))

_ALIKED_SIZE = 640


@dataclass
class Verification:
    inliers: int
    matches: int
    inlier_ratio: float
    reprojection_error: float
    homography: Optional[np.ndarray]
    method: str

    @property
    def score(self) -> float:
        """Composite geometric confidence in [0, 1].

        Strict saturation: an inlier ratio of 0.85+ and 100+ artwork inliers are
        the 'near-conclusive' regime; weaker matches must stay well below 1 so
        the fusion can discriminate the true print from frame-only lookalikes.
        """
        if self.matches < 8 or self.homography is None:
            return 0.0
        ratio_term = min(1.0, self.inlier_ratio / 0.85)
        count_term = min(1.0, self.inliers / 100.0)
        err_term = max(0.0, 1.0 - self.reprojection_error / 6.0)
        return float(0.50 * ratio_term + 0.30 * count_term + 0.20 * err_term)


# Artwork region of a normalized card (fractions): the unique part of a print.
# Frame/text layout is shared across cards and must not count as identity evidence.
ARTWORK_Y0, ARTWORK_Y1 = 0.09, 0.62
ARTWORK_X0, ARTWORK_X1 = 0.05, 0.95


def _artwork_filter(kpts: np.ndarray, width: int, height: int) -> np.ndarray:
    """Boolean mask of keypoints that fall inside the artwork band."""
    if width <= 0 or height <= 0 or len(kpts) == 0:
        return np.zeros(len(kpts), dtype=bool)
    x = kpts[:, 0] / width
    y = kpts[:, 1] / height
    return (x >= ARTWORK_X0) & (x <= ARTWORK_X1) & (y >= ARTWORK_Y0) & (y <= ARTWORK_Y1)


@dataclass
class SiftFeatures:
    """SIFT keypoints/descriptors of ONE image (prepped space).

    extract() and match_features() split the old match() so a query image is
    detected ONCE per request instead of once per candidate (the query used to
    be re-detected 4x on the fast path / 12x on the full path per probe
    orientation). Values are byte-identical to the old path: same detector,
    same prepping, same BFMatcher, same ratio test, same artwork filter.
    """
    kpts: np.ndarray  # [N, 2] float32 (x, y) in the prepped image space
    desc: np.ndarray  # [N, 128] float32 (or None when detection failed)
    width: int        # prepped image width (artwork filter reference)
    height: int       # prepped image height

    @property
    def nbytes(self) -> int:
        return int(self.kpts.nbytes + (self.desc.nbytes if self.desc is not None else 0))


class SiftMatcher:
    name = "sift"

    def __init__(self, max_keypoints: int = 2000, match_size: int = 512):
        self.detector = cv2.SIFT_create(nfeatures=max_keypoints)
        self.matcher = cv2.BFMatcher_create(normType=cv2.NORM_L2, crossCheck=False)
        self.match_size = match_size

    def _prep(self, image: np.ndarray) -> np.ndarray:
        h, w = image.shape[:2]
        scale = min(1.0, self.match_size / max(h, w))
        if scale >= 1.0:
            return image
        return cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    def extract(self, image: np.ndarray) -> SiftFeatures:
        """Detect+describe once; reusable across any number of comparisons."""
        prep = self._prep(image)
        gray = cv2.cvtColor(prep, cv2.COLOR_BGR2GRAY)
        kpts, desc = self.detector.detectAndCompute(gray, None)
        if desc is None or len(kpts) == 0:
            return SiftFeatures(np.zeros((0, 2), dtype=np.float32), np.zeros((0, 128), dtype=np.float32),
                                int(prep.shape[1]), int(prep.shape[0]))
        kpts_xy = np.array([kp.pt for kp in kpts], dtype=np.float32)
        return SiftFeatures(kpts_xy, desc, int(prep.shape[1]), int(prep.shape[0]))

    def match_features(self, a: SiftFeatures, b: SiftFeatures) -> Verification:
        """Ratio-test + artwork filter + RANSAC on PRECOMPUTED features.

        Byte-identical results to the old match(image_a, image_b): the ops and
        their order are unchanged, only the redundant re-detection is gone."""
        if a.desc is None or b.desc is None or len(a.kpts) < 8 or len(b.kpts) < 8:
            return Verification(0, 0, 0.0, 999.0, None, self.name)
        raw = self.matcher.knnMatch(a.desc, b.desc, k=2)
        good = []
        for pair in raw:
            if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance:
                good.append(pair[0])
        if len(good) < 8:
            return Verification(len(good), len(good), 0.0, 999.0, None, self.name)
        pts_a = a.kpts[[m.queryIdx for m in good]]
        pts_b = b.kpts[[m.trainIdx for m in good]]
        # Only artwork-band matches count as identity evidence: trainer/item/energy
        # cards share the outer frame and text layout, which otherwise produces
        # convincing homographies on the WRONG card.
        mask = _artwork_filter(pts_a, a.width, a.height) & \
               _artwork_filter(pts_b, b.width, b.height)
        if int(mask.sum()) < 8:
            return Verification(0, len(good), 0.0, 999.0, None, self.name)
        return _ransac_verify(pts_a[mask], pts_b[mask], int(mask.sum()), self.name)

    def match(self, image_a: np.ndarray, image_b: np.ndarray) -> Verification:
        return self.match_features(self.extract(image_a), self.extract(image_b))


class AkazeMatcher:
    name = "akaze"

    def __init__(self):
        self.detector = cv2.AKAZE_create()
        self.matcher = cv2.BFMatcher_create(normType=cv2.NORM_HAMMING, crossCheck=False)

    def match(self, image_a: np.ndarray, image_b: np.ndarray) -> Verification:
        gray_a = cv2.cvtColor(image_a, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(image_b, cv2.COLOR_BGR2GRAY)
        ka, da = self.detector.detectAndCompute(gray_a, None)
        kb, db = self.detector.detectAndCompute(gray_b, None)
        if da is None or db is None or len(ka) < 8 or len(kb) < 8:
            return Verification(0, 0, 0.0, 999.0, None, self.name)
        raw = self.matcher.knnMatch(da, db, k=2)
        good = [p[0] for p in raw if len(p) == 2 and p[0].distance < 0.80 * p[1].distance]
        if len(good) < 8:
            return Verification(len(good), len(good), 0.0, 999.0, None, self.name)
        return _ransac_verify(
            np.array([ka[m.queryIdx].pt for m in good], dtype=np.float32),
            np.array([kb[m.trainIdx].pt for m in good], dtype=np.float32),
            len(good), self.name)


def _ransac_verify(pts_a: np.ndarray, pts_b: np.ndarray, n_matches: int, method: str) -> Verification:
    homography, mask = cv2.findHomography(pts_a, pts_b, cv2.RANSAC,
                                           ransacReprojThreshold=4.0, maxIters=5000, confidence=0.999)
    if homography is None or mask is None:
        return Verification(0, n_matches, 0.0, 999.0, None, method)
    inliers = int(mask.sum())
    if inliers < 4:
        return Verification(0, n_matches, 0.0, 999.0, None, method)
    src = pts_a[mask.ravel() == 1].reshape(-1, 1, 2)
    dst = pts_b[mask.ravel() == 1].reshape(-1, 1, 2)
    proj = cv2.perspectiveTransform(src, homography)
    err = float(np.median(np.linalg.norm(proj.reshape(-1, 2) - dst.reshape(-1, 2), axis=1)))
    # Reject degenerate homographies (near-zero determinant / extreme warps)
    det = float(np.linalg.det(homography[:2, :2]))
    if not (0.05 < abs(det) < 20.0):
        return Verification(0, n_matches, 0.0, 999.0, None, method)
    return Verification(inliers, n_matches, inliers / max(1, n_matches), err, homography, method)


class AlikedLightGlueMatcher:
    """ALIKED-n16 keypoint/descriptor ONNX + LightGlue ONNX matcher."""

    name = "aliked-lightglue"
    _instance = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._aliked: Optional[OrtSession] = None
        self._lightglue: Optional[OrtSession] = None
        self._lock = threading.Lock()

    def _ensure(self):
        if self._aliked is not None:
            return
        with self._lock:
            if self._aliked is not None:
                return
            # OrtSession: DirectML-safe options + serialized Run when the
            # session really runs on DML (official EP constraints).
            self._aliked = OrtSession(os.path.join(MODELS_DIR, "aliked-n16-top1k-640.onnx"))
            self._lightglue = OrtSession(os.path.join(MODELS_DIR, "lightglue-aliked.onnx"))

    @staticmethod
    def _prep(image: np.ndarray) -> np.ndarray:
        resized = cv2.resize(image, (_ALIKED_SIZE, _ALIKED_SIZE), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - np.array([0.5, 0.5, 0.5], dtype=np.float32)) / np.array([0.5, 0.5, 0.5], dtype=np.float32)
        return np.ascontiguousarray(np.transpose(rgb, (2, 0, 1))[np.newaxis], dtype=np.float32)

    def _extract(self, image: np.ndarray):
        self._ensure()
        kpts, desc, scores = self._aliked.run(None, {"image": self._prep(image)})
        # keypoints are in 640x640 space -> map to original image space
        h, w = image.shape[:2]
        scale_x = w / _ALIKED_SIZE
        scale_y = h / _ALIKED_SIZE
        kpts = kpts.astype(np.float32) * np.array([scale_x, scale_y], dtype=np.float32)
        order = np.argsort(-scores, kind="stable")
        return kpts[order], desc[order].astype(np.float32)

    def match(self, image_a: np.ndarray, image_b: np.ndarray) -> Verification:
        kpts_a, desc_a = self._extract(image_a)
        kpts_b, desc_b = self._extract(image_b)
        if len(kpts_a) < 8 or len(kpts_b) < 8:
            return Verification(0, 0, 0.0, 999.0, None, self.name)
        matches0, mscores = self._lightglue.run(None, {
            "kpts0": kpts_a[np.newaxis].astype(np.float32),
            "kpts1": kpts_b[np.newaxis].astype(np.float32),
            "desc0": desc_a[np.newaxis].astype(np.float32),
            "desc1": desc_b[np.newaxis].astype(np.float32),
        })
        # matches0: [N,2] (index in a, index in b); mscores: matching scores
        if matches0.shape[0] < 8:
            return Verification(0, int(matches0.shape[0]), 0.0, 999.0, None, self.name)
        idx_a = matches0[:, 0]
        idx_b = matches0[:, 1]
        keep = mscores > 0.2
        if keep.sum() < 8:
            keep = np.ones_like(keep, dtype=bool)
        pts_a = kpts_a[idx_a[keep]]
        pts_b = kpts_b[idx_b[keep]]
        return _ransac_verify(pts_a.astype(np.float32), pts_b.astype(np.float32), int(keep.sum()), self.name)


def get_matcher(name: str):
    if name == "sift":
        return SiftMatcher()
    if name == "akaze":
        return AkazeMatcher()
    if name == "aliked-lightglue":
        if AlikedLightGlueMatcher._instance is None:
            with AlikedLightGlueMatcher._instance_lock:
                if AlikedLightGlueMatcher._instance is None:
                    AlikedLightGlueMatcher._instance = AlikedLightGlueMatcher()
        return AlikedLightGlueMatcher._instance
    raise ValueError(f"Unknown matcher {name}")
