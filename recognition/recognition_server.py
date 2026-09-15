#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local Pokémon card recognition service (127.0.0.1 only).

Endpoints:
    GET  /health                    -> service status (site uses this to detect the service)
    POST /recognize                 -> multipart image -> full recognition JSON
    POST /memory/confirm            -> multipart image + card fields -> confirmed memory example
    GET  /memory                    -> list confirmed examples
    DELETE /memory/{id}             -> remove an example
    POST /reload-index              -> rebuild in-memory index after `recognition:index`

Models stay loaded in memory; CUDA/DirectML used automatically when available.
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import threading
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import cv2

from recognizer import memory as memory_module
from recognizer.config import DEFAULT_EMBEDDING, SERVICE_HOST, SERVICE_PORT
from recognizer.pipeline import Recognizer
from recognizer.store import CatalogStore

app = FastAPI(title="Pokemon Card Recognition (local)", version="1.0.0")

# The site runs on localhost dev/production ports; only same-machine access is allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
    ],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

_state = {"recognizer": None, "store": None, "started": 0, "requests": 0, "errors": 0}
_lock = threading.Lock()


def get_recognizer() -> Recognizer:
    with _lock:
        if _state["recognizer"] is None:
            store = CatalogStore()
            recognizer = Recognizer(embedding_name=os.environ.get("RECOGNITION_EMBEDDING", DEFAULT_EMBEDDING),
                                    matcher_name=os.environ.get("RECOGNITION_MATCHER", "sift"),
                                    catalog=store)
            _state["store"] = store
            _state["recognizer"] = recognizer
        return _state["recognizer"]


def decode_upload(data: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(data))
    image = image.convert("RGB")
    array = np.asarray(image, dtype=np.uint8)
    return cv2.cvtColor(array, cv2.COLOR_RGB2BGR)


@app.get("/health")
def health():
    recognizer = _state["recognizer"]
    catalog_size = len(_state["store"].cards) if _state["store"] else 0
    index_size = len(recognizer.index.ids) if recognizer else 0
    import onnxruntime as ort
    return {
        "status": "ok",
        "service": "pokemon-card-recognition",
        "version": "1.0.0",
        "uptimeSec": int(time.time() - _state["started"]),
        "requests": _state["requests"],
        "errors": _state["errors"],
        "backend": {
            "providers": ort.get_available_providers(),
            "embedding": os.environ.get("RECOGNITION_EMBEDDING", DEFAULT_EMBEDDING),
            "matcher": os.environ.get("RECOGNITION_MATCHER", "sift"),
            "ocr": "ppocrv6-medium",
        },
        "catalog": {"cards": catalog_size, "indexSize": index_size},
        "memory": {"examples": len(memory_module.load_examples())},
    }


@app.post("/recognize")
async def recognize(file: UploadFile = File(...)):
    _state["requests"] += 1
    started = time.time()
    try:
        data = await file.read()
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Imagem muito grande (max 25 MB)")
        bgr = decode_upload(data)
        if bgr is None or bgr.size == 0:
            raise HTTPException(status_code=400, detail="Imagem inválida")
        recognizer = get_recognizer()
        result = recognizer.recognize(bgr)
        payload = result.to_dict()
        payload["imageBytes"] = len(data)
        payload["totalMs"] = int((time.time() - started) * 1000)
        return payload
    except HTTPException:
        _state["errors"] += 1
        raise
    except Exception as exc:  # noqa: BLE001
        _state["errors"] += 1
        raise HTTPException(status_code=500, detail=f"Reconhecimento falhou: {exc}") from exc


@app.post("/memory/confirm")
async def memory_confirm(file: UploadFile = File(...), card: str = Form(...)):
    """Store a USER-CONFIRMED example (ground truth). Never called automatically."""
    import json
    try:
        card_fields = json.loads(card)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="card JSON inválido") from exc
    required = ("cardId", "language", "name")
    if any(not card_fields.get(k) for k in required):
        raise HTTPException(status_code=400, detail="cardId, language e name são obrigatórios")
    data = await file.read()
    bgr = decode_upload(data)
    recognizer = get_recognizer()
    from recognizer.normalize import normalize_card
    card_image = normalize_card(bgr).image
    embedding = recognizer.index.model.embed([card_image])[0]
    example = memory_module.add_example(card_fields, data, embedding)
    return {"status": "confirmed", "example": example.to_dict()}


@app.get("/memory")
def memory_list():
    return {"examples": [e.to_dict() for e in memory_module.load_examples()]}


@app.delete("/memory/{example_id}")
def memory_delete(example_id: str):
    examples = memory_module.load_examples()
    remaining = [e for e in examples if e.id != example_id]
    if len(remaining) == len(examples):
        raise HTTPException(status_code=404, detail="Exemplo não encontrado")
    memory_module.save_examples(remaining)
    # rebuild embeddings file without the removed example
    ids, matrix = memory_module._load_embeddings()
    keep = [i for i, mid in enumerate(ids) if mid != example_id]
    np.savez_compressed(memory_module.MEMORY_EMBEDDINGS,
                        ids=np.array([ids[i] for i in keep], dtype=object),
                        matrix=matrix[keep])
    return {"status": "removed", "remaining": len(remaining)}


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
    print(f"[service] listening on http://{args.host}:{args.port} (local only)")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
