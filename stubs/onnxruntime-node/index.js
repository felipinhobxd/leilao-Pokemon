// Stub intencional de onnxruntime-node (ver package.json).
// Este projeto NUNCA roda inferência de transformers.js em Node: o pipeline
// do navegador (Web Worker) usa o build web (onnxruntime-web) e o pipeline
// forte roda no serviço local Python. O pacote real (210 MB de binários
// nativos) só inflava node_modules, o cache de build do Vercel e a instalação
// local. Qualquer código que tente de fato usar este backend recebe um erro
// explícito em vez de um crash silencioso.
module.exports = new Proxy({}, {
  get() {
    throw new Error(
      "onnxruntime-node foi substituído por stub: inferência Node não é suportada " +
      "neste projeto. Use o serviço local (127.0.0.1:8765) ou o pipeline do navegador."
    );
  },
});
