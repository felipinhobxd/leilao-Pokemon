#!/usr/bin/env python3
"""Build a benchmark-only Milo embedding index from TCGdex physical-card scans.

This script never reads user photos. It downloads public official/reference scans,
embeds them with HanClinto/milo v1.0.0, and emits compact float16/int8 galleries.
The generated assets are CI artifacts only until real-photo benchmarks justify a
runtime integration.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import time
from typing import Any

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image
import requests

TCGDEX_BASE = "https://api.tcgdex.net/v2/en"
PAGE_SIZE = 100
MODEL_REPO = "HanClinto/milo"
MODEL_FILE = "model.onnx"
MODEL_SHA256 = "bd13d8d60383c69da04dce261f32e93fdaeaa8fd618fbc991e7385f71b3d45df"
MODEL_LICENSE = "AGPL-3.0"
MODEL_INPUT = 448
EMBED_DIM = 128
DEFAULT_WORKERS = max(2, min(10, int(os.getenv("CARD_INDEX_CONCURRENCY", "8"))))
MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)


def request_json(session: requests.Session, url: str, tries: int = 6) -> Any:
    for attempt in range(tries):
        try:
            response = session.get(url, timeout=25)
            if response.status_code == 200:
                return response.json()
            if response.status_code not in (429, 500, 502, 503, 504):
                response.raise_for_status()
        except requests.RequestException:
            if attempt == tries - 1:
                raise
        time.sleep(0.6 * (2**attempt))
    raise RuntimeError(f"failed after retries: {url}")


def list_physical_cards(limit: int | None) -> list[dict[str, str]]:
    session = requests.Session()
    session.headers["User-Agent"] = "leilao-pokemon-milo-index/1.0"
    cards: list[dict[str, str]] = []
    seen: set[str] = set()
    page = 1
    while True:
        params = requests.compat.urlencode({
            "image": "notlike:/tcgp/",
            "pagination:page": page,
            "pagination:itemsPerPage": PAGE_SIZE,
        })
        batch = request_json(session, f"{TCGDEX_BASE}/cards?{params}")
        if not isinstance(batch, list):
            raise RuntimeError("TCGdex card list returned a non-array payload")
        for card in batch:
            card_id = str(card.get("id") or "")
            image = str(card.get("image") or "")
            if not card_id or not image or "/tcgp/" in image or card_id in seen:
                continue
            seen.add(card_id)
            cards.append({
                "id": card_id,
                "image": image,
                "localId": str(card.get("localId") or ""),
                "name": str(card.get("name") or "").replace("\t", " ").replace("\n", " ").strip(),
            })
            if limit and len(cards) >= limit:
                return cards
        print(f"catalog page {page}: {len(cards)} physical images", flush=True)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
        time.sleep(0.05)
    return cards


def download_card(card: dict[str, str]) -> tuple[dict[str, str], bytes]:
    url = f"{card['image']}/low.webp"
    headers = {"User-Agent": "leilao-pokemon-milo-index/1.0"}
    for attempt in range(6):
        try:
            response = requests.get(url, headers=headers, timeout=25)
            if response.status_code == 200:
                return card, response.content
            if response.status_code not in (429, 500, 502, 503, 504):
                response.raise_for_status()
        except requests.RequestException:
            if attempt == 5:
                raise
        time.sleep(0.75 * (2**attempt))
    raise RuntimeError(f"failed after retries: {url}")


def preprocess(image_bytes: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(image_bytes)) as image:
        image = image.convert("RGB").resize((MODEL_INPUT, MODEL_INPUT), Image.Resampling.BICUBIC)
        array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - MEAN) / STD
    return np.transpose(array, (2, 0, 1)).astype(np.float32, copy=False)


def l2_normalize(batch: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(batch, axis=1, keepdims=True)
    return batch / np.maximum(norms, 1e-12)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def quantize_int8(embeddings: np.ndarray) -> np.ndarray:
    # L2-normalized values are within [-1,1]. A shared scale keeps retrieval
    # simple in the browser and does not leak any benchmark-specific tuning.
    return np.clip(np.rint(embeddings * 127.0), -127, 127).astype(np.int8)


def run(args: argparse.Namespace) -> None:
    started = time.time()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    model_cache = Path(hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE))
    actual_sha = sha256(model_cache)
    if actual_sha != MODEL_SHA256:
        raise RuntimeError(f"unexpected Milo model SHA256 {actual_sha}")

    # Keep an exact copy in the short-lived benchmark artifact so the private
    # photo evaluation can run locally without sending photos to any service.
    model_output = output / "milo-v1.onnx"
    shutil.copyfile(model_cache, model_output)

    session = ort.InferenceSession(str(model_cache), providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    output_meta = session.get_outputs()[0]
    input_name = input_meta.name
    output_name = output_meta.name
    input_shape = list(input_meta.shape)
    output_shape = list(output_meta.shape)
    batch_dynamic = input_shape and (input_shape[0] is None or isinstance(input_shape[0], str))
    requested_batch = max(1, args.batch)
    batch_size = requested_batch if batch_dynamic else 1

    cards = list_physical_cards(args.max_cards)
    embeddings: list[np.ndarray] = []
    metadata: list[str] = []
    skipped: list[dict[str, str]] = []
    source_bytes = 0
    pending_images: list[np.ndarray] = []
    pending_cards: list[dict[str, str]] = []

    def flush() -> None:
        nonlocal pending_images, pending_cards
        if not pending_images:
            return
        batch = np.stack(pending_images, axis=0)
        values = session.run([output_name], {input_name: batch})[0]
        values = np.asarray(values, dtype=np.float32).reshape(len(pending_images), -1)
        if values.shape[1] != EMBED_DIM:
            raise RuntimeError(f"unexpected embedding shape {values.shape}")
        values = l2_normalize(values)
        for card, embedding in zip(pending_cards, values, strict=True):
            embeddings.append(embedding)
            metadata.append("\t".join([
                card["id"], card["image"], card["localId"], card["name"],
            ]))
        pending_images = []
        pending_cards = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        future_to_card = {pool.submit(download_card, card): card for card in cards}
        completed = 0
        for future in concurrent.futures.as_completed(future_to_card):
            card = future_to_card[future]
            completed += 1
            try:
                _, payload = future.result()
                source_bytes += len(payload)
                pending_images.append(preprocess(payload))
                pending_cards.append(card)
                if len(pending_images) >= batch_size:
                    flush()
            except Exception as error:  # noqa: BLE001 - record per-card failures and continue
                skipped.append({"id": card["id"], "error": str(error)[:240]})
            if completed % 200 == 0 or completed == len(cards):
                print(f"milo {completed}/{len(cards)} (indexed {len(embeddings)}, skipped {len(skipped)})", flush=True)
        flush()

    if not embeddings:
        raise RuntimeError("no embeddings generated")
    matrix = np.stack(embeddings, axis=0).astype(np.float32)
    f16 = matrix.astype(np.float16)
    i8 = quantize_int8(matrix)
    meta_text = "\n".join(metadata) + "\n"

    f16_path = output / "milo-index-f16.bin"
    i8_path = output / "milo-index-int8.bin"
    meta_path = output / "milo-index.meta.tsv"
    f16.tofile(f16_path)
    i8.tofile(i8_path)
    meta_path.write_text(meta_text, encoding="utf-8")
    (output / "milo-index.skipped.json").write_text(json.dumps(skipped, ensure_ascii=False, indent=2), encoding="utf-8")

    stats = {
        "version": 1,
        "purpose": "benchmark-only exact-print visual retrieval",
        "source": "TCGdex REST v2 English physical cards",
        "cardsListed": len(cards),
        "cardsIndexed": len(embeddings),
        "cardsSkipped": len(skipped),
        "sourceDownloadBytes": source_bytes,
        "model": MODEL_REPO,
        "modelFile": MODEL_FILE,
        "modelSha256": actual_sha,
        "modelBytes": model_output.stat().st_size,
        "modelLicense": MODEL_LICENSE,
        "inputShape": input_shape,
        "outputShape": output_shape,
        "embeddingDimension": EMBED_DIM,
        "embeddingNormalization": "L2",
        "f16IndexBytes": f16_path.stat().st_size,
        "int8IndexBytes": i8_path.stat().st_size,
        "metadataBytes": meta_path.stat().st_size,
        "int8Scale": 127,
        "workers": args.workers,
        "batchSize": batch_size,
        "buildMs": round((time.time() - started) * 1000),
        "note": "Model is third-party AGPL-3.0 and is not approved for product integration by this benchmark.",
    }
    (output / "milo-index.stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="card-recognition-milo")
    parser.add_argument("--max-cards", type=int, default=None)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--batch", type=int, default=16)
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
