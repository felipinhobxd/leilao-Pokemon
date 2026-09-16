#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local Pokémon card recognition service (127.0.0.1 only).

Endpoints:
    GET  /health                    -> service status + readiness (models/index)
    POST /recognize                 -> multipart image -> full recognition JSON
    GET  /scan/{language}/{cardId}  -> cached official scan (low/EN-mirror fallbacks)
    POST /memory/confirm            -> multipart image + card fields -> confirmed memory example
    GET  /memory                    -> list confirmed examples
    DELETE /memory/{id}             -> remove an example
    POST /reload-index              -> rebuild in-memory index after `recognition:index`

Concurrency: recognition is CPU/GPU heavy and synchronous, so the endpoint
runs it on a bounded executor (RECOGNITION_MAX_CONCURRENCY, default 1) instead
of the event loop — health stays responsive and 20/50-photo batches queue
fairly. Queue wait vs execution time are reported separately (queueMs /
executionMs) so clients never mistake "waiting behind other cards" for a hang.

CORS: explicit allow-list from RECOGNITION_ALLOWED_ORIGINS (localhost
defaults; add the Vercel domain there — never "*"). The service answers the
Private Network Access preflight so an https panel may call this loopback
service. The bind address stays 127.0.0.1.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image
import cv2

from recognizer import memory as memory_module
from recognizer.config import (DEFAULT_EMBEDDING, RECOGNITION_MAX_CONCURRENCY,
                               SERVICE_HOST, SERVICE_PORT, allowed_origins)
from recognizer.pipeline import Recognizer
from recognizer.store import CatalogStore

app = FastAPI(title="Pokemon Card Recognition (local)", version="1.1.0")

# The site runs on localhost dev/production ports; the deployed Vercel panel
# is added via RECOGNITION_ALLOWED_ORIGINS (comma-separated). Never "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network_access(request, call_next):
    """Private Network Access (Chrome 104+): a public https page calling this
    loopback service sends an OPTIONS preflight with
    `Access-Control-Request-Private-Network: true` and expects an explicit
    allow header on the response. Loopback origins are mixed-content-exempt,
    so the panel can talk to the local service directly."""
    response = await call_next(request)
    if request.method == "OPTIONS":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


_state = {"recognizer": None, "store": None, "started": 0, "requests": 0, "errors": 0}
_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


def get_executor() -> ThreadPoolExecutor:
    """Bounded worker pool for recognition (the async endpoints never run the
    heavy pipeline on the event loop)."""
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=RECOGNITION_MAX_CONCURRENCY, thread_name_prefix="recognize")
        return _executor


def get_recognizer() -> Recognizer:
    with _lock:
        if _state["recognizer"] is None:
            store = CatalogStore()
            recognizer = Recognizer(embedding_name=os.environ.get("RECOGNITION_EMBEDDING", DEFAULT_EMBEDDING),
                                    matcher_name=os.environ.get("RECOGNITION_MATCHER", "sift"),
                                    catalog=store)
            recognizer.warm()  # OCR sessions: /health must report truthful readiness
            _state["store"] = store
            _state["recognizer"] = recognizer
        return _state["recognizer"]


def decode_upload(data: bytes, max_bytes: int = 25 * 1024 * 1024,
                 max_side: int = 12000) -> np.ndarray:
    """Decode an uploaded image with hard limits: size (413), content type
    (400 on non-image data), and dimensions (413 — a decompressed-bomb guard
    so a single upload cannot exhaust service memory)."""
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Imagem muito grande (max {max_bytes // (1024 * 1024)} MB)")
    try:
        image = Image.open(io.BytesIO(data))
        image = image.convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Arquivo enviado não é uma imagem válida") from exc
    if image.width > max_side or image.height > max_side:
        raise HTTPException(status_code=413, detail=f"Dimensões da imagem acima do limite ({max_side}px)")
    array = np.asarray(image, dtype=np.uint8)
    return cv2.cvtColor(array, cv2.COLOR_RGB2BGR)


@app.get("/health")
def health():
    recognizer = _state["recognizer"]
    catalog_size = len(_state["store"].cards) if _state["store"] else 0
    index_size = len(recognizer.index.ids) if recognizer else 0
    models_loaded = bool(recognizer and recognizer.ocr_ready and recognizer.index.model is not None)
    ready = bool(recognizer and index_size > 0 and models_loaded)
    import onnxruntime as ort
    return {
        "status": "ok",
        # ready=true only when the recognition pipeline can actually serve:
        # catalog + embedding index + OCR sessions all loaded. Clients must
        # use the local pipeline only when ready (status=ok alone just means
        # the process is alive).
        "ready": ready,
        "service": "pokemon-card-recognition",
        "version": "1.1.0",
        "uptimeSec": int(time.time() - _state["started"]),
        "requests": _state["requests"],
        "errors": _state["errors"],
        "backend": {
            "providers": ort.get_available_providers(),
            "embedding": os.environ.get("RECOGNITION_EMBEDDING", DEFAULT_EMBEDDING),
            "matcher": os.environ.get("RECOGNITION_MATCHER", "sift"),
            "ocr": "ppocrv6-medium",
            "maxConcurrency": RECOGNITION_MAX_CONCURRENCY,
        },
        "catalog": {"cards": catalog_size, "indexSize": index_size},
        "modelsLoaded": models_loaded,
        "memory": {"examples": len(memory_module.load_examples())},
    }


def _rewrite_candidate_urls(result) -> None:
    """Candidates resolved through low.webp / EN-mirror scans must not
    advertise the high.webp CDN URL (it 404s for exactly those cards): point
    them at the local /scan endpoint, which serves whatever actually
    resolved."""
    for candidate in list(result.candidates[:10]) + ([result.best] if result.best else []):
        if candidate.scan_source and candidate.scan_source != "high.webp":
            candidate.image_url = f"/scan/{candidate.language}/{candidate.card_id}"


@app.post("/recognize")
async def recognize(file: UploadFile = File(...)):
    _state["requests"] += 1
    queued_at = time.time()
    try:
        data = await file.read()
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Imagem muito grande (max 25 MB)")
        bgr = decode_upload(data)
        if bgr is None or bgr.size == 0:
            raise HTTPException(status_code=400, detail="Imagem inválida")
        recognizer = get_recognizer()

        def work():
            started = time.time()
            waited = started - queued_at  # time spent behind other cards
            result = recognizer.recognize(bgr)
            return result, time.time() - started, waited

        loop = asyncio.get_running_loop()
        result, execution_s, queue_s = await loop.run_in_executor(get_executor(), work)
        _rewrite_candidate_urls(result)
        payload = result.to_dict()
        payload["imageBytes"] = len(data)
        payload["queueMs"] = int(queue_s * 1000)
        payload["executionMs"] = int(execution_s * 1000)
        payload["totalMs"] = int((time.time() - queued_at) * 1000)
        return payload
    except HTTPException:
        _state["errors"] += 1
        raise
    except Exception as exc:  # noqa: BLE001
        _state["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Reconhecimento falhou: {exc}") from exc


@app.get("/scan/{language}/{card_id}")
def scan(language: str, card_id: str):
    """Serve the locally cached official scan for a card, through the same
    resolution chain the recognizer uses (high -> low -> EN mirror). Cards
    whose CDN high.webp 404s get a working image exactly when they are
    retrievable at all. No local filesystem paths are exposed."""
    store = _state["store"]
    if store is None:
        get_recognizer()
        store = _state["store"]
    record = store.card_by_key(language, card_id) if store else None
    if record is None or not record.image_base:
        raise HTTPException(status_code=404, detail="Carta não encontrada")
    from recognizer.catalog import resolve_scan
    resolved = resolve_scan(record.image_base)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Scan não disponível")
    path, source = resolved
    media = "image/webp" if source.endswith(".webp") else "image/jpeg"
    return FileResponse(path, media_type=media,
                        headers={"Cache-Control": "public, max-age=604800"})


@app.post("/memory/confirm")
async def memory_confirm(file: UploadFile = File(...), card: str = Form(...)):
    """Store a USER-CONFIRMED example (ground truth). Never called automatically.

    Hardened like /recognize: upload size limit (413), real image validation
    (400), and bounded dimensions (413) before any decode/embedding work."""
    import json
    try:
        card_fields = json.loads(card)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="card JSON inválido") from exc
    required = ("cardId", "language", "name")
    if any(not card_fields.get(k) for k in required):
        raise HTTPException(status_code=400, detail="cardId, language e name são obrigatórios")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Imagem muito grande (max 25 MB)")
    try:
        bgr = decode_upload(data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Imagem inválida") from exc
    recognizer = get_recognizer()
    from recognizer.normalize import normalize_card
    card_image = normalize_card(bgr).image
    embedding = recognizer.index.model.embed([card_image])[0]
    # Store the canonical normalized crop (JPEG q85) instead of the raw photo:
    # the memory lookup embeds the normalized card anyway, and full photos
    # (2-5 MB) would bloat the local store for no retrieval benefit.
    ok, encoded = cv2.imencode(".jpg", card_image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    canonical = encoded.tobytes() if ok else data
    example = memory_module.add_example(card_fields, canonical, embedding)
    return {"status": "confirmed", "example": example.to_dict()}


@app.get("/memory")
def memory_list():
    return {"examples": [e.to_dict() for e in memory_module.load_examples()]}


@app.delete("/memory/{example_id}")
def memory_delete(example_id: str):
    """Remove an example consistently from memory.json, memory-embeddings.npz
    AND memory-images/ under the same write lock used by confirm (atomic
    saves; concurrent confirm/delete pairs can never leave a half-removed or
    resurrected example behind)."""
    try:
        remaining = memory_module.remove_example(example_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Exemplo não encontrado") from exc
    return {"status": "removed", "remaining": remaining}


@app.post("/reload-index")
def reload_index():
    global _state
    with _lock:
        _state["recognizer"] = None
        _state["store"] = None
    get_recognizer()
    return {"status": "reloaded", "indexSize": len(_state["recognizer"].index.ids)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=SERVICE_HOST)
    parser.add_argument("--port", type=int, default=SERVICE_PORT)
    parser.add_argument("--preload", action="store_true", help="load models at startup")
    args = parser.parse_args()
    _state["started"] = time.time()
    if args.preload:
        get_recognizer()
    print(f"[service] listening on http://{args.host}:{args.port} (local only) "
          f"maxConcurrency={RECOGNITION_MAX_CONCURRENCY}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
