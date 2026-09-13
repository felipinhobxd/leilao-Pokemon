import { createHash } from "node:crypto";

export function dispatchMessageId(dispatchId, kind) {
  const value = String(dispatchId ?? "").trim();
  if (!value) throw new Error("dispatch_id_required");
  const suffix = createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 16).toUpperCase();
  return `3EB0${suffix}`;
}

export function dispatchPollSecret(dispatchId) {
  const value = String(dispatchId ?? "").trim();
  if (!value) throw new Error("dispatch_id_required");
  return createHash("sha256").update(`poll-secret:${value}`).digest();
}
