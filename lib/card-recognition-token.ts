import { createHmac, randomBytes } from "node:crypto";

const DEFAULT_TTL_SECONDS = 5 * 60;
const AUDIENCE = "pokemon-card-recognition";
const TOKEN_VERSION = 1;

function secret() {
  const value = process.env.RECOGNITION_SERVICE_SHARED_SECRET?.trim();
  if (!value) throw new Error("recognition_service_secret_missing");
  if (value.length < 32) throw new Error("recognition_service_secret_too_short");
  return value;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string, sharedSecret: string) {
  return createHmac("sha256", sharedSecret).update(payload).digest("base64url");
}

export type RecognitionServiceToken = {
  token: string;
  expiresAt: string;
};

export function issueRecognitionServiceToken(subject: string, nowMs = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS): RecognitionServiceToken {
  if (!subject?.trim()) throw new Error("recognition_service_subject_missing");
  const ttl = Math.max(30, Math.min(15 * 60, Math.floor(ttlSeconds)));
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + ttl;
  const payload = base64Url(JSON.stringify({
    v: TOKEN_VERSION,
    aud: AUDIENCE,
    sub: subject,
    iat: issuedAt,
    exp: expiresAt,
    jti: base64Url(randomBytes(16)),
  }));
  const token = `${payload}.${signature(payload, secret())}`;
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}
