# -*- coding: utf-8 -*-
"""Shared ONNX Runtime session factory with DirectML-safe configuration.

Official DirectML EP documentation (onnxruntime.ai, checked 2026-09-17):
- "The DirectML execution provider does not support the use of memory pattern
  optimizations or parallel execution in onnxruntime" -> DML-candidate sessions
  are created with enable_mem_pattern=False and execution_mode=ORT_SEQUENTIAL
  (leaving them on crashes Run with "memory pattern enabled is not supported
  while using the DML Execution Provider").
- An inference session using DirectML may have Run called by only ONE thread
  at a time (onnxruntime issue #22147; multithreaded Run on the same DML
  session shows GPU resource contention, issue #20713). OrtSession therefore
  serializes run() behind a lock WHEN the session actually runs on DML;
  CPU sessions stay lock-free.

Provider demotion (stability over theoretical speed):
- A provider that produced invalid model output (NaN/inf embeddings) or that
  was executing when the process died natively (crash journal) is DEMOTED:
  a marker file records it and `auto` provider selection skips it afterwards.
- Demotion expires after RECOGNITION_DEMOTION_TTL_HOURS (default 168 = one
  week) so a driver/runtime upgrade gets a fresh chance.
- RECOGNITION_PROVIDER_DEMOTION=0 disables the whole mechanism (escape hatch
  for debugging); an EXPLICIT RECOGNITION_PROVIDERS choice is never filtered
  (the operator said exactly what they want).
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

import onnxruntime as ort

# Demotion markers live beside the index data: BASE_DIR from recognizer.config.
from .config import BASE_DIR

DEMOTION_FILE = os.path.join(BASE_DIR, "provider-demotion.json")


def demotion_enabled() -> bool:
    return os.environ.get("RECOGNITION_PROVIDER_DEMOTION", "1").strip() != "0"


def demotion_ttl_seconds() -> float:
    try:
        hours = float(os.environ.get("RECOGNITION_DEMOTION_TTL_HOURS", "168"))
    except ValueError:
        hours = 168.0
    return max(0.0, hours) * 3600.0


def _load_demotions() -> dict[str, dict]:
    try:
        with open(DEMOTION_FILE, encoding="utf-8") as fh:
            payload = json.load(fh)
        if isinstance(payload, dict):
            return {str(k): v for k, v in payload.items() if isinstance(v, dict)}
    except (OSError, ValueError):
        pass
    return {}


_demotion_lock = threading.Lock()


def demote_provider(provider: str, reason: str) -> None:
    """Record that `provider` is unstable on this machine (marker file).

    Called when a provider produces invalid model output repeatedly, or when
    the crash journal shows it was executing when the process died natively.
    Idempotent; the newest reason wins.
    """
    if not demotion_enabled() or not provider or provider in ("", "CPUExecutionProvider", "unknown"):
        return
    with _demotion_lock:
        demotions = _load_demotions()
        demotions[provider] = {"reason": reason[:300], "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            os.makedirs(os.path.dirname(DEMOTION_FILE), exist_ok=True)
            tmp = DEMOTION_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(demotions, fh, ensure_ascii=False, indent=1)
            os.replace(tmp, DEMOTION_FILE)
        except OSError:
            pass  # best effort: in-process fallback still applies


def demoted_providers() -> list[str]:
    """Providers currently demoted (marker present and not expired)."""
    if not demotion_enabled():
        return []
    ttl = demotion_ttl_seconds()
    now = time.time()
    active: list[str] = []
    for provider, entry in _load_demotions().items():
        try:
            stamped = time.mktime(time.strptime(entry.get("at", ""), "%Y-%m-%dT%H:%M:%S"))
        except ValueError:
            stamped = now
        if ttl <= 0 or now - stamped <= ttl:
            active.append(provider)
    return active


def demotion_report() -> dict:
    """Raw marker contents for /health (observability)."""
    return _load_demotions()


def preferred_providers() -> list[str]:
    """CUDA > DML > CPU, filtered by what this runtime actually exposes.

    RECOGNITION_PROVIDERS=cpu forces the CPU provider (the escape hatch when
    a benchmark on the target machine shows DML slower or unstable for a
    model); auto (default) keeps the GPU-first order. Explicit choices that
    are not installed fall back to CPU with the runtime's own warning.

    In `auto` mode, providers marked unstable on this machine (see
    demote_provider) are skipped: stability beats a theoretical speedup.
    Explicit choices are NEVER filtered by demotion.
    """
    forced = os.environ.get("RECOGNITION_PROVIDERS", "auto").strip().lower()
    available = ort.get_available_providers()
    if forced in ("cpu", "cpuexecutionprovider"):
        return ["CPUExecutionProvider"]
    if forced in ("dml", "dmlexecutionprovider"):
        return [p for p in ("DmlExecutionProvider", "CPUExecutionProvider") if p in available]
    if forced in ("cuda", "cudaexecutionprovider"):
        return [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]
    preferred = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    selected = [p for p in preferred if p in available]
    skip = set(demoted_providers())
    if skip:
        filtered = [p for p in selected if p not in skip]
        # CPU must remain the final answer; never return an empty list.
        if filtered or selected:
            selected = filtered or ["CPUExecutionProvider"]
    return selected


class OrtSession:
    """InferenceSession wrapper: DML-safe options + serialized Run on DML."""

    def __init__(self, path: str, *, intra_threads: Optional[int] = None):
        providers = preferred_providers()
        dml_candidate = "DmlExecutionProvider" in providers
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = intra_threads or max(1, (os.cpu_count() or 2))
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if dml_candidate:
            # DirectML EP: memory patterns and parallel execution unsupported
            # (official docs). Required, not a tuning knob.
            opts.enable_mem_pattern = False
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self._session = ort.InferenceSession(path, sess_options=opts, providers=providers)
        # Lock only when the session REALLY runs on DML: concurrent Run on a
        # DML session is not safe (one thread at a time, per the docs).
        self._run_lock = (threading.Lock()
                          if self.provider == "DmlExecutionProvider" else None)

    @property
    def provider(self) -> str:
        """The provider this session ACTUALLY runs on (first assigned).

        ORT silently falls back to CPU when a requested provider cannot
        initialize: listing available providers is not evidence of GPU use."""
        try:
            providers = self._session.get_providers()
        except Exception:  # noqa: BLE001
            return "unknown"
        return providers[0] if providers else "unknown"

    @property
    def input_names(self):
        return self._session.get_inputs()

    def close(self) -> None:
        """Drop the native session so its weights leave RAM.

        ORT's InferenceSession frees the (hundreds of MB of) model weights
        when the Python object is garbage-collected; a live reference was
        exactly what kept the models resident after the service's idle
        unload (measured 2026-09-24: only ~170 MB freed of ~1.1 GB because
        module-level roots kept the sessions). The next request must
        re-create the OrtSession."""
        self._session = None
        self._run_lock = None

    def get_providers(self):
        return self._session.get_providers()

    def run(self, output_names, input_feed, run_options=None):
        if self._run_lock is None:
            return self._session.run(output_names, input_feed, run_options)
        with self._run_lock:
            return self._session.run(output_names, input_feed, run_options)
