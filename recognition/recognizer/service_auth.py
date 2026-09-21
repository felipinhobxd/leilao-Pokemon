# -*- coding: utf-8 -*-
"""Short-lived capability tokens used by the local recognition service.

The shared secret exists only in the Next.js server environment and on the
local recognition machine. The browser receives only a short-lived, signed
capability minted after the administrator authenticated to the panel.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

AUDIENCE = "pokemon-card-recognition"
CLOCK_SKEW_SECONDS = 30
MAX_TOKEN_SECONDS = 15 * 60


class ServiceAuthError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _secret() -> bytes:
    raw = os.environ.get("RECOGNITION_SERVICE_SHARED_SECRET", "").strip()
    if len(raw) < 32:
        raise ServiceAuthError(503, "Reconhecimento local não configurado.")
    return raw.encode("utf-8")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_service_token(authorization_header: str | None) -> dict[str, Any]:
    """Verify a Next.js-issued HMAC token without importing FastAPI.

    Keeping this verifier dependency-free lets the lightweight recognition
    regression suite exercise the exact authentication primitive.
    """
    header = str(authorization_header or "")
    if not header.startswith("Bearer "):
        raise ServiceAuthError(401, "Token do reconhecimento local ausente.")
    token = header[7:].strip()
    parts = token.split(".")
    if len(parts) != 2 or any(not part for part in parts):
        raise ServiceAuthError(401, "Token do reconhecimento local inválido.")

    payload_b64, supplied_signature = parts
    try:
        expected = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
        supplied = _b64url_decode(supplied_signature)
        if not hmac.compare_digest(expected, supplied):
            raise ServiceAuthError(401, "Token do reconhecimento local inválido.")
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except ServiceAuthError:
        raise
    except Exception as exc:
        raise ServiceAuthError(401, "Token do reconhecimento local inválido.") from exc

    if not isinstance(payload, dict) or payload.get("v") != 1 or payload.get("aud") != AUDIENCE:
        raise ServiceAuthError(401, "Token do reconhecimento local inválido.")

    try:
        issued_at = int(payload["iat"])
        expires_at = int(payload["exp"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ServiceAuthError(401, "Token do reconhecimento local inválido.") from exc

    now = int(time.time())
    if expires_at <= now - CLOCK_SKEW_SECONDS or issued_at > now + CLOCK_SKEW_SECONDS:
        raise ServiceAuthError(401, "Token do reconhecimento local expirado.")
    if expires_at - issued_at < 1 or expires_at - issued_at > MAX_TOKEN_SECONDS:
        raise ServiceAuthError(401, "Token do reconhecimento local inválido.")
    return payload
