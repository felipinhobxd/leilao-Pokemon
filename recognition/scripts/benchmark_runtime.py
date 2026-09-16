#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Runtime provider benchmark: CPU vs DirectML on the TARGET machine.

Measures, per model session and for the full pipeline:
- warm-up time (session creation + first inference, reported SEPARATELY from
  the steady-state numbers — first-inference cost is paid once per process);
- steady-state inference latency (mean / P50 / P95 / max) over N runs;
- peak process RAM (RSS, sampled);
- GPU memory (best-effort: Windows performance counters; unavailable is
  reported as such, never guessed);
- errors (a model that cannot init or run on a provider is reported, not
  hidden — that is exactly the "bad model falls back to CPU" case).

Providers are compared in SEPARATE PROCESSES (RECOGNITION_PROVIDERS is read
once at session creation), so provider state never leaks between runs.

Decision policy (printed at the end, applied by a HUMAN, never silently):
- DML is only recommended for a model when it is BOTH faster AND error-free;
- if DML loses on any model, run the service with RECOGNITION_PROVIDERS=cpu
  (whole-service) or accept per-session auto fallback;
- results with 0 errors and stable P95 are "stable"; anything else is noise.

Usage (Windows target machine, from recognition/):
    python scripts/benchmark_runtime.py --runs 20 --image some_card_photo.jpg
    python scripts/benchmark_runtime.py --providers cpu,dml --json out.json
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MODELS_DIR = os.environ.get(
    "RECOGNITION_MODELS",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"),
)

# (label, file, input-builder) for every ONNX session the service loads.
def _siglip2_input():
    return {"input_ids": np.zeros((1, 1), dtype=np.int64),
            "pixel_values": np.random.default_rng(0).normal(0, 1, (1, 3, 384, 384)).astype(np.float32)}


def _det_input():
    return {"x": np.random.default_rng(0).normal(0, 1, (1, 3, 800, 800)).astype(np.float32)}


def _rec_input():
    return {"x": np.random.default_rng(0).normal(0, 1, (1, 3, 48, 320)).astype(np.float32)}


SESSIONS = [
    ("siglip2-base-384", "siglip2-base-384.onnx", _siglip2_input),
    ("ppocrv6-det", "ppocrv6-medium-det.onnx", _det_input),
    ("ppocrv6-rec", "ppocrv6-medium-rec.onnx", _rec_input),
]


def _percentiles(samples: list[float]) -> dict:
    if not samples:
        return {"meanMs": None, "p50Ms": None, "p95Ms": None, "maxMs": None, "runs": 0}
    ordered = sorted(samples)
    return {
        "meanMs": round(statistics.fmean(ordered), 2),
        "p50Ms": round(ordered[len(ordered) // 2], 2),
        "p95Ms": round(ordered[max(0, int(len(ordered) * 0.95) - 1)], 2),
        "maxMs": round(ordered[-1], 2),
        "runs": len(ordered),
    }


def _peak_rss_sampler():
    """Background RSS sampler; returns (stop, get_peak_mb)."""
    try:
        import threading
        import resource
        peak = {"rss_kb": 0}
        stop = threading.Event()

        def sample():
            while not stop.is_set():
                try:
                    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                    peak["rss_kb"] = max(peak["rss_kb"], rss)
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(0.05)
        # ru_maxrss is a high-water mark, no thread needed on POSIX.
        return lambda: None, lambda: round(peak["rss_kb"] / 1024.0, 1)
    except Exception:  # noqa: BLE001
        return (lambda: None), (lambda: None)


def gpu_memory_summary() -> dict:
    """Best-effort GPU memory info. Windows: performance counters via
    PowerShell; nvidia-smi when present (NVIDIA only). Never guesses."""
    try:
        import subprocess as sp
        out = sp.run(["nvidia-smi", "--query-gpu=memory.total,memory.used",
                      "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        if out.returncode == 0 and out.stdout.strip():
            total, used = [x.strip() for x in out.stdout.strip().splitlines()[0].split(",")]
            return {"source": "nvidia-smi", "totalMb": int(total), "usedMb": int(used)}
    except Exception:  # noqa: BLE001
        pass
    if os.name == "nt":
        try:
            import subprocess as sp
            query = ("Get-Counter '\\GPU Process Memory(*)\\Local Usage' "
                     "-ErrorAction SilentlyContinue | Select-Object -ExpandProperty CounterSamples | "
                     "Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum")
            out = sp.run(["powershell", "-NoProfile", "-Command", query],
                         capture_output=True, text=True, timeout=20)
            if out.returncode == 0 and out.stdout.strip():
                return {"source": "perfmon", "gpuProcessMemoryMb": round(float(out.stdout.strip()) / 1e6, 1)}
        except Exception:  # noqa: BLE001
            pass
    return {"source": "unavailable"}


def run_provider(provider: str, runs: int, warmups: int, image_path: str | None) -> dict:
    """One provider, one process. Prints a JSON result to stdout (consumed by
    the parent); human-readable progress goes to stderr."""
    result = {"provider": provider, "sessions": {}, "pipeline": None,
              "gpu": gpu_memory_summary(), "errors": []}
    import onnxruntime as ort
    result["availableProviders"] = list(ort.get_available_providers())

    from recognizer.ort_session import OrtSession
    for label, filename, input_builder in SESSIONS:
        path = os.path.join(MODELS_DIR, filename)
        entry: dict = {"model": filename}
        if not os.path.exists(path):
            entry["error"] = "model file missing"
            result["sessions"][label] = entry
            result["errors"].append(f"{label}: model file missing")
            print(json.dumps(result), file=sys.stdout, flush=True) if False else None
            continue
        try:
            started = time.perf_counter()
            session = OrtSession(path)
            entry["loadSec"] = round(time.perf_counter() - started, 3)
            entry["actualProvider"] = session.provider
            feed = input_builder()
            # Warm-up: first inference includes graph/DML pipeline setup and is
            # reported SEPARATELY (it is a one-time cost, not steady state).
            warm_times = []
            for _ in range(warmups):
                t0 = time.perf_counter()
                session.run(None, feed)
                warm_times.append((time.perf_counter() - t0) * 1000.0)
            entry["warmup"] = _percentiles(warm_times)
            samples = []
            for _ in range(runs):
                t0 = time.perf_counter()
                session.run(None, feed)
                samples.append((time.perf_counter() - t0) * 1000.0)
            entry["steady"] = _percentiles(samples)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = f"{type(exc).__name__}: {exc}"[:300]
            result["errors"].append(f"{label}: {entry['error']}")
        result["sessions"][label] = entry

    # Full pipeline (only when the embedding index exists): a synthetic
    # normalized-card image through Recognizer.recognize, end to end.
    if image_path:
        try:
            import cv2
            from recognizer.config import EMBEDDINGS_DIR, DEFAULT_EMBEDDING
            index_path = os.path.join(EMBEDDINGS_DIR, f"{DEFAULT_EMBEDDING}.npz")
            if not os.path.exists(index_path):
                result["pipeline"] = {"error": f"index missing: {index_path}"}
            else:
                data = np.fromfile(image_path, dtype=np.uint8)
                bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
                if bgr is None:
                    result["pipeline"] = {"error": "could not decode image"}
                else:
                    from recognizer.pipeline import Recognizer
                    from recognizer.store import CatalogStore
                    recognizer = Recognizer(catalog=CatalogStore())
                    recognizer.warm()
                    result["pipeline"] = {
                        "embeddingProvider": recognizer.runtime_providers()["embedding"],
                        "ocrProvider": recognizer.runtime_providers()["ocrDetector"],
                    }
                    recognizer.recognize(bgr)  # one full warm-up
                    samples = []
                    for _ in range(max(3, runs // 2)):
                        t0 = time.perf_counter()
                        recognizer.recognize(bgr)
                        samples.append((time.perf_counter() - t0) * 1000.0)
                    result["pipeline"]["steady"] = _percentiles(samples)
        except Exception as exc:  # noqa: BLE001
            result["pipeline"] = {"error": f"{type(exc).__name__}: {exc}"[:300]}
            result["errors"].append(f"pipeline: {result['pipeline']['error']}")

    try:
        import resource
        result["peakRssMb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1)
    except Exception:  # noqa: BLE001
        result["peakRssMb"] = None
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--providers", default="cpu,dml", help="comma list: cpu,dml,cuda,auto")
    parser.add_argument("--runs", type=int, default=20, help="steady-state runs per session")
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--image", default=None, help="card photo for the end-to-end pipeline test")
    parser.add_argument("--json", default=None, help="also write results to this file")
    args = parser.parse_args()

    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    results = []
    for provider in providers:
        print(f"\n[benchmark] provider={provider} (separate process)", flush=True)
        env = dict(os.environ)
        env["RECOGNITION_PROVIDERS"] = provider
        cmd = [sys.executable, os.path.abspath(__file__),
               "--_worker", provider, "--runs", str(args.runs),
               "--warmups", str(args.warmups)]
        if args.image:
            cmd += ["--image", args.image]
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=3600)
        payload = None
        for line in proc.stdout.strip().splitlines():
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
        if payload is None:
            payload = {"provider": provider, "errors": [f"worker failed: {proc.stderr[-400:]}"]}
        results.append(payload)
        if proc.stderr.strip():
            print(proc.stderr.strip()[:800], file=sys.stderr)

    print("\n" + "=" * 78)
    print("RUNTIME PROVIDER BENCHMARK — steady-state latency (ms)")
    print("=" * 78)
    for result in results:
        provider = result.get("provider", "?")
        print(f"\n[{provider}] errors: {len(result.get('errors', []))}")
        for error in result.get("errors", [])[:5]:
            print(f"  ! {error}")
        for label, entry in result.get("sessions", {}).items():
            if "error" in entry:
                print(f"  {label:18s} ERROR: {entry['error'][:90]}")
                continue
            steady = entry.get("steady", {})
            print(f"  {label:18s} actual={entry.get('actualProvider', '?'):24s} "
                  f"mean={steady.get('meanMs')}ms p50={steady.get('p50Ms')}ms "
                  f"p95={steady.get('p95Ms')}ms warmup={entry.get('warmup', {}).get('meanMs')}ms")
        pipeline = result.get("pipeline")
        if isinstance(pipeline, dict) and "steady" in pipeline:
            steady = pipeline["steady"]
            print(f"  {'FULL PIPELINE':18s} embed={pipeline.get('embeddingProvider', '?'):24s} "
                  f"mean={steady.get('meanMs')}ms p50={steady.get('p50Ms')}ms p95={steady.get('p95Ms')}ms")
        elif isinstance(pipeline, dict):
            print(f"  {'FULL PIPELINE':18s} skipped: {pipeline.get('error', 'no image/index')}")
        print(f"  peak RSS: {result.get('peakRssMb')} MB · GPU: {result.get('gpu')}")

    print("\nDecision policy: use DML for a model ONLY if it is faster AND error-free;")
    print("otherwise run the service with RECOGNITION_PROVIDERS=cpu (or accept auto fallback).")
    print("DML sessions are already created with the official safety options and a")
    print("serialized Run lock (see recognizer/ort_session.py).")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)
        print(f"\n[benchmark] results written to {args.json}")


def _worker_main() -> None:
    """Child process entry: run one provider and print ONE JSON line."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--_worker", required=True)
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--image", default=None)
    args = parser.parse_args()
    result = run_provider(args._worker, args.runs, args.warmups, args.image)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    if "--_worker" in sys.argv:
        _worker_main()
    else:
        main()
