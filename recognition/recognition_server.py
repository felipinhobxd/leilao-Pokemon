#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local Pokémon card recognition service (127.0.0.1 only).

Endpoints:
    GET  /health                    -> service status + readiness (models/index)
    POST /recognize                 -> multipart image -> full recognition JSON
    GET  /scan/{language}/{cardId}  -> cached official scan (low/EN-mirror fallbacks)
    GET  /catalog/exists            -> ghost-lot guard: does (language, set, number) exist in the catalog?
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
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image
import cv2

from recognizer import memory as memory_module
from recognizer.config import (BASE_DIR, DEFAULT_EMBEDDING, RECOGNITION_MAX_CONCURRENCY,
                               SERVICE_HOST, SERVICE_PORT, allowed_origins)
from recognizer.journal import (JOURNAL_PATH, journal_check_previous_crash,
                                journal_clear, journal_write)
from recognizer.ort_session import demotion_report
from recognizer.service_auth import verify_service_token
from recognizer.pipeline import Recognizer
from recognizer.store import CatalogStore

app = FastAPI(title="Pokemon Card Recognition (local)", version="1.3.0")

# Dedicated read-only SQLite connection for the lightweight /catalog/exists
# endpoint: independent of the recognizer/models, guarded because FastAPI
# sync endpoints run on a threadpool (WAL + busy_timeout handle the rest).
_catalog_lock = threading.Lock()
_catalog_conn = None


def get_catalog_conn():
    global _catalog_conn
    if _catalog_conn is None:
        from recognizer.catalog import init_db
        _catalog_conn = init_db()
    return _catalog_conn

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


_state = {"recognizer": None, "store": None, "started": 0, "requests": 0, "errors": 0,
           "journal_crash": False, "invalid_embeddings": 0}
_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


def _journal_check_previous_crash() -> None:
    """Startup wrapper: surface the recovered crash entry (see recognizer.journal).

    The journal is PER-REQUEST (JOURNAL_PATH.<request-id>) so concurrent
    recognitions never clear each other's entry; the glob sweep finds every
    leftover — any file still present at startup belongs to a process that
    died mid-request."""
    import glob
    recovered = None
    for path in sorted(glob.glob(JOURNAL_PATH + "*")):
        entry = journal_check_previous_crash(path)
        if entry:
            recovered = entry
    if recovered:
        print(f"[service] CRASH RECOVERY: previous process died while processing request "
              f"{recovered.get('id')} at {recovered.get('at')} (providers: {recovered.get('providers') or 'unknown'}) — "
              f"they were demoted; the service will run on the next provider in line",
              flush=True)
        _state["journal_crash"] = True


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
    # Strict readiness: catalog + embedding index + embedding session + OCR
    # sessions. A lazy component that has not been warmed yet means the first
    # photo would stall for seconds — that is NOT ready.
    models_loaded = bool(recognizer and recognizer.embedding_ready and recognizer.ocr_ready)
    auth_configured = len(os.environ.get("RECOGNITION_SERVICE_SHARED_SECRET", "").strip()) >= 32
    ready = bool(recognizer and index_size > 0 and models_loaded and auth_configured)
    import onnxruntime as ort
    payload = {
        "status": "ok",
        # ready=true only when the recognition pipeline can actually serve:
        # catalog + embedding index + ALL model sessions loaded (warm). Clients
        # must use the local pipeline only when ready (status=ok alone just
        # means the process is alive).
        "ready": ready,
        "authConfigured": auth_configured,
        "service": "pokemon-card-recognition",
        "version": "1.3.0",
        "uptimeSec": int(time.time() - _state["started"]),
        "requests": _state["requests"],
        "errors": _state["errors"],
        "backend": {
            "providers": ort.get_available_providers(),
            # What each session ACTUALLY runs on right now: ORT silently falls
            # back to CPU when DML/CUDA cannot init, so availableProviders is
            # NOT evidence of GPU use. Fallbacks are visible here per model.
            "runtimeProviders": recognizer.runtime_providers() if recognizer else {},
            "demotedProviders": demotion_report(),
            "embedding": os.environ.get("RECOGNITION_EMBEDDING", DEFAULT_EMBEDDING),
            "matcher": os.environ.get("RECOGNITION_MATCHER", "sift"),
            "ocr": "ppocrv6-medium",
            "maxConcurrency": RECOGNITION_MAX_CONCURRENCY,
        },
        "stability": {
            # Numerical-stability observability (P0 crash round): invalid
            # embeddings rejected by validation, provider demotions performed
            # by this process, and whether the previous process died mid-request.
            "invalidEmbeddings": (recognizer.index.model.invalid_outputs
                                  if recognizer and recognizer.index is not None
                                  and recognizer.index.model is not None else 0),
            "providerDemotions": (recognizer.index.model.demotions
                                  if recognizer and recognizer.index is not None
                                  and recognizer.index.model is not None else []),
            "previousRunCrashed": _state["journal_crash"],
        },
        "catalog": {"cards": catalog_size, "indexSize": index_size},
        "modelsLoaded": models_loaded,
        "memory": {"examples": len(memory_module.load_examples())},
    }
    if recognizer is not None:
        # Cache observability: hit ratios + byte footprints, so tuning
        # decisions on the target machine use numbers instead of guesses.
        try:
            payload["caches"] = recognizer.cache_stats()
        except Exception:  # noqa: BLE001
            payload["caches"] = {"error": "unavailable"}
    return payload


def _rewrite_candidate_urls(result) -> None:
    """Candidates resolved through low.webp / EN-mirror scans must not
    advertise the high.webp CDN URL (it 404s for exactly those cards): point
    them at the local /scan endpoint, which serves whatever actually
    resolved."""
    for candidate in list(result.candidates[:10]) + ([result.best] if result.best else []):
        if candidate.scan_source and candidate.scan_source != "high.webp":
            candidate.image_url = f"/scan/{candidate.language}/{candidate.card_id}"


@app.post("/recognize")
async def recognize(request: Request, file: UploadFile = File(...)):
    verify_service_token(request)
    _state["requests"] += 1
    queued_at = time.time()
    try:
        data = await file.read()
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Imagem muito grande (max 25 MB)")

        def work():
            # Decode INSIDE the executor: a 25 MB JPEG decode (100-300 ms)
            # on the event loop would stall every concurrent endpoint,
            # including /health.
            bgr = decode_upload(data)
            if bgr is None or bgr.size == 0:
                raise HTTPException(status_code=400, detail="Imagem inválida")
            started = time.time()
            waited = started - queued_at  # time spent behind other cards
            recognizer = get_recognizer()
            # Crash journal: if the process dies natively inside a provider,
            # this entry tells the next startup exactly who was executing.
            # PER-REQUEST path: with concurrency > 1 a shared file would be
            # cleared by whichever request finished first, losing the crash
            # attribution of the one still in flight.
            request_id = f"req-{_state['requests']}"
            journal_path = f"{JOURNAL_PATH}.{request_id}"
            journal_write(journal_path, request_id, recognizer.runtime_providers())
            try:
                result = recognizer.recognize(bgr)
            finally:
                journal_clear(journal_path)
            if result.visual_error:
                _state["invalid_embeddings"] += 1
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


@app.get("/catalog/exists")
def catalog_exists(request: Request, language: str, set: str, number: str):
    verify_service_token(request)
    """Fase 4.3 — ghost-lot guard for the auction wizard: does this
    (language, set, collector number) exist in the local recognition
    catalog? Lightweight BY DESIGN: queries the SQLite catalog directly —
    no models, no warm-up, millisecond latency — so the site can call it
    synchronously while creating a lot. A lot whose card is not in the
    catalog can never be matched by the recognizer: the site rejects it
    ("fantasma") instead of creating an unidentifiable lot."""
    from recognizer.catalog import init_db
    from recognizer.store import find_catalog_card
    with _catalog_lock:
        conn = get_catalog_conn()
        found = find_catalog_card(conn, language, set, number)
    if found is None:
        return {"exists": False, "cardId": None, "setId": None, "language": language}
    return {"exists": True, "cardId": found["id"], "setId": found["set_id"],
            "localId": found["local_id"], "name": found["name"], "language": language}


@app.get("/scan/{language}/{card_id}")
def scan(language: str, card_id: str):
    """Serve the locally cached official scan for a card, through the same
    resolution chain the recognizer uses (high -> low -> EN mirror ->
    second/third-source alt). Cards whose CDN high.webp 404s — including
    scanless cards that only resolved via image_alt (pokemon-tcg-data /
    Limitless backfill) — get a working image exactly when they are
    retrievable at all. No local filesystem paths are exposed."""
    store = _state["store"]
    if store is None:
        get_recognizer()
        store = _state["store"]
    record = store.card_by_key(language, card_id) if store else None
    if record is None or not (record.image_base or record.image_alt):
        raise HTTPException(status_code=404, detail="Carta não encontrada")
    from recognizer.catalog import resolve_scan
    resolved = resolve_scan(record.image_base or None, record.image_alt or None)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Scan não disponível")
    path, source = resolved
    suffix = os.path.splitext(path)[1].lower()
    media = {
        ".webp": "image/webp",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
    }.get(suffix)
    if media is None:
        raise HTTPException(status_code=415, detail="Formato de scan não suportado")
    return FileResponse(path, media_type=media,
                        headers={"Cache-Control": "public, max-age=604800"})


@app.post("/memory/confirm")
async def memory_confirm(request: Request, file: UploadFile = File(...), card: str = Form(...)):
    verify_service_token(request)
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

    def work():
        # Decode + normalize + embed are heavy: run them on the bounded
        # executor like /recognize instead of the event loop.
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
        return memory_module.add_example(card_fields, canonical, embedding)

    loop = asyncio.get_running_loop()
    try:
        example = await loop.run_in_executor(get_executor(), work)
    except HTTPException:
        _state["errors"] += 1
        raise
    return {"status": "confirmed", "example": example.to_dict()}


@app.get("/memory")
def memory_list(request: Request):
    verify_service_token(request)
    return {"examples": [e.to_dict() for e in memory_module.load_examples()]}


@app.delete("/memory/{example_id}")
def memory_delete(request: Request, example_id: str):
    verify_service_token(request)
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
def reload_index(request: Request):
    verify_service_token(request)
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
    _journal_check_previous_crash()
    if args.preload:
        get_recognizer()
    print(f"[service] listening on http://{args.host}:{args.port} (local only) "
          f"maxConcurrency={RECOGNITION_MAX_CONCURRENCY}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
