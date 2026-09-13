function encodeValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: "Buffer", data: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
  }
  return value;
}

function decodeValue(value) {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === "object") {
    if (value.type === "Buffer" && typeof value.data === "string") {
      return Buffer.from(value.data, "base64");
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]));
  }
  return value;
}

export function serializePollMessage(message) {
  // Do not call JSON.stringify() on the protobuf object before this walk:
  // protobuf toJSON() converts bytes to base64 strings and loses byte typing.
  return encodeValue(message);
}

export function revivePollMessage(value) {
  const revived = decodeValue(value);
  // Backward compatibility with dispatches persisted before the typed-byte fix.
  const secret = revived?.messageContextInfo?.messageSecret;
  if (typeof secret === "string") {
    try {
      const bytes = Buffer.from(secret, "base64");
      if (bytes.length === 32) revived.messageContextInfo.messageSecret = bytes;
    } catch {}
  }
  return revived;
}
