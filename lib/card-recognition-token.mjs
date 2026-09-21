import { createHmac, randomBytes } from "node:crypto";

const DEFAULT_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 15 * 60;
const AUDIENCE = "pokemon-card-recognition";
const TOKEN_VERSION = 1;

function secret() {
  const value = process.env.RECOGNITION_SERVICE_SHARED_SECRET?.trim();
  if (!value) throw new Error("recognition_service_secret_missing");
  if (value.length < 32) throw new Error("recognition_service_secret_too_short");
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueRecognitionServiceToken(subject, nowMs = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!String(subject ?? "").trim()) throw new Error("recognition_service_subject_missing");
  const ttl = Math.max(30, Math.min(MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds) || DEFAULT_TTL_SECONDS)));
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + ttl;
  const payload = base64Url(JSON.stringify({
    v: TOKEN_VERSION,
    aud: AUDIENCE,
    sub: String(subject),
    iat: issuedAt,
    exp: expiresAt,
    jti: base64Url(randomBytes(16)),
  }));
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}
