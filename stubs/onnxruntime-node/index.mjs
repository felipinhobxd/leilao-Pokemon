// Contraparte ESM do stub (transformers.node.mjs faz import * as ONNX_NODE).
// Sem exports nomeados de propósito: qualquer uso real do backend Node falha
// de forma explícita (ver index.js).
const stub = new Proxy({}, {
  get() {
    throw new Error(
      "onnxruntime-node foi substituído por stub: inferência Node não é suportada " +
      "neste projeto. Use o serviço local (127.0.0.1:8765) ou o pipeline do navegador."
    );
  },
});
export default stub;
