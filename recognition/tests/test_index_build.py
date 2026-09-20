#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_index checkpoint hygiene: NaN/inf rows must never survive a resume.

Run:  python -m unittest discover -s tests -v   (from recognition/)
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.build_index import _load_checkpoint


class TestCheckpointSanitation(unittest.TestCase):
    def _write(self, tmp: str, matrix: np.ndarray, ids: list[str], next_id: int | None) -> str:
        path = os.path.join(tmp, "model.npz")
        if next_id is None:
            np.savez(path, matrix=matrix, ids=np.array(ids, dtype=object))
        else:
            np.savez(path, matrix=matrix, ids=np.array(ids, dtype=object), next_id=np.int64(next_id))
        return path

    def test_non_finite_checkpoint_rows_are_dropped_on_resume(self):
        # A checkpoint written by an older build (or a GPU float quirk) may
        # contain NaN/inf rows. A resume must drop them so the rebuilt index
        # never carries poison forward — the affected cards are simply
        # re-embedded ("missing" again).
        with tempfile.TemporaryDirectory() as tmp:
            matrix = np.zeros((4, 3), dtype=np.float32)
            matrix[0] = [1.0, 0.0, 0.0]
            matrix[1, 1] = np.nan
            matrix[2] = [0.0, 1.0, 0.0]
            matrix[3, 0] = np.inf
            path = self._write(tmp, matrix, ["pt|a", "pt|b", "en|c", "en|d"], 4)
            ids, existing, prefix = _load_checkpoint(path)
            self.assertEqual(ids, ["pt|a", "en|c"])
            self.assertEqual(sorted(existing), sorted(["pt|a", "en|c"]))
            self.assertTrue(np.isfinite(prefix).all())
            self.assertEqual(prefix.shape, (2, 3))

    def test_valid_checkpoint_is_loaded_verbatim(self):
        with tempfile.TemporaryDirectory() as tmp:
            matrix = np.eye(2, dtype=np.float32)
            path = self._write(tmp, matrix, ["pt|a", "pt|b"], 2)
            ids, existing, prefix = _load_checkpoint(path)
            self.assertEqual(ids, ["pt|a", "pt|b"])
            self.assertTrue(np.array_equal(prefix, matrix))

    def test_shape_mismatch_is_still_discarded(self):
        # ids(4) != next_id(3): the id list promises more than the matrix
        # delivered — an interrupted write. The checkpoint is truncated to
        # what both agree on.
        with tempfile.TemporaryDirectory() as tmp:
            matrix = np.zeros((3, 3), dtype=np.float32)
            path = self._write(tmp, matrix, ["pt|a", "pt|b", "en|c", "en|d"], 3)
            ids, existing, prefix = _load_checkpoint(path)
            self.assertEqual(len(ids), 3)
            self.assertEqual(prefix.shape[0], 3)


if __name__ == "__main__":
    unittest.main()
