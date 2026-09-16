# -*- coding: utf-8 -*-
"""Crash journal: know WHICH providers were executing if the process dies.

A native crash (Windows 0xC0000005 access violation inside an ONNX execution
provider) cannot be caught in Python — the process is simply gone. What CAN
be done: write a tiny atomic file at the START of every recognition request
and remove it when the request completes. If the file is still there on the
next startup, the previous process died mid-request, and the file says which
providers were live at that moment. Those providers get demoted (see
ort_session.demote_provider): stability beats a theoretical speedup, and the
service must not crash again on the same photo.
"""
from __future__ import annotations

import json
import os
import time
from typing import Optional

from .config import BASE_DIR
from .ort_session import demote_provider

JOURNAL_PATH = os.path.join(BASE_DIR, "last-request.json")


def journal_write(path: str, request_id: str, providers: dict) -> None:
    """Atomically record the in-flight request + live providers."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"id": request_id, "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                       "providers": providers}, fh)
        os.replace(tmp, path)
    except OSError:
        pass  # diagnostic only: never block recognition on journal trouble


def journal_clear(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def journal_check_previous_crash(path: Optional[str] = None) -> Optional[dict]:
    """Startup: an leftover journal means the previous process died mid-request.

    The recorded providers are demoted (stability over theoretical speed): a
    native crash inside an execution provider cannot be caught in Python, so
    the only safe answer is to not run that provider again on this machine
    until the demotion marker expires. Returns the recovered entry (for
    logging/health) or None when the previous shutdown was clean.
    """
    journal_path = path or JOURNAL_PATH
    try:
        with open(journal_path, encoding="utf-8") as fh:
            entry = json.load(fh)
    except (OSError, ValueError):
        return None
    providers = entry.get("providers") or {}
    executing = [p for p in (providers.get("embedding"), providers.get("ocrDetector"),
                             providers.get("ocrRecognizer"))
                 if p and p != "not-loaded"]
    for provider in executing:
        demote_provider(provider, f"process died natively mid-request (crash journal, {entry.get('at')})")
    journal_clear(journal_path)
    return {"id": entry.get("id"), "at": entry.get("at"), "providers": executing}
