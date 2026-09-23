import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const baileysEntry = require.resolve("@whiskeysockets/baileys");
const libDir = path.dirname(baileysEntry);
const recvTarget = path.join(libDir, "Socket", "messages-recv.js");
const socketTarget = path.join(libDir, "Socket", "socket.js");
const companionTarget = path.join(libDir, "Utils", "companion-reg-client-utils.js");
const checkOnly = process.argv.includes("--check");

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

async function patchPreLoginAck() {
  let source = await readFile(recvTarget, "utf8");
  const vulnerable = "buildAckStanza(node, errorCode, authState.creds.me.id)";
  const patched = "buildAckStanza(node, errorCode, authState.creds.me?.id)";

  if (source.includes(patched)) return "already";
  if (checkOnly) throw new Error("Baileys pre-login ACK patch is missing.");

  const matches = occurrences(source, vulnerable);
  if (matches !== 1) {
    throw new Error(`Expected exactly one vulnerable Baileys ACK call, found ${matches}. Refusing to patch an unknown build.`);
  }

  source = source.replace(vulnerable, patched);
  await writeFile(recvTarget, source, "utf8");
  return "applied";
}

const companionHelpers = `
export const makePairingQRRenderer = (refs, render) => {
  let index = 0;
  let current;
  return {
    next() {
      const ref = refs[index];
      if (ref === undefined) return false;
      index += 1;
      current = ref;
      render(ref);
      return true;
    },
    refresh() {
      if (current === undefined) return false;
      render(current);
      return true;
    }
  };
};
const COMPANION_REG_REFRESH_CHILDREN = ['companion_reg_refresh', 'pair-device-rotate-qr'];
export const handleCompanionRegRefresh = (node, { creds, emitCredsUpdate, refreshQR, logger }) => {
  if (!COMPANION_REG_REFRESH_CHILDREN.some(tag => getBinaryNodeChild(node, tag))) {
    logger.warn({ node }, 'companion_reg_refresh carries neither expected child; ignoring');
    return 'ignored_malformed';
  }
  if (creds.me) {
    logger.debug({ id: node.attrs.id }, 'companion_reg_refresh on a registered session; keeping the adv secret');
    return 'ignored_registered';
  }
  creds.advSecretKey = randomBytes(32).toString('base64');
  emitCredsUpdate({ advSecretKey: creds.advSecretKey });
  logger.info({ id: node.attrs.id }, 'rotated the adv secret the server asked to retire; re-rendering the pairing QR');
  refreshQR();
  return 'rotated';
};
`;

const replacementQrSection = `// Re-render the QR currently on screen while pairing.
  let refreshPairingQR;
  // QR gen
  ws.on('CB:iq,type:set,pair-device', async (stanza) => {
    const iq = {
      tag: 'iq',
      attrs: { to: S_WHATSAPP_NET, type: 'result', id: stanza.attrs.id }
    };
    await sendNode(iq);
    const pairDeviceNode = getBinaryNodeChild(stanza, 'pair-device');
    const refNodes = getBinaryNodeChildren(pairDeviceNode, 'ref');
    const noiseKeyB64 = Buffer.from(creds.noiseKey.public).toString('base64');
    const identityKeyB64 = Buffer.from(creds.signedIdentityKey.public).toString('base64');
    const renderer = makePairingQRRenderer(
      refNodes.map(refNode => refNode.content.toString('utf-8')),
      ref => ev.emit('connection.update', {
        qr: buildPairingQRData(ref, noiseKeyB64, identityKeyB64, creds.advSecretKey, browser)
      })
    );
    refreshPairingQR = () => void renderer.refresh();
    let qrMs = qrTimeout || 60000;
    const genPairQR = () => {
      if (!ws.isOpen) return;
      if (!renderer.next()) {
        void end(new Boom('QR refs attempts ended', { statusCode: DisconnectReason.timedOut }));
        return;
      }
      qrTimer = setTimeout(genPairQR, qrMs);
      qrMs = qrTimeout || 20000;
    };
    genPairQR();
  });
  // WhatsApp retires the advertised registration secret after a successful scan.
  ws.on('CB:notification,type:companion_reg_refresh', (node) => {
    handleCompanionRegRefresh(node, {
      creds,
      emitCredsUpdate: update => ev.emit('creds.update', update),
      refreshQR: () => refreshPairingQR?.(),
      logger
    });
  });
  // device paired for the first time`;

async function patchCompanionRegistrationRefresh() {
  let companion = await readFile(companionTarget, "utf8");
  let socket = await readFile(socketTarget, "utf8");

  const helperPatched = companion.includes("export const handleCompanionRegRefresh") && companion.includes("export const makePairingQRRenderer");
  const socketPatched = socket.includes("CB:notification,type:companion_reg_refresh") && socket.includes("makePairingQRRenderer");

  if (helperPatched && socketPatched) return "already";
  if (checkOnly) throw new Error("Baileys companion_reg_refresh patch is missing.");

  if (!helperPatched) {
    const sourceMapMarker = "//# sourceMappingURL=companion-reg-client-utils.js.map";
    if (!companion.includes(sourceMapMarker)) {
      throw new Error("Unknown Baileys companion utility build; source-map marker not found.");
    }
    if (!companion.includes("import { randomBytes } from 'crypto';")) {
      companion = `import { randomBytes } from 'crypto';\nimport { getBinaryNodeChild } from '../WABinary/index.js';\n${companion}`;
    }
    companion = companion.replace(sourceMapMarker, `${companionHelpers}\n${sourceMapMarker}`);
    await writeFile(companionTarget, companion, "utf8");
  }

  if (!socketPatched) {
    const oldImport = "getNextPreKeysNode, makeEventBuffer, makeNoiseHandler,";
    const newImport = "getNextPreKeysNode, handleCompanionRegRefresh, makeEventBuffer, makeNoiseHandler, makePairingQRRenderer,";
    if (!socket.includes(newImport)) {
      const matches = occurrences(socket, oldImport);
      if (matches !== 1) {
        throw new Error(`Expected exactly one Baileys utility import anchor, found ${matches}. Refusing to patch an unknown build.`);
      }
      socket = socket.replace(oldImport, newImport);
    }

    const qrSection = /\/\/ QR gen\s*ws\.on\('CB:iq,type:set,pair-device',[\s\S]*?\/\/ device paired for the first time/;
    const matches = socket.match(qrSection);
    if (!matches || matches.length !== 1) {
      throw new Error("Could not locate the rc14 QR generation section. Refusing to patch an unknown build.");
    }
    socket = socket.replace(qrSection, replacementQrSection);
    await writeFile(socketTarget, socket, "utf8");
  }

  return "applied";
}

// ---------------------------------------------------------------------------
// libsignal session churn spam (2026-09-24): a sincronização de grupos roda
// num socket DESCARTÁVEL (sync-groups.mjs). Na volta, o socket principal
// reconecta e substitui as sessões Signal dos participantes — a cada troca o
// libsignal imprime a SessionEntry INTEIRA (chains, ratchets, privKey!) com
// console.info/warn direto no terminal: "Closing session: SessionEntry {...}"
// repetido dezenas de vezes por reconexão. Ruído assustador e vazamento de
// chave no log. Estas chamadas viram no-op; os console.error de falha real
// (decrypt, migração V1) NÃO são tocados.
const libsignalSrcDir = path.join(path.dirname(require.resolve("libsignal")), "src");
const spamTargets = [
  {
    file: path.join(libsignalSrcDir, "session_record.js"),
    needles: [
      'console.warn("Session already closed", session);',
      'console.info("Closing session:", session);',
      'console.warn("Session already open");',
      'console.info("Opening session:", session);',
      'console.info("Removing old closed session:", oldestSession);',
    ],
  },
  {
    file: path.join(libsignalSrcDir, "session_builder.js"),
    needles: ['console.warn("Closing open session in favor of incoming prekey bundle");'],
  },
  {
    file: path.join(libsignalSrcDir, "session_cipher.js"),
    needles: ['console.warn("Decrypted message with closed session.");'],
  },
];

async function patchLibsignalSessionSpam() {
  let applied = 0;
  for (const target of spamTargets) {
    let source = await readFile(target.file, "utf8");
    let changed = false;
    for (const needle of target.needles) {
      if (!source.includes(needle)) continue;
      if (checkOnly) throw new Error(`libsignal session spam patch is missing (${path.basename(target.file)}).`);
      const found = occurrences(source, needle);
      if (found !== 1) {
        throw new Error(`Expected exactly one libsignal console spam site in ${path.basename(target.file)}, found ${found}. Refusing to patch an unknown build.`);
      }
      source = source.replace(needle, "void 0; /* leilao-pokemon: sem dump de SessionEntry (privKeys) no terminal */");
      changed = true;
      applied += 1;
    }
    if (changed) await writeFile(target.file, source, "utf8");
  }
  return applied === 0 ? "already" : `applied (${applied} sites)`;
}

const ackResult = await patchPreLoginAck();
const refreshResult = await patchCompanionRegistrationRefresh();
const spamResult = await patchLibsignalSessionSpam();

if (checkOnly) {
  console.log("Baileys QR pairing + libsignal spam patches verified. Poll votes are handled by the bot without patching process-message.js.");
} else {
  console.log(`Baileys pre-login ACK patch: ${ackResult}.`);
  console.log(`Baileys companion_reg_refresh patch: ${refreshResult}.`);
  console.log(`Baileys libsignal session spam patch: ${spamResult}.`);
  console.log("Baileys poll vote patch: not needed (raw pollUpdate handled by bot)." );
}
