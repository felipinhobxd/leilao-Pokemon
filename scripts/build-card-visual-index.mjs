#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";
const PAGE_SIZE = 100;
const DESCRIPTOR_BYTES = 36;
const MAX_RAW_INDEX_BYTES = 6 * 1024 * 1024;
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CARD_INDEX_CONCURRENCY || 6)));
const OUTPUT_ARG = process.argv.indexOf("--output");
const OUTPUT_DIR = OUTPUT_ARG >= 0 ? process.argv[OUTPUT_ARG + 1] : "public/card-recognition";
const MAX_CARDS_ARG = process.argv.indexOf("--max-cards");
const MAX_CARDS = MAX_CARDS_ARG >= 0 ? Math.max(1, Number(process.argv[MAX_CARDS_ARG + 1])) : Infinity;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { "user-agent": "leilao-pokemon-card-index/1.0" }, signal: AbortSignal.timeout(20_000) });
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await sleep(750 * 2 ** attempt);
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function fetchBuffer(url, attempt = 0) {
  const response = await fetch(url, { headers: { "user-agent": "leilao-pokemon-card-index/1.0" }, signal: AbortSignal.timeout(25_000) });
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await sleep(900 * 2 ** attempt);
    return fetchBuffer(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function listPhysicalCards() {
  const cards = [];
  const seen = new Set();
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      image: "notlike:/tcgp/",
      "pagination:page": String(page),
      "pagination:itemsPerPage": String(PAGE_SIZE),
    });
    const batch = await fetchJson(`${TCGDEX_BASE}/cards?${params}`);
    if (!Array.isArray(batch)) throw new Error("TCGdex card list returned a non-array payload");
    for (const card of batch) {
      if (!card?.id || !card?.image || String(card.image).includes("/tcgp/") || seen.has(card.id)) continue;
      seen.add(card.id);
      cards.push({ id: String(card.id), image: String(card.image), localId: String(card.localId ?? ""), name: String(card.name ?? "") });
      if (cards.length >= MAX_CARDS) return cards;
    }
    process.stdout.write(`catalog page ${page}: ${cards.length} physical images\n`);
    if (batch.length < PAGE_SIZE || cards.length >= MAX_CARDS) break;
    await sleep(80);
  }
  return cards;
}

function region(width, height, x0, y0, x1, y1) {
  const left = Math.max(0, Math.min(width - 1, Math.round(width * x0)));
  const top = Math.max(0, Math.min(height - 1, Math.round(height * y0)));
  const right = Math.max(left + 1, Math.min(width, Math.round(width * x1)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round(height * y1)));
  return { left, top, width: right - left, height: bottom - top };
}

async function dHash(buffer, metadata, x0, y0, x1, y1) {
  const pixels = await sharp(buffer)
    .extract(region(metadata.width, metadata.height, x0, y0, x1, y1))
    .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
    .grayscale()
    .raw()
    .toBuffer();
  const hash = Buffer.alloc(8);
  for (let y = 0; y < 8; y += 1) {
    let value = 0;
    for (let x = 0; x < 8; x += 1) if (pixels[y * 9 + x] > pixels[y * 9 + x + 1]) value |= 1 << (7 - x);
    hash[y] = value;
  }
  return hash;
}

async function histogram(buffer, metadata) {
  const pixels = await sharp(buffer)
    .extract(region(metadata.width, metadata.height, 0.04, 0.08, 0.96, 0.75))
    .resize(24, 32, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const bins = new Float64Array(12);
  const count = Math.max(1, pixels.length / 3);
  for (let i = 0; i < pixels.length; i += 3) {
    bins[Math.min(3, Math.floor(pixels[i] / 64))] += 1;
    bins[4 + Math.min(3, Math.floor(pixels[i + 1] / 64))] += 1;
    bins[8 + Math.min(3, Math.floor(pixels[i + 2] / 64))] += 1;
  }
  return Buffer.from(Array.from(bins, value => Math.max(0, Math.min(255, Math.round(value / count * 255)))));
}

async function descriptorFor(card) {
  const imageUrl = `${card.image}/low.webp`;
  const buffer = await fetchBuffer(imageUrl);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${card.id}: image has no dimensions`);
  const parts = await Promise.all([
    dHash(buffer, metadata, 0.06, 0.12, 0.94, 0.60),
    dHash(buffer, metadata, 0.03, 0.06, 0.97, 0.76),
    dHash(buffer, metadata, 0.00, 0.00, 1.00, 1.00),
    histogram(buffer, metadata),
  ]);
  const descriptor = Buffer.concat(parts);
  if (descriptor.length !== DESCRIPTOR_BYTES) throw new Error(`${card.id}: descriptor size mismatch`);
  return { card, descriptor, sourceBytes: buffer.length };
}

function clean(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

async function main() {
  const started = Date.now();
  const cards = await listPhysicalCards();
  const estimatedBinary = cards.length * DESCRIPTOR_BYTES;
  const estimatedMeta = cards.reduce((sum, card) => sum + Buffer.byteLength(`${card.id}\t${card.image}\t${card.localId}\t${clean(card.name)}\n`), 0);
  console.log(JSON.stringify({ phase: "estimate", cards: cards.length, descriptorBytesPerCard: DESCRIPTOR_BYTES, estimatedBinary, estimatedMeta, estimatedRawTotal: estimatedBinary + estimatedMeta }, null, 2));
  if (estimatedBinary + estimatedMeta > MAX_RAW_INDEX_BYTES) {
    throw new Error(`Estimated raw index ${(estimatedBinary + estimatedMeta) / 1024 / 1024} MiB exceeds ${MAX_RAW_INDEX_BYTES / 1024 / 1024} MiB budget`);
  }

  const descriptors = new Array(cards.length);
  const metadata = new Array(cards.length);
  let sourceDownloadBytes = 0;
  let completed = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < cards.length) {
      const index = cursor++;
      const card = cards[index];
      try {
        const result = await descriptorFor(card);
        descriptors[index] = result.descriptor;
        metadata[index] = `${clean(card.id)}\t${clean(card.image)}\t${clean(card.localId)}\t${clean(card.name)}`;
        sourceDownloadBytes += result.sourceBytes;
      } catch (error) {
        failed += 1;
        console.warn(`skip ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      completed += 1;
      if (completed % 100 === 0 || completed === cards.length) console.log(`fingerprints ${completed}/${cards.length} (failed ${failed})`);
      if (completed % 40 === 0) await sleep(60);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const keptDescriptors = [];
  const keptMeta = [];
  for (let i = 0; i < cards.length; i += 1) {
    if (!descriptors[i] || !metadata[i]) continue;
    keptDescriptors.push(descriptors[i]);
    keptMeta.push(metadata[i]);
  }
  const binary = Buffer.concat(keptDescriptors);
  const meta = `${keptMeta.join("\n")}\n`;
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, "index-v1.bin"), binary),
    fs.writeFile(path.join(OUTPUT_DIR, "index-v1.meta.tsv"), meta),
  ]);
  const stats = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "TCGdex REST v2 English physical cards",
    cardsListed: cards.length,
    cardsIndexed: keptMeta.length,
    cardsSkipped: failed,
    descriptorBytesPerCard: DESCRIPTOR_BYTES,
    binaryBytes: binary.length,
    metadataBytes: Buffer.byteLength(meta),
    rawTotalBytes: binary.length + Buffer.byteLength(meta),
    sourceDownloadBytes,
    buildMs: Date.now() - started,
    concurrency: CONCURRENCY,
    descriptors: ["dhash-artwork", "dhash-broad-art", "dhash-whole", "rgb4-art-histogram"],
  };
  await fs.writeFile(path.join(OUTPUT_DIR, "index-v1.stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
