#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Long-run stability benchmark: N consecutive recognitions against the LIVE service.

Usage:
    python scripts/stress_service.py --requests 100 --image path/to/photo.jpg
    python scripts/stress_service.py --requests 50 --image dir/with/photos

Measures what the 2026-09 stability round is about:
- the process stays ALIVE (every request answered, /health before and after);
- latency mean/P50/P95/max (executionMs and totalMs, queueMs reported apart);
- errors (HTTP status or transport failure) and invalid-embedding counts
  (from /health stability block) — NaN/inf rejections must never kill the
  process and must be visible;
- service RSS growth between start and end (memory leak guard).

Exit code is non-zero when any request fails or /health goes down, so it can
gate CI-like local checks on the target machine.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:8765"


def get_health(base: str) -> dict:
    with urllib.request.urlopen(f"{base}/health", timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def service_rss_kb() -> int | None:
    """RSS of the python process running the service, when discoverable."""
    try:
        import psutil  # optional
    except ImportError:
        return None
    for proc in psutil.process_iter(["name", "cmdline", "memory_info"]):
        cmdline = proc.info.get("cmdline") or []
        if any("recognition_server" in part for part in cmdline):
            return proc.info["memory_info"].rss // 1024
    return None


def recognize(base: str, image_path: str) -> tuple[int | None, dict | None, str | None]:
    data = open(image_path, "rb").read()
    boundary = "----leilaostress"
    body = (f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"file\"; filename=\"card.jpg\"\r\n"
            f"Content-Type: image/jpeg\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        f"{base}/recognize", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return response.status, payload, None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        return exc.code, None, detail
    except Exception as exc:  # noqa: BLE001
        return None, None, str(exc)
    finally:
        del started


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round(fraction * (len(ordered) - 1)))))
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requests", type=int, default=20, help="20 / 50 / 100 ...")
    parser.add_argument("--image", required=True, help="photo file OR directory of photos")
    parser.add_argument("--base", default=DEFAULT_BASE)
    args = parser.parse_args()

    if os.path.isdir(args.image):
        photos = [os.path.join(args.image, name) for name in sorted(os.listdir(args.image))
                  if name.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    else:
        photos = [args.image]
    if not photos:
        print("[stress] no photos found", file=sys.stderr)
        sys.exit(2)

    health_before = get_health(args.base)
    rss_before = service_rss_kb()
    print(f"[stress] service ready={health_before.get('ready')} "
          f"providers={health_before.get('backend', {}).get('runtimeProviders')} "
          f"rss={rss_before} KB")
    print(f"[stress] running {args.requests} consecutive recognitions over "
          f"{len(photos)} photo(s)…")

    executions: list[float] = []
    totals: list[float] = []
    queues: list[float] = []
    failures: list[str] = []
    visual_errors = 0
    decisions: dict[str, int] = {}
    for i in range(args.requests):
        path = photos[i % len(photos)]
        status, payload, error = recognize(args.base, path)
        if status != 200 or payload is None:
            failures.append(f"request {i + 1}: HTTP {status} {error}")
            print(f"[stress] {i + 1}/{args.requests} FAIL HTTP {status}: {error}", flush=True)
            continue
        executions.append(float(payload.get("executionMs") or 0))
        totals.append(float(payload.get("totalMs") or 0))
        queues.append(float(payload.get("queueMs") or 0))
        if payload.get("visualError"):
            visual_errors += 1
        decision = payload.get("decision") or "?"
        decisions[decision] = decisions.get(decision, 0) + 1
        if (i + 1) % 10 == 0 or i + 1 == args.requests:
            print(f"[stress] {i + 1}/{args.requests} ok (last execution "
                  f"{executions[-1]:.0f} ms)", flush=True)

    health_after = get_health(args.base)
    rss_after = service_rss_kb()
    stability = health_after.get("stability", {})
    print("\n[stress] ===== summary =====")
    print(f"[stress] requests: {args.requests} · failures: {len(failures)} · "
          f"service alive: {health_after.get('status') == 'ok'}")
    if executions:
        print(f"[stress] executionMs: mean {sum(executions) / len(executions):.0f} · "
              f"P50 {percentile(executions, 0.50):.0f} · "
              f"P95 {percentile(executions, 0.95):.0f} · "
              f"max {max(executions):.0f}")
        print(f"[stress] totalMs (incl. queue): mean {sum(totals) / len(totals):.0f} · "
              f"P95 {percentile(totals, 0.95):.0f} · max {max(totals):.0f} · "
              f"queueMax {max(queues):.0f}")
    print(f"[stress] decisions: {decisions}")
    print(f"[stress] visual route disabled by invalid embedding: {visual_errors} "
          f"(service-side counter: {stability.get('invalidEmbeddings')})")
    if rss_before is not None and rss_after is not None:
        print(f"[stress] service RSS: {rss_before} KB -> {rss_after} KB "
              f"(delta {rss_after - rss_before:+d} KB)")
    else:
        print("[stress] service RSS: not measured (psutil not installed)")
    for failure in failures[:10]:
        print(f"[stress] failure: {failure}")
    if failures or health_after.get("status") != "ok":
        sys.exit(1)
    print("[stress] PASS: service stayed alive and answered every request")


if __name__ == "__main__":
    main()
