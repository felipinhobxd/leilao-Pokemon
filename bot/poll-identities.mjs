function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeUserJid(value) {
  const jid = String(value ?? "").trim();
  if (!jid || !jid.includes("@")) return jid || null;
  const [local, server] = jid.split("@", 2);
  if (!local || !server) return null;
  return `${local.split(":")[0]}@${server}`;
}

export function isGroupJid(jid) {
  return String(jid ?? "").endsWith("@g.us");
}

export function isPhoneJid(jid) {
  return String(jid ?? "").endsWith("@s.whatsapp.net");
}

export function isLidJid(jid) {
  return String(jid ?? "").endsWith("@lid");
}

async function expandOne(sock, values, value) {
  const normalized = normalizeUserJid(value);
  if (!normalized || isGroupJid(normalized)) return;
  if (!values.includes(normalized)) values.push(normalized);

  const mapping = sock?.signalRepository?.lidMapping;
  if (!mapping) return;
  try {
    if (isLidJid(normalized) && typeof mapping.getPNForLID === "function") {
      const pn = normalizeUserJid(await mapping.getPNForLID(normalized));
      if (pn && !values.includes(pn)) values.push(pn);
    } else if (isPhoneJid(normalized) && typeof mapping.getLIDForPN === "function") {
      const lid = normalizeUserJid(await mapping.getLIDForPN(normalized));
      if (lid && !values.includes(lid)) values.push(lid);
    }
  } catch {
    // Mapping information is best-effort. The raw routing identity is still kept.
  }
}

async function expandMany(sock, rawValues) {
  const values = [];
  for (const value of rawValues) await expandOne(sock, values, value);
  // Expand newly discovered aliases once in the opposite direction as well.
  for (const value of [...values]) await expandOne(sock, values, value);
  return unique(values);
}

function sortCreators(values) {
  return [...values].sort((a, b) => {
    const weight = value => isLidJid(value) ? 0 : isPhoneJid(value) ? 1 : 2;
    return weight(a) - weight(b) || a.localeCompare(b);
  });
}

function sortVoters(values) {
  return [...values].sort((a, b) => {
    const weight = value => isPhoneJid(value) ? 0 : isLidJid(value) ? 1 : 2;
    return weight(a) - weight(b) || a.localeCompare(b);
  });
}

export async function buildPollCryptoCandidates({ sock, messageKey = {}, creationKey = {}, pollKey = {} }) {
  const ownPn = normalizeUserJid(sock?.user?.id);
  const ownLid = normalizeUserJid(sock?.user?.lid);
  const creatorRaw = [
    creationKey.participant,
    creationKey.participantAlt,
    pollKey.participant,
    pollKey.participantAlt,
  ];
  if (!creationKey.fromMe) {
    creatorRaw.push(creationKey.remoteJidAlt, isGroupJid(creationKey.remoteJid) ? null : creationKey.remoteJid);
  }
  if (creationKey.fromMe || pollKey.fromMe) creatorRaw.push(ownLid, ownPn);

  const voterRaw = [messageKey.participantAlt, messageKey.participant];
  if (!isGroupJid(messageKey.remoteJidAlt)) voterRaw.push(messageKey.remoteJidAlt);
  if (!isGroupJid(messageKey.remoteJid)) voterRaw.push(messageKey.remoteJid);
  // A real manual vote made by the account connected to Baileys is still a vote.
  // Keep BOTH protocol identities instead of replacing the event with only meId.
  if (messageKey.fromMe) voterRaw.push(ownPn, ownLid);

  const creatorCandidates = sortCreators(await expandMany(sock, creatorRaw));
  const voterCandidates = sortVoters(await expandMany(sock, voterRaw));

  const pairs = [];
  const seen = new Set();
  const addPair = (creator, voter) => {
    if (!creator || !voter) return;
    const token = `${creator}\u0000${voter}`;
    if (seen.has(token)) return;
    seen.add(token);
    pairs.push({ pollCreatorJid: creator, voterJid: voter });
  };

  // Current WhatsApp behavior commonly prefers creator=LID, voter=PN.
  for (const creator of creatorCandidates.filter(isLidJid)) {
    for (const voter of voterCandidates.filter(isPhoneJid)) addPair(creator, voter);
  }
  // Group/addressing-mode variants seen during the LID migration.
  for (const creator of creatorCandidates.filter(isLidJid)) {
    for (const voter of voterCandidates.filter(isLidJid)) addPair(creator, voter);
  }
  for (const creator of creatorCandidates.filter(isPhoneJid)) {
    for (const voter of voterCandidates.filter(isPhoneJid)) addPair(creator, voter);
  }
  for (const creator of creatorCandidates.filter(isPhoneJid)) {
    for (const voter of voterCandidates.filter(isLidJid)) addPair(creator, voter);
  }
  for (const creator of creatorCandidates) {
    for (const voter of voterCandidates) addPair(creator, voter);
  }

  return { creatorCandidates, voterCandidates, pairs };
}
