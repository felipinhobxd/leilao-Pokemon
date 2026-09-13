import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const baileysEntry = require.resolve("@whiskeysockets/baileys");
const target = path.join(path.dirname(baileysEntry), "Socket", "messages-recv.js");
const source = await readFile(target, "utf8");

const vulnerable = "buildAckStanza(node, errorCode, authState.creds.me.id)";
const patched = "buildAckStanza(node, errorCode, authState.creds.me?.id)";
const checkOnly = process.argv.includes("--check");

if (source.includes(patched)) {
  console.log("Baileys pre-login ACK patch already applied.");
  process.exit(0);
}

if (checkOnly) {
  throw new Error("Baileys pre-login ACK patch is missing.");
}

const matches = source.split(vulnerable).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one vulnerable Baileys ACK call, found ${matches}. Refusing to patch an unknown build.`);
}

await writeFile(target, source.replace(vulnerable, patched), "utf8");
console.log("Applied Baileys pre-login ACK patch for QR pairing.");
