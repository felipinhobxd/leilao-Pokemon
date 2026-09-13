import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const baileysEntry = require.resolve("@whiskeysockets/baileys");
const libDir = path.dirname(baileysEntry);
const recvTarget = path.join(libDir, "Socket", "messages-recv.js");
const socketTarget = path.join(libDir, "Socket", "socket.js");
const companionTarget = path.join(libDir, "Utils", "companion-reg-client-utils.js");
const processMessageTarget = path.join(libDir, "Utils", "process-message.js");
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

const pollUpdateReplacement = `} else if (content?.pollUpdateMessage) {
        // LEILAO_POLL_UPDATES_PATCH_V2: rc14 shipped this handler commented out and PN-only decryption breaks during LID migration.
        const creationMsgKey = content.pollUpdateMessage.pollCreationMessageKey;
        const pollMsg = await getMessage(creationMsgKey);
        if (pollMsg) {
            const meIdNormalised = jidNormalizedUser(meId);
            const pollEncKey = pollMsg.messageContextInfo?.messageSecret;
            if (!pollEncKey) {
                logger?.warn({ creationMsgKey }, 'poll creation message has no messageSecret, cannot decrypt update');
            }
            else {
                const addCandidate = (list, jid) => {
                    if (!jid || String(jid).endsWith('@g.us')) return;
                    const normalized = jidNormalizedUser(jid);
                    if (normalized && !list.includes(normalized)) list.push(normalized);
                };
                const expandCandidate = async (list, jid) => {
                    if (!jid || String(jid).endsWith('@g.us')) return;
                    const normalized = jidNormalizedUser(jid);
                    addCandidate(list, normalized);
                    try {
                        if (isLidUser(normalized)) {
                            addCandidate(list, await signalRepository.lidMapping.getPNForLID(normalized));
                        }
                        else if (String(normalized).endsWith('@s.whatsapp.net')) {
                            addCandidate(list, await signalRepository.lidMapping.getLIDForPN(normalized));
                        }
                    }
                    catch {}
                };

                const creatorCandidates = [];
                await expandCandidate(creatorCandidates, creationMsgKey.participant);
                await expandCandidate(creatorCandidates, creationMsgKey.participantAlt);
                await expandCandidate(creatorCandidates, getKeyAuthor(creationMsgKey, meIdNormalised));
                await expandCandidate(creatorCandidates, meIdNormalised);

                const voterCandidates = [];
                await expandCandidate(voterCandidates, message.key.participant);
                await expandCandidate(voterCandidates, message.key.participantAlt);
                await expandCandidate(voterCandidates, message.key.remoteJidAlt);
                await expandCandidate(voterCandidates, getKeyAuthor(message.key, meIdNormalised));

                let voteMsg;
                let decryptContext;
                let lastError;
                for (const pollCreatorJid of creatorCandidates) {
                    for (const voterJid of voterCandidates) {
                        try {
                            voteMsg = decryptPollVote(content.pollUpdateMessage.vote, {
                                pollEncKey,
                                pollCreatorJid,
                                pollMsgId: creationMsgKey.id,
                                voterJid
                            });
                            decryptContext = { pollCreatorJid, voterJid };
                            break;
                        }
                        catch (err) {
                            lastError = err;
                        }
                    }
                    if (voteMsg) break;
                }

                if (!voteMsg) {
                    logger?.warn({
                        err: lastError,
                        creationMsgKey,
                        creatorCandidates,
                        voterCandidates
                    }, 'failed to decrypt poll vote with PN/LID candidates');
                }
                else {
                    logger?.debug({ creationMsgKey, decryptContext }, 'poll vote decrypted with PN/LID compatibility');
                    const rawTimestamp = content.pollUpdateMessage.senderTimestampMs;
                    const senderTimestampMs = Number(rawTimestamp?.toString?.() ?? rawTimestamp ?? Date.now());
                    ev.emit('messages.update', [{
                            key: creationMsgKey,
                            update: {
                                pollUpdates: [{
                                        pollUpdateMessageKey: message.key,
                                        vote: voteMsg,
                                        senderTimestampMs
                                    }]
                            }
                        }]);
                }
            }
        }
        else {
            logger?.warn({ creationMsgKey }, 'poll creation message not found, cannot decrypt update');
        }
    }
    `;

async function patchPollVoteDecryption() {
  let source = await readFile(processMessageTarget, "utf8");
  if (source.includes("LEILAO_POLL_UPDATES_PATCH_V2")) return "already";
  if (checkOnly) throw new Error("Baileys PN/LID poll vote decryption patch is missing.");

  if (source.includes("LEILAO_POLL_UPDATES_PATCH:")) {
    const legacyPatchedHandler = /}\s*else if \(content\?\.pollUpdateMessage\) \{[\s\S]*?LEILAO_POLL_UPDATES_PATCH:[\s\S]*?\n    }\n    (?=if \(Object\.keys\(chat\)\.length > 1\))/;
    const legacyMatch = source.match(legacyPatchedHandler);
    if (!legacyMatch || legacyMatch.length !== 1) {
      throw new Error("Could not locate the previous Leilao poll patch. Refusing to upgrade an unknown build.");
    }
    source = source.replace(legacyPatchedHandler, pollUpdateReplacement);
  } else {
    const commentedPollHandler = /}\s*\/\*\s*else if\(content\?\.pollUpdateMessage\) \{[\s\S]*?}\s*\*\/\s*(?=if \(Object\.keys\(chat\)\.length > 1\))/;
    const match = source.match(commentedPollHandler);
    if (!match || match.length !== 1) {
      throw new Error("Could not locate rc14's commented poll-update handler. Refusing to patch an unknown build.");
    }
    source = source.replace(commentedPollHandler, pollUpdateReplacement);
  }

  await writeFile(processMessageTarget, source, "utf8");
  return "applied";
}

const ackResult = await patchPreLoginAck();
const refreshResult = await patchCompanionRegistrationRefresh();
const pollResult = await patchPollVoteDecryption();

if (checkOnly) {
  console.log("Baileys QR pairing and PN/LID poll vote patches verified.");
} else {
  console.log(`Baileys pre-login ACK patch: ${ackResult}.`);
  console.log(`Baileys companion_reg_refresh patch: ${refreshResult}.`);
  console.log(`Baileys PN/LID poll vote decryption patch: ${pollResult}.`);
}
