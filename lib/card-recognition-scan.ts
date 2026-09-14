/** Only official TCGdex card scan paths; never proxy arbitrary hosts or redirects. */
export function officialScanUrl(base: string) {
  const url = new URL(base);
  if (url.protocol !== "https:" || url.hostname !== "assets.tcgdex.net" || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/(?:pt|pt-br|en|es|ja)\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(url.pathname) ||
      url.pathname.includes("/tcgp/")) throw new Error("Invalid official scan URL");
  return url.href + "/low.webp";
}

export async function serveOfficialScan(request: Request): Promise<Response> {
  let url: string;
  try { url = officialScanUrl(new URL(request.url).searchParams.get("base") ?? ""); }
  catch { return Response.json({ stage: "scan-url", error: "Invalid official scan URL" }, { status: 400 }); }
  try {
    const upstream = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!upstream.ok) return Response.json({ stage: "scan-fetch", url, upstreamStatus: upstream.status },
      { status: upstream.status === 404 ? 404 : 502, headers: { "Cache-Control": "no-store" } });
    const type = upstream.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/webp", "image/png", "image/jpeg"].includes(type)) throw new Error("Invalid scan content-type: " + type);
    const reader = upstream.body?.getReader();
    if (!reader) throw new Error("Empty scan response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new Error("Scan exceeds 2 MB");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    if (!size) throw new Error("Empty scan");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { headers: { "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ stage: "scan-fetch", url, error: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
