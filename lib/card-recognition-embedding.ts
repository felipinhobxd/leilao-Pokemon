type TensorLike = { dims: number[]; data: ArrayLike<number | bigint> };

// DINOv2 ONNX exports commonly expose token embeddings, not pooler_output.
// The first token is the global image (CLS) representation, not a patch average.
export function extractDinoEmbedding(outputs: Record<string, TensorLike>) {
  const key = outputs.pooler_output ? "pooler_output" : "last_hidden_state";
  const tensor = outputs[key];
  const dims = tensor?.dims;
  const expectedRank = key === "pooler_output" ? 2 : 3;
  if (!dims || dims.length !== expectedRank || dims[0] !== 1 || dims.some(n => !Number.isInteger(n) || n < 1)) {
    throw new Error(`DINOv2 output incompatible: ${Object.entries(outputs).map(([name, value]) => `${name}[${value?.dims?.join(',') ?? '?'}]`).join('; ')}`);
  }
  const width = dims[dims.length - 1];
  if (tensor.data.length !== dims.reduce((a, b) => a * b, 1)) throw new Error("DINOv2 tensor length mismatch");
  const values = Array.from({ length: width }, (_, i) => Number(tensor.data[i]));
  const norm = Math.hypot(...values);
  if (!values.every(Number.isFinite) || !Number.isFinite(norm) || norm === 0) throw new Error("DINOv2 embedding invalid");
  return { values: values.map(value => value / norm), output: key === "pooler_output" ? key : "last_hidden_state/CLS" };
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) throw new Error("Invalid embedding dimensions");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  if (!Number.isFinite(dot) || !aa || !bb) throw new Error("Invalid cosine inputs");
  return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}
