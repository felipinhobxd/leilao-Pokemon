import { createRequire } from "node:module";

// Loaded only by service.mjs through Node's --import hook. It intercepts the
// terminal QR renderer used by the legacy bot so the supervisor can publish a
// short-lived QR to the authenticated admin panel without touching Baileys
// credentials or session files.
const require = createRequire(import.meta.url);
const qrcode = require("qrcode-terminal");
const originalGenerate = qrcode.generate.bind(qrcode);

qrcode.generate = (input, opts, callback) => {
  let render = "";
  originalGenerate(String(input), { ...(opts ?? {}), small: true }, code => {
    render = code;
  });

  const payload = Buffer.from(String(input), "utf8").toString("base64url");
  const rendered = Buffer.from(render, "utf8").toString("base64url");
  process.stdout.write(`__LEILAO_QR__${payload}:${rendered}\n`);

  if (typeof callback === "function") callback(render);
};
