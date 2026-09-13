function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isGroupJid(jid) {
  return String(jid ?? "").endsWith("@g.us");
}

function isPhoneJid(jid) {
  return String(jid ?? "").endsWith("@s.whatsapp.net");
}

function isLidJid(jid) {
  return String(jid ?? "").endsWith("@lid");
}

export function jidDigits(jid) {
  const local = String(jid ?? "").split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(local) ? local : null;
}

export function phoneFromWhatsAppJid(jid) {
  if (!isPhoneJid(jid)) return null;
  const digits = jidDigits(jid);
  return digits ? `+${digits}` : null;
}

async function expandAliases(sock, values) {
  const aliases = unique(values).filter(jid => !isGroupJid(jid));
  const mapping = sock?.signalRepository?.lidMapping;
  if (!mapping) return aliases;

  for (const jid of [...aliases]) {
    try {
      if (isLidJid(jid) && typeof mapping.getPNForLID === "function") {
        const pn = await mapping.getPNForLID(jid);
        if (pn && !aliases.includes(pn)) aliases.push(pn);
      } else if (isPhoneJid(jid) && typeof mapping.getLIDForPN === "function") {
        const lid = await mapping.getLIDForPN(jid);
        if (lid && !aliases.includes(lid)) aliases.push(lid);
      }
    } catch {}
  }

  return aliases;
}

function memberName(member, aliases, contactNames, phoneE164) {
  const cached = aliases.map(jid => contactNames?.get?.(jid)).find(Boolean);
  const metadata = member?.notify || member?.name || member?.verifiedName || member?.pushName || member?.username;
  return String(cached || metadata || phoneE164 || "Participante WhatsApp").trim();
}

export async function identityFromGroupMember({ sock, member, contactNames = new Map() }) {
  const aliases = await expandAliases(sock, [member?.id, member?.lid, member?.phoneNumber]);
  if (!aliases.length) return null;

  const phoneJid = aliases.find(isPhoneJid) || null;
  const lidJid = aliases.find(isLidJid) || null;
  const phoneE164 = phoneFromWhatsAppJid(phoneJid);
  const voterJid = lidJid || phoneJid || aliases[0];
  const displayName = memberName(member, aliases, contactNames, phoneE164);

  if (displayName && displayName !== "Participante WhatsApp") {
    for (const jid of aliases) contactNames?.set?.(jid, displayName);
  }

  return {
    voterJid,
    rawJid: voterJid,
    aliases,
    phoneE164,
    displayName,
  };
}

export async function syncGroupParticipants({ sock, groupJid, contactNames = new Map(), ensureParticipant }) {
  if (!sock?.groupMetadata) throw new Error("group_metadata_unavailable");
  if (typeof ensureParticipant !== "function") throw new Error("ensure_participant_required");

  const metadata = await sock.groupMetadata(groupJid);
  const members = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const ownAliases = await expandAliases(sock, [sock?.user?.id, sock?.user?.lid]);
  const ownPhones = new Set(ownAliases.map(phoneFromWhatsAppJid).filter(Boolean));
  let synced = 0;
  let skipped = 0;

  for (const member of members) {
    try {
      const identity = await identityFromGroupMember({ sock, member, contactNames });
      if (!identity) {
        skipped += 1;
        continue;
      }

      const sameAlias = identity.aliases.some(alias => ownAliases.includes(alias));
      const samePhone = identity.phoneE164 && ownPhones.has(identity.phoneE164);
      if (sameAlias || samePhone) {
        skipped += 1;
        continue;
      }

      await ensureParticipant(identity);
      synced += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    subject: metadata?.subject || groupJid,
    total: members.length,
    synced,
    skipped,
  };
}
