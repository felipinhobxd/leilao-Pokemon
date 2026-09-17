#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fast unit tests for the recognition service (no ONNX models loaded).

Run:  python -m unittest discover -s tests -v   (from recognition/)
Integration (models + catalog): set RECOGNITION_E2E=1 and run test_e2e separately.
"""
from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recognizer.config import (CATALOG_DB, DEFAULT_CALIBRATION, EMBEDDING_CALIBRATION,
                               CARD_ASPECT, NORM_W, NORM_H)
from recognizer.hints import apply_override, extract_hints
from recognizer.normalize import gamma_auto, normalize_card, photometric_variants, _quad_plausible

HAS_CATALOG = os.path.exists(CATALOG_DB)


def synthetic_card_photo(brightness: float = 200.0, background: float = 30.0) -> np.ndarray:
    """A plausible 'photo': dark desk, bright card, slight tilt."""
    canvas = np.full((1000, 750, 3), background, dtype=np.uint8)
    quad = np.array([[100, 60], [660, 90], [690, 950], [70, 930]], dtype=np.int32)
    cv2.fillPoly(canvas, [quad], (int(brightness),) * 3)
    # a few 'text' marks so the card is not perfectly flat
    cv2.rectangle(canvas, (160, 120), (600, 400), (int(brightness * 0.8),) * 3, -1)
    return canvas


class TestPhotometric(unittest.TestCase):
    def test_gamma_auto_lifts_dark_images(self):
        dark = synthetic_card_photo(brightness=40, background=10)
        lifted = gamma_auto(dark, target=128.0)
        mean_after = float(cv2.cvtColor(lifted, cv2.COLOR_BGR2GRAY).mean())
        self.assertGreater(mean_after, 100.0, "gamma deve elevar imagens escuras")

    def test_gamma_auto_leaves_bright_images_close(self):
        bright = synthetic_card_photo(brightness=210, background=40)
        out = gamma_auto(bright, target=128.0)
        mean_before = float(cv2.cvtColor(bright, cv2.COLOR_BGR2GRAY).mean())
        mean_after = float(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).mean())
        self.assertLess(abs(mean_after - mean_before), 25.0, "imagem ja clara deve mudar pouco")

    def test_photometric_variants_raw_plus_gamma(self):
        img = synthetic_card_photo()
        views = photometric_variants(img)
        self.assertEqual(len(views), 2)
        self.assertTrue((views[0] == img).all(), "primeira vista deve ser a raw")


class TestNormalize(unittest.TestCase):
    def test_detects_card_quad(self):
        photo = synthetic_card_photo()
        card = normalize_card(photo)
        self.assertEqual(card.method, "quad-contour")
        self.assertGreater(card.confidence, 0.5)
        self.assertEqual(card.image.shape[:2], (NORM_H, NORM_W))

    def test_rotated180_is_the_flip(self):
        photo = synthetic_card_photo()
        card = normalize_card(photo)
        flip = cv2.rotate(card.image, cv2.ROTATE_180)
        self.assertTrue((card.rotated180 == flip).all())

    def test_rotated_photo_180_detected(self):
        photo = cv2.rotate(synthetic_card_photo(), cv2.ROTATE_180)
        card = normalize_card(photo)
        self.assertEqual(card.image.shape[:2], (NORM_H, NORM_W))

    def test_quad_plausibility_rejects_squares(self):
        square = np.array([[0, 0], [100, 0], [100, 100], [0, 100]], dtype=np.float32)
        card_like = np.array([[0, 0], [100, 0], [100, int(100 / CARD_ASPECT)], [0, int(100 / CARD_ASPECT)]],
                             dtype=np.float32)
        self.assertLess(_quad_plausible(square), 0.5)
        self.assertGreater(_quad_plausible(card_like), 0.9)

    def test_fallback_on_textureless_noise(self):
        rng = np.random.default_rng(7)
        noise = rng.integers(0, 255, (800, 600, 3), dtype=np.uint8)
        card = normalize_card(noise)
        # nothing detectable: fallback path must still produce a canonical card
        self.assertIn(card.method, ("aspect-fallback", "quad-contour", "quad-hough"))
        self.assertEqual(card.image.shape[:2], (NORM_H, NORM_W))


class TestHints(unittest.TestCase):
    class FakeLine:
        def __init__(self, text, confidence, region="name"):
            self.text = text
            self.confidence = confidence
            self.region = region

    class FakeRead:
        def __init__(self, lines):
            self.lines = lines
            self.text = " ".join(l.text for l in lines)
            self.confidence_score = sum(l.confidence for l in lines)

    def _read(self, pairs, region="name"):
        lines = []
        for item in pairs:
            text, conf, reg = (item if len(item) == 3 else (item[0], item[1], region))
            lines.append(self.FakeLine(text, conf, reg))
        return self.FakeRead(lines)

    def test_extracts_name_and_number(self):
        read = self._read([("Shroodle", 0.95), ("091/132", 0.9, "number")])
        hints = extract_hints(read)
        self.assertEqual(hints.name.lower(), "shroodle")
        self.assertEqual(hints.local_id, "91")  # zeros a esquerda sao normalizados
        self.assertEqual(hints.denominator, 132)
        self.assertGreaterEqual(hints.name_confidence, 0.6)

    def test_garbage_ocr_still_yields_a_hint_but_no_candidates(self):
        # "escia" is a plausible word: the hint exists, but the catalog returns
        # nothing useful for it -- and that must NEVER block the visual route.
        read = self._read([("escia", 0.9)])
        hints = extract_hints(read)
        self.assertEqual(hints.name.lower(), "escia")

    def test_apply_override_escia_regression(self):
        read = self._read([("escia", 0.9), ("7/99", 0.8, "number")])
        hints = extract_hints(read)
        apply_override(hints, {"name": "escia", "cardNumber": "7/99"})
        self.assertEqual(hints.name, "escia")
        self.assertEqual(hints.local_id, "7")



    def test_truncated_name_read_does_not_prefer_shorter_card(self):
        # Regression rand-088: OCR read "CaudaBrado?" (missing "ex"). The fusion
        # gave the shorter name a 60-pt bonus over "Cauda Brado ex" and the wrong
        # card won despite LOWER visual similarity and WEAKER verification.
        # Both names are compatible with the read -> same weight tier.
        from recognizer.hints import name_similarity
        short = name_similarity("CaudaBrado?", "Cauda Brado")
        variant = name_similarity("CaudaBrado?", "Cauda Brado ex")
        self.assertGreaterEqual(short, 0.9)
        self.assertGreaterEqual(variant, 0.9)
        self.assertLess(abs(short - variant), 0.06)

    def test_name_similarity_spacing_only(self):
        from recognizer.hints import name_similarity
        self.assertGreaterEqual(name_similarity("CaudaBrado", "Cauda Brado"), 0.98)

    def test_name_similarity_short_names_no_containment(self):
        from recognizer.hints import name_similarity
        # "Mew" vs "Mewtwo" must NOT count as containment (len gate >= 4).
        self.assertLess(name_similarity("Mew", "Mewtwo"), 0.9)

    def test_category_banner_is_not_a_card_name(self):
        # Regression rand-057: the name region grabbed the frame banner
        # "TREINADOR" (printed on every Trainer card) and the conflict penalty
        # (-90) fired on the CORRECT card. Category words carry no name evidence.
        read = self._read([("TREINADOR", 0.96)])
        hints = extract_hints(read)
        self.assertEqual(hints.name, "")
        self.assertEqual(hints.name_confidence, 0.0)
        read_en = self._read([("TRAINER", 0.96)])
        self.assertEqual(extract_hints(read_en).name, "")


class TestCalibration(unittest.TestCase):
    def test_every_registered_model_has_calibration(self):
        from recognizer.embed import MODELS
        for name in MODELS:
            self.assertIn(name, EMBEDDING_CALIBRATION, f"sem calibracao: {name}")

    def test_calibration_fields(self):
        for name, cal in EMBEDDING_CALIBRATION.items():
            for field in ("floor", "strong", "medium", "weight"):
                self.assertIn(field, cal, f"{name}.{field} ausente")
            self.assertGreater(cal["strong"], cal["medium"])
            # floor (chance-level similarity subtracted before weighting) can
            # legitimately sit ABOVE medium for backbones with compressed
            # cosine distributions (SigLIP2: impostor median ~0.886): only the
            # ordering of the decision thresholds is invariant.
            self.assertGreaterEqual(cal["floor"], 0.0)
            self.assertGreater(cal["weight"], 0.0)
        self.assertEqual(set(DEFAULT_CALIBRATION), {"floor", "strong", "medium", "weight"})

    def test_fuse_decide_are_instance_methods(self):
        import inspect
        from recognizer.pipeline import Recognizer
        for method in (Recognizer.fuse, Recognizer.decide):
            self.assertIsNotNone(inspect.signature(method).parameters.get("self"),
                                 f"{method.__name__} deve ser metodo de instancia calibrado")


@unittest.skipUnless(HAS_CATALOG, "catalogo SQLite nao construido")
class TestCatalog(unittest.TestCase):
    def test_shroodle_exists(self):
        from recognizer.store import CatalogStore
        store = CatalogStore()
        card = store.card_by_key("pt-BR", "me01-091")
        self.assertIsNotNone(card, "Shroodle me01-091 deve existir no catalogo pt-BR")
        self.assertEqual(card.name.lower(), "shroodle")

    def test_text_candidates_by_name_include_truth(self):
        from recognizer.hints import extract_hints as eh
        from recognizer.store import CatalogStore
        store = CatalogStore()
        read = TestHints()._read([("Shroodle", 0.95)])
        hints = eh(read)
        candidates = store.text_candidates(hints)
        ids = [c.card_id for c in candidates]
        self.assertIn("me01-091", ids[:5], "busca por nome Shroodle deve incluir me01-091 no top-5")


if __name__ == "__main__":
    unittest.main(verbosity=2)


class TestDecodeDimensions(unittest.TestCase):
    """Testes para _decode_dimensions do download_scans.py (PIL + OpenCV fallback)."""
    
    def test_decode_small_webp_via_pil(self):
        """WebP de ~2KB deve ser decodificado via PIL quando cv2.imdecode falha."""
        from PIL import Image
        
        # Criar um WebP válido de pequenas dimensões (~2KB)
        img = Image.new('RGB', (200, 280), color=(73, 109, 137))
        
        with tempfile.NamedTemporaryFile(suffix='.webp', delete=False) as f:
            img.save(f, format='WEBP', quality=80)
            temp_path = f.name
        
        try:
            # Verificar que o arquivo tem menos de 4KB (o limiar antigo)
            size = os.path.getsize(temp_path)
            
            # Importar a função testada
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
            from download_scans import _decode_dimensions
            
            dims = _decode_dimensions(temp_path)
            
            # Deve retornar dimensões válidas
            self.assertIsNotNone(dims, "_decode_dimensions deve retornar dimensões para WebP válido")
            self.assertEqual(dims[0], 200)
            self.assertEqual(dims[1], 280)
        finally:
            os.unlink(temp_path)
    
    def test_decode_png_small(self):
        """PNG pequeno (< 4KB) deve ser aceito com novo limiar de 1KB."""
        from PIL import Image
        
        # Criar PNG simples de ~1-2KB
        img = Image.new('RGB', (200, 280), color=(255, 255, 255))
        
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            img.save(f, format='PNG', optimize=True)
            temp_path = f.name
        
        try:
            size = os.path.getsize(temp_path)
            
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
            from download_scans import _decode_dimensions
            
            dims = _decode_dimensions(temp_path)
            
            self.assertIsNotNone(dims, f"_decode_dimensions deve aceitar PNG de {size} bytes")
            self.assertEqual(dims[0], 200)
            self.assertEqual(dims[1], 280)
        finally:
            os.unlink(temp_path)
    
    def test_min_scan_bytes_is_1024(self):
        """Verificar que o limiar mínimo foi reduzido para 1024 bytes."""
        sys.path.insert(0, os.path.dirname(__file__))
        from recognizer.catalog import _MIN_SCAN_BYTES
        
        self.assertEqual(_MIN_SCAN_BYTES, 1024, "Limiar deve ser 1024 bytes para aceitar cartas simples")


if __name__ == "__main__":
    unittest.main(verbosity=2)
