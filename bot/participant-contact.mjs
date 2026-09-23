// Resolução do JID "falar-able" de um participante: DM e @menção em grupo
// precisam do JID de telefone (number@s.whatsapp.net). LIDs são locais ao
// grupo — não servem para DM e são um fallback apenas para menção.
// participant_identities guarda a dupla pn/lid resolvida pelos votos.
export async function resolveParticipantJid(db, participantId) {
  if (!participantId) return null;
  const { data: identities, error } = await db
    .from("participant_identities")
    .select("identity,kind")
    .eq("participant_id", participantId);
  if (!error && Array.isArray(identities) && identities.length) {
    const pn = identities.find(row => row.kind === "pn" && /@s\.whatsapp\.net$/.test(String(row.identity ?? "")));
    if (pn) return pn.identity;
    const any = identities.find(row => /@s\.whatsapp\.net$/.test(String(row.identity ?? "")));
    if (any) return any.identity;
  }
  const { data: person } = await db
    .from("participants")
    .select("whatsapp_id,phone_e164")
    .eq("id", participantId)
    .maybeSingle();
  if (person?.whatsapp_id && /@s\.whatsapp\.net$/.test(String(person.whatsapp_id))) return person.whatsapp_id;
  const phone = String(person?.phone_e164 ?? "").replace(/^\+/, "");
  if (/^\d{8,15}$/.test(phone)) return `${phone}@s.whatsapp.net`;
  return null;
}

// Constrói o texto + lista de menções do WhatsApp (Baileys: { text, mentions }).
// Sem JID resolvido, devolve o texto plano com o nome (mensagem nunca deixa
// de sair por falta de menção).
export function mentionMessage(displayName, participantId, jid, baseText) {
  const name = String(displayName ?? "Participante").trim() || "Participante";
  if (!jid) return { text: baseText(name), mentions: [] };
  const handle = `@${jid.split("@")[0]}`;
  return { text: baseText(handle), mentions: [jid] };
}
