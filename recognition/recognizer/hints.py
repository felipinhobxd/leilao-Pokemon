# -*- coding: utf-8 -*-
"""OCR hints extraction (name / HP / number / denominator / language) from region OCR lines.

Hints are evidence, never hard filters: a low-confidence number must NOT
restrict the catalog.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

from .ocr import OcrResult

PT_WORDS = ("fraqueza", "recuo", "baralho", "procure", "jogue", "voce", "mao", "jogador",
            "adversario", "coloque", "compre", "proximo", "descartar", "resistencia", "dano",
            "pokemon", "basico", "evolui", "energia", "turno", "banca")
EN_WORDS = ("weakness", "retreat", "deck", "search", "discard", "your", "opponent", "draw",
            "choose", "hand", "damage", "attach", "shuffle", "during", "basic", "pokemon",
            "evolves", "energy", "turn", "bench")
ES_WORDS = ("debilidad", "retirada", "baraja", "busca", "descarta", "jugador", "rival",
            "elige", "roba", "mano", "puedes", "resistencia", "dano", "banca", "energia")

# Card-frame category words (printed banners like "TREINADOR" / "ITEM") that
# the name-region OCR can grab instead of the actual card name. They match
# every card of a class, so they carry zero name evidence and must not be
# treated as a (conflicting) name read.
CATEGORY_WORDS = {
    "treinador", "item", "pokemon", "energia", "ferramenta", "estadio",
    "trainer", "supporter", "stadium", "tool", "energy", "basic", "holo", "raro",
    "basico", "estagio", "estagio1", "estagio2", "estagio 1", "estagio 2",
    "evolucao", "nivel", "ps",
}

NUMBER_RE = re.compile(r"(\d{1,3})\s*[/|lI]\s*(\d{1,3})")
NUMBER_LOOSE_RE = re.compile(r"\b(\d{1,3})\D{1,3}(\d{2,3})\b")
HP_RE = re.compile(r"(?:(\d{2,3})\s*(?:PS|Ps|ps|HP|hp))|(?:(?:PS|Ps|ps|HP|hp)\s*(\d{2,3}))")


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9♀♂]+", " ", stripped.lower()).strip()


@dataclass
class OcrHints:
    name: str = ""
    name_confidence: float = 0.0
    hp: Optional[int] = None
    hp_confidence: float = 0.0
    local_id: str = ""
    denominator: Optional[int] = None
    number_confidence: float = 0.0
    language: str = ""
    language_confidence: float = 0.0
    text: str = ""
    lines_used: int = 0
    ocr_override: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name, "nameConfidence": round(self.name_confidence, 3),
            "hp": self.hp, "hpConfidence": round(self.hp_confidence, 3),
            "localId": self.local_id, "denominator": self.denominator,
            "numberConfidence": round(self.number_confidence, 3),
            "language": self.language, "languageConfidence": round(self.language_confidence, 3),
            "linesUsed": self.lines_used,
        }


def detect_language(text: str) -> tuple[str, float]:
    japanese = len(re.findall(r"[ぁ-んァ-ン一-龯]", text))
    if japanese >= 2:
        return "ja", min(0.99, 0.7 + 0.05 * japanese)
    lowered = _normalize(text)
    words = set(lowered.split())
    pt = len(words & set(PT_WORDS))
    en = len(words & set(EN_WORDS))
    es = len(words & set(ES_WORDS))
    best = max((pt, "pt-BR"), (en, "en"), (es, "es"))
    if best[0] == 0:
        return "", 0.0
    scores = sorted([pt, en, es], reverse=True)
    margin = scores[0] - scores[1]
    return best[1], min(0.95, 0.5 + 0.12 * scores[0] + 0.08 * margin)


def extract_hints(ocr: OcrResult) -> OcrHints:
    """Parse region-tagged OCR lines into hints."""
    hints = OcrHints(text=ocr.text, lines_used=len(ocr.lines))
    if not ocr.lines:
        return hints

    # Name: best line from the "name" region (longest decent-confidence text).
    # The "name2" band (deeper top crop for loose perspective warps) joins the
    # pool but only wins when it beats the primary band's read; artwork noise
    # from the deeper band is filtered by the 3-char minimum.
    name_lines = [line for line in ocr.lines if line.region in ("name", "name2")]
    name_line = None
    for line in sorted(name_lines, key=lambda l: -l.confidence):
        clean = line.text.strip()
        min_len = 2 if line.region == "name" else 3
        if (min_len <= len(clean) <= 34 and re.search(r"[A-Za-zÀ-ÿぁ-ン一-龯]", clean)
                and not NUMBER_RE.search(clean)):
            name_line = line
            break
    if name_line is not None:
        clean_name = name_line.text.strip()
        if _normalize(clean_name) in CATEGORY_WORDS:
            # Category banner (e.g. "TREINADOR") grabbed by the name region:
            # keep it in the text for language detection, drop as name hint.
            pass
        else:
            hints.name = clean_name
            hints.name_confidence = float(name_line.confidence)

    # HP from the "hp"/"hp2" regions (accepts "60 PS" and "Ps60" readings);
    # highest-confidence match wins so the deeper band can rescue loose warps.
    hp_lines = [line for line in ocr.lines if line.region in ("hp", "hp2")]
    hp_line = None
    for line in sorted(hp_lines, key=lambda l: -l.confidence):
        match = HP_RE.search(line.text)
        if match:
            hp_line = (match, line)
            break
    if hp_line is not None:
        value = hp_line[0].group(1) or hp_line[0].group(2)
        hints.hp = int(value)
        hints.hp_confidence = float(hp_line[1].confidence)

    # Number/denominator. The multi-region OCR emits several reads of the
    # same collector number (corner + wide bands x denoising ladder); noisy
    # photos produce both right and wrong parses. Consensus voting: group
    # strict N/M parses by (num, den), sum confidences per group, and take
    # the strongest group — a lone confident misread loses to a repeated
    # correct one. Loose (slash-less) parses are a last-resort fallback.
    # Grouping uses ocr.number_read_groups so the early-stop in read_card
    # and the vote here agree on what "the same read" means.
    from .ocr import number_read_groups
    groups = number_read_groups(ocr.lines)
    best_number = None
    if groups:
        # group score = vote mass; ties broken by the single best line conf
        best_key = max(groups, key=lambda k: (sum(groups[k]), max(groups[k])))
        best_number = (best_key[0], best_key[1], max(groups[best_key]))
    if best_number is None:
        for line in ocr.lines:
            if line.region == "number":
                match = NUMBER_LOOSE_RE.search(line.text)
                if match and match.group(1) != match.group(2):
                    if best_number is None or line.confidence > best_number[2]:
                        best_number = (match.group(1), match.group(2), float(line.confidence) * 0.8)
    if best_number is None:
        for line in ocr.lines:
            if line.region not in ("footer", "copyright"):
                continue
            match = NUMBER_RE.search(line.text)
            if match and match.group(1) != match.group(2):
                if best_number is None or line.confidence > best_number[2]:
                    best_number = (match.group(1), match.group(2), float(line.confidence))
    if best_number:
        hints.local_id = best_number[0].lstrip("0") or best_number[0]
        try:
            hints.denominator = int(best_number[1])
        except ValueError:
            pass
        hints.number_confidence = best_number[2]

    language, language_conf = detect_language(ocr.text)
    hints.language, hints.language_confidence = language, language_conf
    return hints


def apply_override(hints: OcrHints, override: dict) -> OcrHints:
    """Benchmark regression: simulate OCR failures (e.g. name -> 'escia')."""
    if "name" in override:
        hints.name = str(override["name"])
        hints.name_confidence = 0.45
    if "cardNumber" in override:
        match = NUMBER_RE.search(str(override["cardNumber"]))
        if match:
            hints.local_id = match.group(1).lstrip("0") or match.group(1)
            hints.denominator = int(match.group(2))
            hints.number_confidence = 0.35
    return hints


def name_similarity(a: str, b: str) -> float:
    na, nb = _normalize(a), _normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    import difflib
    sa, sb = na.replace(" ", ""), nb.replace(" ", "")
    if sa == sb:
        # Only spacing differs ("CaudaBrado" vs "Cauda Brado") — same read.
        return 0.98
    if len(sa) >= 4 and len(sb) >= 4 and (sa in sb or sb in sa):
        # The OCR read is a strict prefix/subset of the printed name (truncated
        # read: "Cauda Brado" missing "ex", "Pikachu" vs "Pikachu VMAX").
        # Both candidates are COMPATIBLE with the read; a shorter name must
        # not win (nor a longer one lose) on truncated evidence — the visual
        # route and collector number are the discriminators for variants.
        shorter, longer = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
        coverage = len(shorter) / len(longer)
        return 0.90 + 0.05 * coverage  # 0.90-0.95: compatible, not exact
    return difflib.SequenceMatcher(None, na, nb).ratio()
