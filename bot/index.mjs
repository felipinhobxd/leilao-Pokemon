import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  getAggregateVotesInPollMessage,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { buildAuctionCaption } from "./format.mjs";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BOT_ADMIN_USER_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Variável obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USER_ID = process.env.BOT_ADMIN_USER_ID;
const WORKER_ID = process.env.BOT_WORKER_ID || `bot-${process.pid}`;
const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || "./sessao";

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const logger = pino({ level: process.env.BOT_LOG_LEVEL || "silent" });

let sock;
let schedulerTimer;
let schedulerBusy = false;
let finalizeBusy = false;
let reconnecting = false;
let voteQueue = Promise.resolve();
const contactNames = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

function reviveStoredMessage(value) {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
}

function serializeMessage(value) {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function eventTime(value) {
  if (value == null) return new Date().toISOString();
  const n = Number(value?.toString?.() ?? value);
  if (!Number.isFinite(n)) return new Date().toISOString();
  const ms = n > 10_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function jidDigits(jid) {
  const local = String(jid ?? "").split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(local) ? local : null;
}

function phoneFromJid(jid) {
  const digits = jidDigits(jid);
  return digits ? `+${digits}` : null;
}

function fallbackIdentityName(value) {
  const name = String(value ?? "").trim();
  return !name || name === "Participante WhatsApp" || /^\+?\d{8,15}$/.test(name) || name.includes("@lid") || name.includes("@s.whatsapp.net");
}

function rememberContact(contact) {
  const name = String(contact?.notify || contact?.name || contact?.verifiedName || contact?.pushName || contact?.username || "").trim();
  if (!name) return;
  for (const jid of [contact?.id, contact?.lid, contact?.phoneNumber]) {
    if (jid) contactNames.set(jid, name);
  }
}

function rememberMessageSender(message) {
  const name = String(message?.pushName ?? "").trim();
  if (!name) return;
  const key = message?.key ?? {};
  for (const jid of [key.participantAlt, key.participant, key.remoteJidAlt, key.remoteJid]) {
    if (jid && !String(jid).endsWith("@g.us")) contactNames.set(jid, name);
  }
}

function voterFromUpdate(update) {
  const key = update?.pollUpdateMessageKey;
  if (!key) return null;
  if (key.fromMe) return sock?.user?.id ?? null;
  return key.participantAlt || key.participant || key.remoteJidAlt || key.remoteJid || null;
}

async function resolveVoterIdentity(update) {
  const key = update?.pollUpdateMessageKey;
  if (!key) return null;

  const raw = voterFromUpdate(update);
  if (!raw || String(raw).endsWith("@g.us")) return null;

  const candidates = [
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid,
    raw,
  ].filter(jid => jid && !String(jid).endsWith("@g.us"));

  const groupJid = [key.remoteJid, key.remoteJidAlt].find(jid => String(jid ?? "").endsWith("@g.us"));
  let groupParticipant = null;

  if (groupJid && sock?.groupMetadata) {
    try {
      const metadata = await sock.groupMetadata(groupJid);
      groupParticipant = metadata?.participants?.find(person => {
        const ids = [person?.id, person?.lid, person?.phoneNumber].filter(Boolean);
        return ids.some(id => candidates.includes(id));
      }) ?? null;
      if (groupParticipant) {
        rememberContact(groupParticipant);
        for (const jid of [groupParticipant.id, groupParticipant.lid, groupParticipant.phoneNumber]) {
          if (jid && !candidates.includes(jid)) candidates.push(jid);
        }
      }
    } catch {
      // Identity resolution is best effort. The vote itself must keep working.
    }
  }

  let phoneJid = candidates.find(jid => String(jid).endsWith("@s.whatsapp.net")) || groupParticipant?.phoneNumber || null;
  if (!phoneJid) {
    const lid = candidates.find(jid => String(jid).endsWith("@lid"));
    const resolver = sock?.signalRepository?.lidMapping?.getPNForLID;
    if (lid && typeof resolver === "function") {
      try {
        phoneJid = await resolver.call(sock.signalRepository.lidMapping, lid);
        if (phoneJid && !candidates.includes(phoneJid)) candidates.push(phoneJid);
      } catch {
        // Some LIDs cannot be mapped to a phone number. Keep the stable LID in that case.
      }
    }
  }

  const canonicalJid = phoneJid || raw;
  const phoneE164 = phoneFromJid(phoneJid || canonicalJid);
  const cachedName = candidates.map(jid => contactNames.get(jid)).find(Boolean);
  const keyName = key.participantUsername || key.remoteJidUsername;
  const metadataName = groupParticipant?.notify || groupParticipant?.name || groupParticipant?.verifiedName || groupParticipant?.username;
  const displayName = String(cachedName || metadataName || keyName || phoneE164 || jidDigits(canonicalJid) || "Participante WhatsApp").trim();

  return {
    voterJid: canonicalJid,
    rawJid: raw,
    aliases: [...new Set(candidates)],
    phoneE164,
    displayName,
  };
}

async function getStoredPollMessage(key) {
  if (!key?.id) return undefined;
  const { data, error } = await db
    .from("whatsapp_dispatches")
    .select("poll_message_json")
    .eq("poll_message_id", key.id)
    .maybeSingle();
  if (error || !data?.poll_message_json) return undefined;
  return reviveStoredMessage(data.poll_message_json);
}

async function processCommand(command) {
  const { data, error } = await db.rpc("process_auction_command", {
    p_command: command,
    p_admin_user_id: ADMIN_USER_ID,
  });
  if (error) throw new Error(error.message || "database_command_failed");
  return data;
}

async function ensureParticipant(identity) {
  const now = new Date().toISOString();
  const lookupJids = [...new Set([identity.voterJid, identity.rawJid, ...(identity.aliases ?? [])].filter(Boolean))];
  let existing = null;

  if (lookupJids.length) {
    const { data, error } = await db
      .from("participants")
      .select("id,whatsapp_id,phone_e164,display_name,status,suspension_until")
      .in("whatsapp_id", lookupJids)
      .limit(1);
    if (error) throw new Error(error.message);
    existing = data?.[0] ?? null;
  }

  if (!existing && identity.phoneE164) {
    const { data, error } = await db
      .from("participants")
      .select("id,whatsapp_id,phone_e164,display_name,status,suspension_until")
      .eq("phone_e164", identity.phoneE164)
      .limit(1);
    if (error) throw new Error(error.message);
    existing = data?.[0] ?? null;
  }

  if (existing) {
    const patch = { last_seen_at: now };
    if (identity.phoneE164 && !existing.phone_e164) patch.phone_e164 = identity.phoneE164;
    if (identity.displayName && fallbackIdentityName(existing.display_name) && !fallbackIdentityName(identity.displayName)) {
      patch.display_name = identity.displayName;
    }
    const { data: updated, error } = await db
      .from("participants")
      .update(patch)
      .eq("id", existing.id)
      .select("id,whatsapp_id,phone_e164,display_name,status,suspension_until")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  }

  const { data: created, error: insertError } = await db
    .from("participants")
    .insert({
      whatsapp_id: identity.voterJid,
      phone_e164: identity.phoneE164,
      display_name: identity.displayName,
      status: "active",
      first_seen_at: now,
      last_seen_at: now,
    })
    .select("id,whatsapp_id,phone_e164,display_name,status,suspension_until")
    .single();
  if (insertError || !created) throw new Error(insertError?.message || "participant_create_failed");
  return created;
}

async function claimDispatch() {
  const { data, error } = await db.rpc("claim_whatsapp_dispatch", { p_worker_id: WORKER_ID });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function markDispatchRetry(dispatch, error) {
  const failed = Number(dispatch.attempts) >= 5;
  await db.from("whatsapp_dispatches").update({
    status: failed ? "failed" : "scheduled",
    scheduled_at: failed ? dispatch.scheduled_at : new Date(Date.now() + 10_000).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: String(error?.message || error).slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq("id", dispatch.id);
}

async function fetchAuctionContext(dispatch) {
  const [{ data: group, error: groupError }, { data: auction, error: auctionError }] = await Promise.all([
    db.from("whatsapp_groups").select("id,group_jid,name,active").eq("id", dispatch.group_id).single(),
    db.from("auctions").select("*").eq("id", dispatch.auction_id).single(),
  ]);
  if (groupError || !group?.active) throw new Error("whatsapp_group_unavailable");
  if (auctionError || !auction) throw new Error("auction_not_found");
  const { data: card, error: cardError } = await db.from("cards").select("*").eq("id", auction.card_id).single();
  if (cardError || !card) throw new Error("card_not_found");
  return { group, auction, card };
}

async function sendDispatch(dispatch) {
  const { group, auction, card } = await fetchAuctionContext(dispatch);
  if (auction.status !== "draft") throw new Error("auction_not_draft");
  const options = Array.isArray(dispatch.poll_options) ? dispatch.poll_options : [];
  if (!options.length || options.length > 12) throw new Error("invalid_poll_options");

  const caption = buildAuctionCaption(card, auction);
  const announcement = card.image_url
    ? await sock.sendMessage(group.group_jid, { image: { url: card.image_url }, caption })
    : await sock.sendMessage(group.group_jid, { text: caption });

  const poll = await sock.sendMessage(group.group_jid, {
    poll: {
      name: dispatch.poll_title,
      values: options.map(option => String(option.label)),
      selectableCount: 1,
    },
  });
  if (!poll?.key?.id || !poll.message) throw new Error("poll_send_failed");

  await processCommand({
    type: "AUCTION_OPEN",
    eventId: `wa-open:${dispatch.id}`,
    auctionId: auction.id,
  });

  await db.from("auctions").update({
    whatsapp_group_id: group.group_jid,
    poll_id: poll.key.id,
    message_id: announcement?.key?.id ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", auction.id);

  const { error } = await db.from("whatsapp_dispatches").update({
    status: "sent",
    announcement_message_id: announcement?.key?.id ?? null,
    poll_message_id: poll.key.id,
    poll_message_json: serializeMessage(poll.message),
    sent_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", dispatch.id);
  if (error) throw new Error(error.message);

  console.log(`📤 Enquete enviada: ${card.name} → ${group.name}`);
}

async function runScheduler() {
  if (!sock || schedulerBusy) return;
  schedulerBusy = true;
  try {
    for (let i = 0; i < 5; i++) {
      const dispatch = await claimDispatch();
      if (!dispatch) break;
      try {
        await sendDispatch(dispatch);
      } catch (error) {
        console.error("Falha no disparo:", error?.message || error);
        await markDispatchRetry(dispatch, error);
      }
    }
  } catch (error) {
    console.error("Falha no agendador:", error?.message || error);
  } finally {
    schedulerBusy = false;
  }
}

async function auditLateVote(auctionId, participantId, type, eventId, payload) {
  await db.from("auction_events").insert({
    auction_id: auctionId,
    participant_id: participantId,
    admin_user_id: ADMIN_USER_ID,
    event_type: type,
    external_event_id: eventId,
    payload,
  });
}

async function handlePollVote(dispatch, pollUpdate) {
  const identity = await resolveVoterIdentity(pollUpdate);
  if (!identity) return;

  const participant = await ensureParticipant(identity);
  const voterJid = identity.voterJid;
  const occurredAt = eventTime(pollUpdate.senderTimestampMs);
  const originalMessage = reviveStoredMessage(dispatch.poll_message_json);
  const aggregated = getAggregateVotesInPollMessage({ message: originalMessage, pollUpdates: [pollUpdate] }, sock?.user?.id);
  const selectedLabel = aggregated.find(option => option.voters.length > 0)?.name ?? null;
  const options = Array.isArray(dispatch.poll_options) ? dispatch.poll_options : [];
  const selected = selectedLabel ? options.find(option => option.label === selectedLabel) : null;

  const { data: previous } = await db.from("whatsapp_vote_state")
    .select("*")
    .eq("auction_id", dispatch.auction_id)
    .eq("voter_jid", voterJid)
    .maybeSingle();

  const stablePart = `${dispatch.poll_message_id}:${voterJid}:${pollUpdate.senderTimestampMs?.toString?.() ?? Date.now()}`.slice(0, 170);

  if (!selected) {
    if (!previous?.active) return;
    const eventId = `wa-withdraw:${stablePart}`.slice(0, 200);
    if (previous.is_buyout) {
      await auditLateVote(dispatch.auction_id, participant.id, "BUYOUT_WITHDRAW_ATTEMPT", eventId, {
        voter_jid: voterJid,
        phone_e164: participant.phone_e164,
        display_name: participant.display_name,
        event_at: occurredAt,
      });
    } else {
      try {
        await processCommand({ type: "BID_WITHDRAWN", eventId, auctionId: dispatch.auction_id, participantId: participant.id, occurredAt });
      } catch (error) {
        if (String(error?.message || error).includes("auction_not_open")) {
          await auditLateVote(dispatch.auction_id, participant.id, "BID_WITHDRAWN_AFTER_CLOSE", eventId, {
            voter_jid: voterJid,
            phone_e164: participant.phone_e164,
            display_name: participant.display_name,
            event_at: occurredAt,
          });
        } else throw error;
      }
    }
    await db.from("whatsapp_vote_state").upsert({
      auction_id: dispatch.auction_id,
      voter_jid: voterJid,
      participant_id: participant.id,
      option_label: null,
      amount: null,
      is_buyout: false,
      active: false,
      last_event_id: eventId,
      last_event_at: occurredAt,
      updated_at: new Date().toISOString(),
    });
    console.log(`↩️ Voto removido: ${participant.display_name}`);
    return;
  }

  if (previous?.active && previous.option_label === selected.label) return;

  const amount = Number(selected.amount);
  const isBuyout = Boolean(selected.isBuyout || String(selected.label).includes("🦭"));
  const type = isBuyout ? "BUYOUT_CONFIRMED" : previous?.active ? "BID_CHANGED" : "BID_PLACED";
  const eventId = `wa-vote:${stablePart}:${amount}`.slice(0, 200);

  try {
    const result = await processCommand({
      type,
      eventId,
      auctionId: dispatch.auction_id,
      participantId: participant.id,
      ...(isBuyout ? {} : { amount }),
      occurredAt,
    });

    await db.from("whatsapp_vote_state").upsert({
      auction_id: dispatch.auction_id,
      voter_jid: voterJid,
      participant_id: participant.id,
      option_label: selected.label,
      amount,
      is_buyout: isBuyout,
      active: true,
      last_event_id: eventId,
      last_event_at: occurredAt,
      updated_at: new Date().toISOString(),
    });

    const contact = participant.phone_e164 ? ` (${participant.phone_e164})` : "";
    console.log(`${isBuyout ? "🦭 ARREMATE" : "💰 Lance"}: ${participant.display_name}${contact} → ${brl(amount)}`);

    if (isBuyout) {
      const { group, card } = await fetchAuctionContext(dispatch);
      await sock.sendMessage(group.group_jid, {
        text: `🏆 *ARREMATADO!*\n\n🃏 ${card.name}\n👤 ${participant.display_name}\n💰 ${brl(result?.auction?.final_price ?? amount)}`,
      });
    }
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("auction_not_open") || message.includes("deadline_expired") || message.includes("participant_not_eligible")) {
      const rejectedType = isBuyout && message.includes("auction_not_open") ? "BUYOUT_LOST_RACE" : "WHATSAPP_VOTE_REJECTED";
      const { data: closedAuction } = isBuyout
        ? await db.from("auctions").select("winner_participant_id,final_price,status").eq("id", dispatch.auction_id).maybeSingle()
        : { data: null };
      await auditLateVote(dispatch.auction_id, participant.id, rejectedType, eventId, {
        voter_jid: voterJid,
        phone_e164: participant.phone_e164,
        display_name: participant.display_name,
        option: selected.label,
        amount,
        reason: message.slice(0, 300),
        winner_participant_id: closedAuction?.winner_participant_id ?? null,
        final_price: closedAuction?.final_price ?? null,
        event_at: occurredAt,
      });
      console.log(`${isBuyout ? "🥈 ARREMATE posterior" : "⚠️ Voto rejeitado"}: ${participant.display_name}${participant.phone_e164 ? ` (${participant.phone_e164})` : ""} → ${selected.label}`);
      return;
    }
    throw error;
  }
}

async function handleMessageUpdates(updates) {
  for (const { key, update } of updates) {
    if (!key?.id || !update?.pollUpdates?.length) continue;
    const { data: dispatch, error } = await db
      .from("whatsapp_dispatches")
      .select("*")
      .eq("poll_message_id", key.id)
      .eq("status", "sent")
      .maybeSingle();
    if (error || !dispatch?.poll_message_json) continue;
    const ordered = [...update.pollUpdates].sort((a, b) => {
      const left = Number(a?.senderTimestampMs?.toString?.() ?? 0);
      const right = Number(b?.senderTimestampMs?.toString?.() ?? 0);
      return left - right;
    });
    for (const pollUpdate of ordered) {
      try {
        await handlePollVote(dispatch, pollUpdate);
      } catch (error) {
        console.error("Falha ao processar voto:", error?.message || error);
      }
    }
  }
}

async function finalizeDueAuctions() {
  if (!sock || finalizeBusy) return;
  finalizeBusy = true;
  try {
    const now = new Date().toISOString();
    const { data: auctions, error } = await db
      .from("auctions")
      .select("id,card_id,whatsapp_group_id,scheduled_end_at")
      .eq("status", "open")
      .not("scheduled_end_at", "is", null)
      .lte("scheduled_end_at", now)
      .order("scheduled_end_at")
      .limit(10);
    if (error) throw error;

    for (const auction of auctions ?? []) {
      const eventId = `bot-finalize:${auction.id}:${auction.scheduled_end_at}`.slice(0, 200);
      try {
        const result = await processCommand({ type: "AUCTION_FINALIZE", eventId, auctionId: auction.id });
        const finalAuction = result?.auction;
        if (!auction.whatsapp_group_id) continue;
        const { data: card } = await db.from("cards").select("name").eq("id", auction.card_id).single();
        if (finalAuction?.winner_participant_id) {
          const { data: winner } = await db.from("participants").select("display_name").eq("id", finalAuction.winner_participant_id).single();
          await sock.sendMessage(auction.whatsapp_group_id, {
            text: `🏁 *Leilão encerrado!*\n\n🃏 ${card?.name ?? "Carta"}\n👤 Vencedor: ${winner?.display_name ?? "Participante"}\n💰 ${brl(finalAuction.final_price)}`,
          });
        } else {
          await sock.sendMessage(auction.whatsapp_group_id, { text: `🏁 Leilão de *${card?.name ?? "carta"}* encerrado sem lances válidos.` });
        }
      } catch (error) {
        console.error("Falha ao finalizar leilão:", error?.message || error);
      }
    }
  } finally {
    finalizeBusy = false;
  }
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  sock = makeWASocket({
    auth: state,
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: getStoredPollMessage,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("contacts.upsert", contacts => contacts.forEach(rememberContact));
  sock.ev.on("contacts.update", contacts => contacts.forEach(rememberContact));
  sock.ev.on("messages.upsert", ({ messages }) => messages.forEach(rememberMessageSender));
  sock.ev.on("messages.update", updates => {
    voteQueue = voteQueue
      .then(() => handleMessageUpdates(updates))
      .catch(error => console.error("Falha na fila de votos:", error?.message || error));
  });

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      console.log("\nLeia o QR Code pelo WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      reconnecting = false;
      console.log(`\n✅ WhatsApp conectado. Worker: ${WORKER_ID}`);
      console.log("Aguardando agendamentos e votos...\n");
      clearInterval(schedulerTimer);
      schedulerTimer = setInterval(() => {
        void runScheduler();
        void finalizeDueAuctions();
      }, 3000);
      void runScheduler();
      void finalizeDueAuctions();
    }

    if (connection === "close") {
      clearInterval(schedulerTimer);
      const code = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.data?.reason;
      console.log(`Conexão encerrada (${code ?? "desconhecido"}).`);
      if (code === DisconnectReason.loggedOut) {
        console.error("A sessão foi desconectada pelo WhatsApp. Faça login novamente.");
        process.exit(1);
      }
      if (code === DisconnectReason.connectionReplaced || code === 440) {
        console.error("Erro 440: outra instância substituiu esta conexão. Feche os outros bots antes de iniciar novamente.");
        process.exit(2);
      }
      if (!reconnecting) {
        reconnecting = true;
        console.log("Reconectando em 5 segundos...");
        setTimeout(() => void connect().catch(error => console.error(error)), 5000);
      }
    }
  });
}

process.on("SIGINT", async () => {
  clearInterval(schedulerTimer);
  console.log("\nEncerrando bot...");
  await sleep(100);
  process.exit(0);
});

connect().catch(error => {
  console.error("Erro fatal:", error?.message || error);
  process.exit(1);
});