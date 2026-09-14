try {
  const { createOCR } = await import("https://cdn.jsdelivr.net/npm/web-sdk-pp-ocrv6@0.2.0/+esm");
  globalThis.__LEILAO_PPOCRV6__ = { createOCR };
  globalThis.dispatchEvent(new Event("leilao:ppocrv6-ready"));
} catch (error) {
  globalThis.__LEILAO_PPOCRV6_ERROR__ = error instanceof Error ? error.message : String(error);
  globalThis.dispatchEvent(new Event("leilao:ppocrv6-error"));
}
