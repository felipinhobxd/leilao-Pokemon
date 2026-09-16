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

These options are only conservative for a session that silently falls back
to CPU: correctness is unaffected, and the CPU path keeps its own defaults.
"""
from __future__ import annotations

import os
import threading
from typing import Optional

import onnxruntime as ort


def preferred_providers() -> list[str]:
    """CUDA > DML > CPU, filtered by what this runtime actually exposes.

    RECOGNITION_PROVIDERS=cpu forces the CPU provider (the escape hatch when
    a benchmark on the target machine shows DML slower or unstable for a
    model); auto (default) keeps the GPU-first order. Explicit choices that
    are not installed fall back to CPU with the runtime's own warning."""
    forced = os.environ.get("RECOGNITION_PROVIDERS", "auto").strip().lower()
    available = ort.get_available_providers()
    if forced in ("cpu", "cpuexecutionprovider"):
        return ["CPUExecutionProvider"]
    if forced in ("dml", "dmlexecutionprovider"):
        return [p for p in ("DmlExecutionProvider", "CPUExecutionProvider") if p in available]
    if forced in ("cuda", "cudaexecutionprovider"):
        return [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]
    preferred = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    return [p for p in preferred if p in available]


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

    def get_providers(self):
        return self._session.get_providers()

    def run(self, output_names, input_feed, run_options=None):
        if self._run_lock is None:
            return self._session.run(output_names, input_feed, run_options)
        with self._run_lock:
            return self._session.run(output_names, input_feed, run_options)
