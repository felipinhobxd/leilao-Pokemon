import "./session-guard.mjs";
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  getAggregateVotesInPollMessage,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { dispatchMessageId, dispatchPollSecret } from "./dispatch-id.mjs";
import { buildAuctionCaption } from "./format.mjs";
import { phoneFromWhatsAppJid, syncGroupParticipants } from "./group-participants.mjs";
import { isLidJid, isPhoneJid, normalizeUserJid } from "./poll-identities.mjs";
import { decryptIncomingPollVote } from "./poll-votes.mjs";
import { createAdminNotificationDrain, parseAdminJids } from "./warning-notify.mjs";
import { queueEnabled, startQueueWorker } from "./queue-worker.mjs";

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
let socketReady = false;
let dispatchQueue = null;
let voteQueue = Promise.resolve();
// Avisos globais: entrega as notificações de 3 avisos aos administradores
// (linha criada de forma idempotente pelo RPC process_auction_command).
const adminNotificationDrain = createAdminNotificationDrain({
  db,
  getSocket: () => (socketReady ? sock : null),
  adminJids: (() => {
    const jids = parseAdminJids();
    return jids.length ? jids : undefined;
  })(),
});
const contactNames = new Map();
const pollMessageCache = new Map();
const pendingPollVotes = new Map();
const trackedGroupJids = new Set();
const dispatchInFlight = new Map();
// Bounded caches (review: the three Maps above grew without limit for the
// process lifetime). contactNames: LRU by insertion order. groupMetadata: a
// group's participant list is effectively immutable during an auction, but a
// fresh fetch every 10 minutes keeps renames/leaves honest.
const CONTACT_NAMES_CAP = 5000;
const GROUP_METADATA_TTL_MS = 10 * 60 * 1000;
const groupMetadataCache = new Map();
// Participant-enrichment memo: chatty auction groups used to fire a
// groupMetadata wire call + a resolve_whatsapp_participant RPC for EVERY
// message, forever. A participant resolved once stays resolved for 6h.
const ENRICHMENT_TTL_MS = 6 * 60 * 60 * 1000;
const enrichmentMemo = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Ritmo da publicação: a FOTO sai primeiro e a enquete nativa só sai
// WHATSAPP_POLL_DELAY_MS depois, para o grupo ver a carta antes das
// opções de lance. Configurável (0 = comportamento antigo, tudo junto).
const POLL_AFTER_PHOTO_MS = Math.max(0, Number(process.env.WHATSAPP_POLL_DELAY_MS ?? 5000));
const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

function storageValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: "Buffer", data: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(storageValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, storageValue(item)]));
  }
  return value;
}

function reviveStoredMessage(value) {
  const revived = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  // Older dispatches were persisted through protobuf toJSON(), which converted
  // messageSecret to a plain base64 string before BufferJSON could see it.
  const secret = revived?.messageContextInfo?.messageSecret;
  if (typeof secret === "string") {
    try {
      const bytes = Buffer.from(secret, "base64");
      if (bytes.length === 32) revived.messageContextInfo.messageSecret = bytes;
    } catch {}
  }
  return revived;
}

function serializeMessage(value) {
  // Walk the protobuf object ourselves so its toJSON() cannot turn Uint8Array
  // secrets into ambiguous plain strings.
  return storageValue(value);
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
  return phoneFromWhatsAppJid(jid);
}

function fallbackIdentityName(value) {
  const name = String(value ?? "").trim();
  return !name || name === "Participante WhatsApp" || /^\+?\d{8,15}$/.test(name) || name.includes("@lid") || name.includes("@s.whatsapp.net");
}

function uniqueUserJids(values) {
  return [...new Set(values.map(normalizeUserJid).filter(jid => jid && !String(jid).endsWith("@g.us")))];
}

function rememberContact(contact) {
  const name = String(contact?.notify || contact?.name || contact?.verifiedName || contact?.pushName || contact?.username || "").trim();
  if (!name) return;
  for (const jid of uniqueUserJids([contact?.id, contact?.lid, contact?.phoneNumber])) {
    contactNames.delete(jid);
    contactNames.set(jid, name);
  }
  while (contactNames.size > CONTACT_NAMES_CAP) {
    contactNames.delete(contactNames.keys().next().value);
  }
}

async function cachedGroupMetadata(groupJid) {
  const cached = groupMetadataCache.get(groupJid);
  if (cached && Date.now() - cached.at < GROUP_METADATA_TTL_MS) return cached.metadata;
  const metadata = await sock?.groupMetadata?.(groupJid);
  if (metadata) groupMetadataCache.set(groupJid, { metadata, at: Date.now() });
  return metadata ?? null;
}

function rememberMessageSender(message) {
  const name = String(message?.pushName ?? "").trim();
  if (!name) return;
  const key = message?.key ?? {};
  for (const jid of uniqueUserJids([key.participantAlt, key.participant, key.remoteJidAlt, key.remoteJid])) {
    contactNames.set(jid, name);
  }
}

function voterFromUpdate(update) {
  const key = update?.pollUpdateMessageKey;
  if (!key) return null;
  // Keep the real routing identity from the event even for fromMe=true. The
  // connected account is allowed to participate and must not be discarded.
  return key.participantAlt || key.participant || (key.fromMe ? sock?.user?.id : null) || key.remoteJidAlt || key.remoteJid || null;
}

async function resolveVoterIdentity(update) {
  const key = update?.pollUpdateMessageKey;
  if (!key) return null;
  const raw = voterFromUpdate(update);
  if (!raw || String(raw).endsWith("@g.us")) return null;

  const candidates = uniqueUserJids([
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.fromMe ? sock?.user?.id : null,
    key.fromMe ? sock?.user?.lid : null,
    raw,
  ]);
  const groupJid = [key.remoteJid, key.remoteJidAlt].find(jid => String(jid ?? "").endsWith("@g.us"));
  let groupParticipant = null;

  if (groupJid && sock?.groupMetadata) {
    try {
      const metadata = await cachedGroupMetadata(groupJid);
      groupParticipant = metadata?.participants?.find(person => {
        const ids = uniqueUserJids([person?.id, person?.lid, person?.phoneNumber]);
        return ids.some(id => candidates.includes(id));
      }) ?? null;
      if (groupParticipant) {
        rememberContact(groupParticipant);
        for (const jid of uniqueUserJids([groupParticipant.id, groupParticipant.lid, groupParticipant.phoneNumber])) {
          if (!candidates.includes(jid)) candidates.push(jid);
        }
      }
    } catch {}
  }

  const mapping = sock?.signalRepository?.lidMapping;
  for (const jid of [...candidates]) {
    try {
      if (isLidJid(jid) && typeof mapping?.getPNForLID === "function") {
        const pn = normalizeUserJid(await mapping.getPNForLID(jid));
        if (pn && !candidates.includes(pn)) candidates.push(pn);
      } else if (isPhoneJid(jid) && typeof mapping?.getLIDForPN === "function") {
        const lid = normalizeUserJid(await mapping.getLIDForPN(jid));
        if (lid && !candidates.includes(lid)) candidates.push(lid);
      }
    } catch {}
  }

  const phoneJid = candidates.find(isPhoneJid) || normalizeUserJid(groupParticipant?.phoneNumber) || null;
  const canonicalJid = phoneJid || normalizeUserJid(raw);
  const phoneE164 = phoneFromJid(phoneJid);
  const cachedName = candidates.map(jid => contactNames.get(jid)).find(Boolean);
  const keyName = key.participantUsername || key.remoteJidUsername;
  const metadataName = groupParticipant?.notify || groupParticipant?.name || groupParticipant?.verifiedName || groupParticipant?.username;
  const ownName = key.fromMe ? (sock?.user?.name || sock?.user?.notify || sock?.user?.verifiedName) : null;
  const displayName = String(cachedName || metadataName || keyName || ownName || phoneE164 || jidDigits(canonicalJid) || "Participante WhatsApp").trim();
  return {
    voterJid: canonicalJid,
    rawJid: normalizeUserJid(raw),
    aliases: uniqueUserJids(candidates),
    phoneE164,
    displayName,
  };
}

async function getStoredPollMessage(key) {
  if (!key?.id) return undefined;
  const cached = pollMessageCache.get(key.id);
  if (cached?.message) return cached.message;
  const { data, error } = await db.from("whatsapp_dispatches").select("poll_message_json").eq("poll_message_id", key.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.poll_message_json) return reviveStoredMessage(data.poll_message_json);
  const remote = await db.from("whatsapp_dispatches").select("poll_message_json").eq("poll_remote_message_id", key.id).maybeSingle();
  if (remote.error || !remote.data?.poll_message_json) return undefined;
  return reviveStoredMessage(remote.data.poll_message_json);
}

async function processCommand(command) {
  const { data, error } = await db.rpc("process_auction_command", { p_command: command, p_admin_user_id: ADMIN_USER_ID });
  if (error) throw new Error(error.message || "database_command_failed");
  return data;
}

async function ensureParticipant(identity) {
  const identities = uniqueUserJids([identity.voterJid, identity.rawJid, ...(identity.aliases ?? [])]);
  const { data, error } = await db.rpc("resolve_whatsapp_participant", {
    p_identities: identities,
    p_phone_e164: identity.phoneE164 || null,
    p_display_name: identity.displayName || "Participante WhatsApp",
    p_seen_at: new Date().toISOString(),
  });
  if (error || !data) throw new Error(error?.message || "participant_resolve_failed");
  return data;
}

async function syncAuctionGroup(groupJid) {
  trackedGroupJids.add(groupJid);
  try {
    const result = await syncGroupParticipants({ sock, groupJid, contactNames, ensureParticipant });
    console.log(`👥 Grupo sincronizado: ${result.subject} · ${result.synced}/${result.total} membros identificados`);
    return result;
  } catch (error) {
    console.warn("Não foi possível sincronizar participantes do grupo:", error?.message || error);
    return null;
  }
}

async function syncOpenAuctionGroups() {
  const { data, error } = await db.from("auctions")
    .select("whatsapp_group_id")
    .eq("status", "open")
    .not("whatsapp_group_id", "is", null)
    .limit(20);
  if (error) throw new Error(error.message);
  const groupJids = [...new Set((data ?? []).map(row => row.whatsapp_group_id).filter(Boolean))];
  for (const groupJid of groupJids) await syncAuctionGroup(groupJid);
}

async function claimDispatch() {
  const { data, error } = await db.rpc("claim_whatsapp_dispatch", { p_worker_id: WORKER_ID });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function fetchDispatchById(dispatchId) {
  const { data, error } = await db.from("whatsapp_dispatches").select("*").eq("id", dispatchId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function heartbeatDispatchClaim(dispatchId) {
  // Keep the 'sending' claim FRESH while a BullMQ job owns the dispatch:
  // stale-lock recovery in claim_chatsapp_dispatch re-claims rows whose
  // locked_at is older than 2 minutes — without this heartbeat a
  // slow-retrying queue job would have its dispatch stolen back, burning
  // SQL attempts and eventually stranding the lot as 'failed'.
  await db.from("whatsapp_dispatches")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", dispatchId)
    .eq("status", "sending");
}

async function markDispatchFailed(dispatch, error) {
  // Falha terminal (irrecuperável ou tentativas esgotadas): o lote NÃO volta
  // para a fila — o erro fica visível no painel para decisão humana.
  await db.from("whatsapp_dispatches").update({
    status: "failed",
    locked_at: null,
    locked_by: null,
    last_error: String(error?.message || error).slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq("id", dispatch.id);
}

async function deliverDispatch(dispatch) {
  // Transporte preferido: fila persistente (BullMQ/Redis) — o lote sobrevive
  // a quedas de socket e reinícios do processo. Sem Redis (ou se ele falhar
  // no momento do enfileiramento) o envio inline original é usado: um
  // disparo nunca é perdido por causa da camada de transporte.
  if (dispatchQueue) {
    try {
      await dispatchQueue.enqueue(dispatch);
      return;
    } catch (error) {
      console.warn(`[queue] enfileiramento falhou (${error?.message || error}); enviando direto`);
    }
  }
  await sendDispatch(dispatch);
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

async function persistDispatchMessageIds(dispatch) {
  const announcementMessageId = dispatchMessageId(dispatch.id, "announcement");
  const pollMessageId = dispatchMessageId(dispatch.id, "poll");
  // Before this hardening, poll_message_id was overwritten with the actual
  // WhatsApp ID after the send. On an old in-flight dispatch that means a retry
  // would use a NEW generated ID. Preserve that legacy value as the remote ID,
  // then restore the deterministic idempotency key for future retries.
  const legacyPollRemoteId = dispatch.poll_remote_message_id
    || (dispatch.poll_message_id && dispatch.poll_message_id !== pollMessageId ? dispatch.poll_message_id : null);
  const currentMatches = dispatch.announcement_message_id === announcementMessageId
    && dispatch.poll_message_id === pollMessageId
    && (dispatch.poll_remote_message_id || null) === (legacyPollRemoteId || null);
  if (currentMatches) {
    return {
      ...dispatch,
      announcement_message_id: announcementMessageId,
      poll_message_id: pollMessageId,
      poll_remote_message_id: legacyPollRemoteId,
    };
  }
  const { data, error } = await db.from("whatsapp_dispatches").update({
    announcement_message_id: announcementMessageId,
    poll_message_id: pollMessageId,
    poll_remote_message_id: legacyPollRemoteId,
    updated_at: new Date().toISOString(),
  }).eq("id", dispatch.id).select("*").single();
  if (error || !data) throw new Error(error?.message || "dispatch_message_ids_failed");
  return data;
}

async function drainPendingPollVotes(pollMessageId) {
  const waiting = pendingPollVotes.get(pollMessageId) ?? [];
  pendingPollVotes.delete(pollMessageId);
  // One bad message must not discard the rest of the queue: a single throw
  // here used to drop every already-dequeued vote and flip an already-sent
  // dispatch back to 'scheduled' upstream.
  for (const message of waiting) {
    try { await processIncomingPollMessage(message); }
    catch (error) { console.error("Falha ao processar voto enfileirado:", error?.message || error); }
  }
}

async function sendDispatchInternal(claimedDispatch) {
  let dispatch = await persistDispatchMessageIds(claimedDispatch);
  const { group, auction, card } = await fetchAuctionContext(dispatch);
  trackedGroupJids.add(group.group_jid);
  if (!["draft", "open"].includes(auction.status)) throw new Error("auction_not_publishable");
  const options = Array.isArray(dispatch.poll_options) ? dispatch.poll_options : [];
  if (!options.length || options.length > 12) throw new Error("invalid_poll_options");
  const caption = buildAuctionCaption(card, auction);
  let announcementJustSent = false;

  if (!dispatch.announcement_sent_at) {
    const announcement = card.image_url
      ? await sock.sendMessage(group.group_jid, { image: { url: card.image_url }, caption }, { messageId: dispatch.announcement_message_id })
      : await sock.sendMessage(group.group_jid, { text: caption }, { messageId: dispatch.announcement_message_id });
    if (!announcement?.key?.id) throw new Error("announcement_send_failed");
    const sentAt = new Date().toISOString();
    const remoteMessageId = String(announcement.key.id);
    const { error } = await db.from("whatsapp_dispatches").update({
      announcement_remote_message_id: remoteMessageId,
      announcement_sent_at: sentAt,
      updated_at: sentAt,
    }).eq("id", dispatch.id);
    if (error) throw new Error(error.message);
    dispatch = { ...dispatch, announcement_remote_message_id: remoteMessageId, announcement_sent_at: sentAt };
    announcementJustSent = true;
  }

  if (!dispatch.poll_sent_at || !dispatch.poll_message_json) {
    // Foto primeiro, enquete depois: espera o atraso configurado APENAS
    // quando o anúncio acabou de sair nesta mesma execução — numa
    // retentativa (anúncio já enviado antes, enquete pendente) o envio é
    // imediato, sem queimar tempo de retry.
    if (announcementJustSent && POLL_AFTER_PHOTO_MS > 0) await sleep(POLL_AFTER_PHOTO_MS);
    const poll = await sock.sendMessage(group.group_jid, {
      poll: {
        name: dispatch.poll_title,
        values: options.map(option => String(option.label)),
        selectableCount: 1,
        messageSecret: dispatchPollSecret(dispatch.id),
      },
    }, { messageId: dispatch.poll_message_id });
    if (!poll?.key?.id || !poll.message) throw new Error("poll_send_failed");
    const sentAt = new Date().toISOString();
    const realPollMessageId = poll.key.id;
    const serializedPoll = serializeMessage(poll.message);
    dispatch = { ...dispatch, poll_remote_message_id: realPollMessageId, poll_message_json: serializedPoll, poll_sent_at: sentAt };
    pollMessageCache.set(realPollMessageId, { key: poll.key, message: poll.message, dispatch, ready: false });
    // Bounded poll cache: each entry holds the full dispatch row + the
    // serialized poll — unbounded growth over weeks of auctions. Evict the
    // oldest READY entries; not-ready entries (mid-send) are never evicted.
    while (pollMessageCache.size > 200) {
      const oldestReady = [...pollMessageCache.keys()].find(id => pollMessageCache.get(id)?.ready);
      if (!oldestReady) break;
      pollMessageCache.delete(oldestReady);
    }
    const { error } = await db.from("whatsapp_dispatches").update({
      poll_remote_message_id: realPollMessageId,
      poll_message_json: serializedPoll,
      poll_sent_at: sentAt,
      updated_at: sentAt,
    }).eq("id", dispatch.id);
    if (error) throw new Error(error.message);
  }

  if (auction.status === "draft") {
    await processCommand({ type: "AUCTION_OPEN", eventId: `wa-open:${dispatch.id}`, auctionId: auction.id });
  }
  await db.from("auctions").update({
    whatsapp_group_id: group.group_jid,
    poll_id: dispatch.poll_remote_message_id || dispatch.poll_message_id,
    message_id: dispatch.announcement_remote_message_id || dispatch.announcement_message_id,
    updated_at: new Date().toISOString(),
  }).eq("id", auction.id);

  const now = new Date().toISOString();
  const { data: sentDispatch, error } = await db.from("whatsapp_dispatches").update({
    status: "sent",
    sent_at: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    updated_at: now,
  }).eq("id", dispatch.id).select("*").single();
  if (error) throw new Error(error.message);
  dispatch = sentDispatch || { ...dispatch, status: "sent", sent_at: now };

  const remotePollId = dispatch.poll_remote_message_id || dispatch.poll_message_id;
  const cached = pollMessageCache.get(remotePollId);
  if (cached) pollMessageCache.set(remotePollId, { ...cached, dispatch, ready: true });
  console.log(`📤 Enquete enviada: ${card.name} → ${group.name}`);
  await drainPendingPollVotes(remotePollId);
  void syncAuctionGroup(group.group_jid);
}

async function sendDispatch(claimedDispatch) {
  const dispatchId = String(claimedDispatch?.id || "");
  if (!dispatchId) return sendDispatchInternal(claimedDispatch);
  const running = dispatchInFlight.get(dispatchId);
  if (running) return running;
  const promise = sendDispatchInternal(claimedDispatch);
  dispatchInFlight.set(dispatchId, promise);
  try {
    return await promise;
  } finally {
    if (dispatchInFlight.get(dispatchId) === promise) dispatchInFlight.delete(dispatchId);
  }
}

async function runScheduler() {
  // Não claimamos lotes com o WhatsApp desconectado: o claim gastaria as 5
  // tentativas do SQL em falhas de socket. Lotes devidos são claimados na
  // reconexão; lotes já enfileirados no Redis esperam lá (com backoff).
  if (!sock || !socketReady || schedulerBusy) return;
  schedulerBusy = true;
  try {
    for (let i = 0; i < 5; i++) {
      const dispatch = await claimDispatch();
      if (!dispatch) break;
      try { await deliverDispatch(dispatch); }
      catch (error) {
        console.error("Falha no disparo:", error?.message || error);
        await markDispatchRetry(dispatch, error);
      }
    }
  } catch (error) { console.error("Falha no agendador:", error?.message || error); }
  finally { schedulerBusy = false; }
}

async function auditLateVote(auctionId, participantId, type, eventId, payload) {
  await db.from("auction_events").insert({ auction_id: auctionId, participant_id: participantId, admin_user_id: ADMIN_USER_ID, event_type: type, external_event_id: eventId, payload });
}

async function findVoteState(auctionId, participantId) {
  const { data, error } = await db.from("whatsapp_vote_state")
    .select("*")
    .eq("auction_id", auctionId)
    .eq("participant_id", participantId)
    .order("last_event_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function saveVoteState(previous, values) {
  const row = {
    ...values,
    voter_jid: previous?.voter_jid || values.voter_jid,
    updated_at: new Date().toISOString(),
  };
  if (previous) {
    const { error } = await db.from("whatsapp_vote_state").update(row)
      .eq("auction_id", previous.auction_id)
      .eq("voter_jid", previous.voter_jid);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("whatsapp_vote_state").insert(row);
    if (error) throw new Error(error.message);
  }
}

async function logCurrentLeader(auctionId) {
  // Same key the database crowns winners with: amount desc, then TRUE vote
  // time (whatsapp_event_at) — a tie at the same price leads whoever bid first.
  const { data: bids, error } = await db.from("bids")
    .select("participant_id,amount,processed_at,confirmation_order,whatsapp_event_at")
    .eq("auction_id", auctionId)
    .eq("status", "active")
    .order("amount", { ascending: false })
    .order("whatsapp_event_at", { ascending: true, nullsFirst: true })
    .order("processed_at", { ascending: true })
    .order("confirmation_order", { ascending: true })
    .limit(20);
  if (error || !bids?.length) return;
  const now = Date.now();
  for (const bid of bids) {
    const { data: person } = await db.from("participants").select("display_name,phone_e164,status,suspension_until").eq("id", bid.participant_id).maybeSingle();
    if (!person || person.status !== "active") continue;
    if (person.suspension_until && Date.parse(person.suspension_until) > now) continue;
    console.log(`🏆 Maior lance: ${person.display_name}${person.phone_e164 ? ` (${person.phone_e164})` : ""} → ${brl(bid.amount)}`);
    return;
  }
}

function logResolvedParticipant(participant, identity) {
  const aliases = uniqueUserJids(identity.aliases ?? []);
  const lid = aliases.find(isLidJid) || "—";
  const pn = aliases.find(isPhoneJid) || "—";
  console.log(`👥 Participante resolvido: ${participant.display_name} | LID: ${lid} | PN: ${pn}`);
}

async function handlePollVote(dispatch, pollUpdate, originalMessageOverride) {
  const identity = await resolveVoterIdentity(pollUpdate);
  if (!identity) return;
  let participant;
  try {
    participant = await ensureParticipant(identity);
  } catch (error) {
    // Identity conflict = this human has TWO participants rows (e.g. one
    // created from a LID jid, another from a PN jid). The RPC fails closed,
    // which is right — but the vote vanishing with only a console log is
    // not: audit it so an admin can merge the rows and the vote be recast.
    if (String(error?.message || error).includes("whatsapp_identity_conflict")) {
      const identities = uniqueUserJids([identity.voterJid, identity.rawJid, ...(identity.aliases ?? [])]);
      await db.from("auction_events").insert({
        auction_id: dispatch.auction_id,
        admin_user_id: ADMIN_USER_ID,
        event_type: "WHATSAPP_IDENTITY_CONFLICT",
        external_event_id: `wa-identity-conflict:${dispatch.poll_message_id}:${Date.now()}`.slice(0, 200),
        payload: { identities, display_name: identity.displayName || null, reason: "participant rows need merge" },
      }).catch(() => {});
      console.error(`⚠️  Conflito de identidade no leilão ${dispatch.auction_id}: jids ${identities.join(", ")} precisam de merge — voto auditado e descartado.`);
      return;
    }
    throw error;
  }
  logResolvedParticipant(participant, identity);

  const voterJid = identity.voterJid;
  const occurredAt = eventTime(pollUpdate.senderTimestampMs);
  const originalMessage = originalMessageOverride || reviveStoredMessage(dispatch.poll_message_json);
  const aggregated = getAggregateVotesInPollMessage({ message: originalMessage, pollUpdates: [pollUpdate] }, sock?.user?.id);
  const selectedLabel = aggregated.find(option => option.voters.length > 0)?.name ?? null;
  const options = Array.isArray(dispatch.poll_options) ? dispatch.poll_options : [];
  const selected = selectedLabel ? options.find(option => option.label === selectedLabel) : null;
  const previous = await findVoteState(dispatch.auction_id, participant.id);
  const stablePart = `${dispatch.poll_message_id}:${participant.id}:${pollUpdate.senderTimestampMs?.toString?.() ?? Date.now()}`.slice(0, 170);

  if (!selected) {
    if (!previous?.active) return;
    const oldAmount = previous.amount;
    const eventId = `wa-withdraw:${stablePart}`.slice(0, 200);
    if (previous.is_buyout) {
      await auditLateVote(dispatch.auction_id, participant.id, "BUYOUT_WITHDRAW_ATTEMPT", eventId, { voter_jid: voterJid, phone_e164: participant.phone_e164, display_name: participant.display_name, event_at: occurredAt });
    } else {
      try {
        await processCommand({ type: "BID_WITHDRAWN", eventId, auctionId: dispatch.auction_id, participantId: participant.id, occurredAt });
      } catch (error) {
        if (String(error?.message || error).includes("auction_not_open")) {
          await auditLateVote(dispatch.auction_id, participant.id, "BID_WITHDRAWN_AFTER_CLOSE", eventId, { voter_jid: voterJid, phone_e164: participant.phone_e164, display_name: participant.display_name, event_at: occurredAt });
        } else throw error;
      }
    }
    await saveVoteState(previous, { auction_id: dispatch.auction_id, voter_jid: voterJid, participant_id: participant.id, option_label: null, amount: null, is_buyout: false, active: false, last_event_id: eventId, last_event_at: occurredAt });
    console.log(`❌ Voto removido: ${participant.display_name} → ${oldAmount == null ? "—" : brl(oldAmount)}`);
    if (!previous.is_buyout) await logCurrentLeader(dispatch.auction_id);
    return;
  }

  if (previous?.active && previous.option_label === selected.label) return;
  const amount = Number(selected.amount);
  const isBuyout = Boolean(selected.isBuyout || /ARREMATE/i.test(String(selected.label)) || String(selected.label).includes("🔥"));
  const type = isBuyout ? "BUYOUT_CONFIRMED" : previous?.active ? "BID_CHANGED" : "BID_PLACED";
  const eventId = `wa-vote:${stablePart}:${amount}`.slice(0, 200);

  try {
    const result = await processCommand({ type, eventId, auctionId: dispatch.auction_id, participantId: participant.id, ...(isBuyout ? {} : { amount }), occurredAt });
    await saveVoteState(previous, { auction_id: dispatch.auction_id, voter_jid: voterJid, participant_id: participant.id, option_label: selected.label, amount, is_buyout: isBuyout, active: true, last_event_id: eventId, last_event_at: occurredAt });
    const contact = participant.phone_e164 ? ` (${participant.phone_e164})` : "";
    if (isBuyout) {
      console.log(`🔥 ARREMATE: ${participant.display_name}${contact} → ${brl(result?.auction?.final_price ?? amount)}`);
      const { group, card } = await fetchAuctionContext(dispatch);
      await sock.sendMessage(group.group_jid, { text: `🏆 *ARREMATADO!*\n\n🃏 ${card.name}\n👤 ${participant.display_name}\n💰 ${brl(result?.auction?.final_price ?? amount)}` });
    } else if (previous?.active) {
      console.log(`🔄 Voto alterado: ${participant.display_name}${contact} → ${brl(previous.amount)} → ${brl(amount)}`);
      await logCurrentLeader(dispatch.auction_id);
    } else {
      console.log(`🗳️ Voto recebido: ${participant.display_name}${contact} → ${brl(amount)}`);
      await logCurrentLeader(dispatch.auction_id);
    }
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("auction_not_open") || message.includes("deadline_expired") || message.includes("participant_not_eligible") || message.includes("stale_event") || message.includes("bid_increment_required")) {
      const rejectedType = isBuyout && message.includes("auction_not_open") ? "BUYOUT_LOST_RACE" : "WHATSAPP_VOTE_REJECTED";
      const { data: closedAuction } = isBuyout ? await db.from("auctions").select("winner_participant_id,final_price,status").eq("id", dispatch.auction_id).maybeSingle() : { data: null };
      await auditLateVote(dispatch.auction_id, participant.id, rejectedType, eventId, { voter_jid: voterJid, phone_e164: participant.phone_e164, display_name: participant.display_name, option: selected.label, amount, reason: message.slice(0, 300), winner_participant_id: closedAuction?.winner_participant_id ?? null, final_price: closedAuction?.final_price ?? null, event_at: occurredAt });
      console.log(`${isBuyout ? "🥈 ARREMATE posterior" : "⚠️ Voto rejeitado"}: ${participant.display_name}${participant.phone_e164 ? ` (${participant.phone_e164})` : ""} → ${selected.label}`);
      return;
    }
    throw error;
  }
}

async function loadDispatchForPoll(pollMessageId) {
  const cached = pollMessageCache.get(pollMessageId);
  if (cached?.ready && cached.dispatch) return { dispatch: cached.dispatch, cached };
  const primary = await db.from("whatsapp_dispatches").select("*").eq("poll_message_id", pollMessageId).maybeSingle();
  if (primary.error) throw new Error(primary.error.message);
  if (primary.data) return { dispatch: primary.data, cached };
  const remote = await db.from("whatsapp_dispatches").select("*").eq("poll_remote_message_id", pollMessageId).maybeSingle();
  if (remote.error) throw new Error(remote.error.message);
  return { dispatch: remote.data ?? null, cached };
}

async function processIncomingPollMessage(message) {
  const creationKey = message?.message?.pollUpdateMessage?.pollCreationMessageKey;
  const pollMessageId = creationKey?.id;
  if (!pollMessageId) return;

  const cached = pollMessageCache.get(pollMessageId);
  if (cached && !cached.ready) {
    const waiting = pendingPollVotes.get(pollMessageId) ?? [];
    waiting.push(message);
    pendingPollVotes.set(pollMessageId, waiting);
    return;
  }

  const loaded = await loadDispatchForPoll(pollMessageId);
  const dispatch = loaded.dispatch;
  if (!dispatch?.poll_message_json && !loaded.cached?.message) {
    console.warn(`Voto recebido para enquete desconhecida: ${pollMessageId}`);
    return;
  }

  const pollMessage = loaded.cached?.message || reviveStoredMessage(dispatch.poll_message_json);
  const pollKey = loaded.cached?.key || {
    id: pollMessageId,
    remoteJid: creationKey.remoteJid,
    remoteJidAlt: creationKey.remoteJidAlt,
    participant: creationKey.participant,
    participantAlt: creationKey.participantAlt,
    fromMe: creationKey.fromMe,
  };

  try {
    const decrypted = await decryptIncomingPollVote({ sock, message, pollMessage, pollKey });
    if (!decrypted) return;
    await handlePollVote(dispatch, decrypted.pollUpdate, pollMessage);
  } catch (error) {
    const diagnostic = error?.diagnostic ?? {};
    console.warn("Falha real ao descriptografar/processar voto:", {
      message: error?.message || String(error),
      pollMessageId: diagnostic.pollMessageId || pollMessageId,
      fromMe: diagnostic.fromMe ?? Boolean(message?.key?.fromMe),
      creatorCandidates: diagnostic.creatorCandidates,
      voterCandidates: diagnostic.voterCandidates,
    });
  }
}

async function enrichParticipantFromMessage(message) {
  const groupJid = String(message?.key?.remoteJid ?? "");
  if (!trackedGroupJids.has(groupJid) || message?.message?.pollUpdateMessage) return;
  const senderJids = uniqueUserJids([message?.key?.participant, message?.key?.participantAlt]);
  const now = Date.now();
  if (senderJids.length && senderJids.every(jid => {
    const at = enrichmentMemo.get(jid);
    return at != null && now - at < ENRICHMENT_TTL_MS;
  })) return; // resolved recently: no wire call, no RPC
  const identity = await resolveVoterIdentity({ pollUpdateMessageKey: message.key });
  if (!identity) return;
  if (message.pushName && fallbackIdentityName(identity.displayName)) identity.displayName = message.pushName;
  await ensureParticipant(identity);
  for (const jid of uniqueUserJids([identity.voterJid, identity.rawJid, ...(identity.aliases ?? [])])) {
    enrichmentMemo.set(jid, now);
  }
}

async function handleIncomingMessages(messages) {
  for (const message of messages ?? []) {
    rememberMessageSender(message);
    if (message?.message?.pollUpdateMessage?.pollCreationMessageKey?.id) {
      await processIncomingPollMessage(message);
    } else {
      try { await enrichParticipantFromMessage(message); }
      catch (error) { console.warn("Falha ao enriquecer participante por mensagem:", error?.message || error); }
    }
  }
}

async function finalizeDueAuctions() {
  if (!sock || finalizeBusy) return;
  finalizeBusy = true;
  try {
    const now = new Date().toISOString();
    const { data: auctions, error } = await db.from("auctions").select("id,card_id,whatsapp_group_id,scheduled_end_at").eq("status", "open").not("scheduled_end_at", "is", null).lte("scheduled_end_at", now).order("scheduled_end_at").limit(10);
    if (error) throw error;
    for (const auction of auctions ?? []) {
      const eventId = `bot-finalize:${auction.id}:${auction.scheduled_end_at}`.slice(0, 200);
      try {
        const result = await processCommand({ type: "AUCTION_FINALIZE", eventId, auctionId: auction.id });
        const finalAuction = result?.auction;
        if (!auction.whatsapp_group_id) continue;
        const { data: card } = await db.from("cards").select("name").eq("id", auction.card_id).single();
        if (finalAuction?.winner_participant_id) {
          const { data: winner } = await db.from("participants").select("display_name,phone_e164").eq("id", finalAuction.winner_participant_id).single();
          // Tie transparency: when 2+ active bids share the winning amount,
          // the database crowns the EARLIEST vote — say so in the announcement.
          const { count: tiedAtPrice } = await db.from("bids")
            .select("id", { count: "exact", head: true })
            .eq("auction_id", auction.id)
            .eq("status", "active")
            .eq("amount", finalAuction.final_price);
          const tieNote = finalAuction.win_type === "highest_bid" && (tiedAtPrice ?? 0) > 1
            ? "\n⚖️ Empate no valor: venceu quem deu o lance primeiro."
            : "";
          console.log(`⏰ Leilão encerrado: ${winner?.display_name ?? "Participante"} venceu por ${brl(finalAuction.final_price)}${(tiedAtPrice ?? 0) > 1 ? " (empate: lance mais antigo)" : ""}`);
          await sock.sendMessage(auction.whatsapp_group_id, { text: `🏁 *Leilão encerrado!*\n\n🃏 ${card?.name ?? "Carta"}\n👤 Vencedor: ${winner?.display_name ?? "Participante"}\n💰 ${brl(finalAuction.final_price)}${tieNote}` });
        } else {
          console.log("⏰ Leilão encerrado: sem comprador");
          await sock.sendMessage(auction.whatsapp_group_id, { text: `🏁 Leilão de *${card?.name ?? "carta"}* encerrado sem lances válidos.` });
        }
      } catch (error) {
        if (!String(error?.message || error).includes("auction_not_open")) console.error("Falha ao finalizar leilão:", error?.message || error);
      }
    }
  } finally { finalizeBusy = false; }
}

async function connect() {
  // Each socket gets its own retry guard; a failed replacement must retry too.
  let reconnecting = false;
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  sock = makeWASocket({ auth: state, logger, markOnlineOnConnect: false, syncFullHistory: false, emitOwnEvents: true, getMessage: getStoredPollMessage });
  const activeSocket = sock;

  // Fila persistente de disparos (Fase 3): sobe uma vez por processo, no
  // MESMO processo que é dono do socket. O Redis guarda os jobs entre
  // reinícios; o processor espera a reconexão em vez de falhar.
  if (queueEnabled() && !dispatchQueue) {
    try {
      dispatchQueue = startQueueWorker({
        fetchDispatch: fetchDispatchById,
        isSocketReady: () => socketReady,
        send: sendDispatch,
        markFailed: markDispatchFailed,
        heartbeat: heartbeatDispatchClaim,
        log: (...args) => console.log(...args),
      });
      console.log("🗂️  Fila de disparos persistente ativa (BullMQ/Redis).");
    } catch (error) {
      console.warn(`Fila persistente indisponível (${error?.message || error}); usando envio direto.`);
      dispatchQueue = null;
    }
  }
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("contacts.upsert", contacts => contacts.forEach(rememberContact));
  sock.ev.on("contacts.update", contacts => contacts.forEach(rememberContact));
  sock.ev.on("messages.upsert", ({ messages }) => {
    voteQueue = voteQueue.then(() => handleIncomingMessages(messages)).catch(error => console.error("Falha na fila de mensagens/votos:", error?.message || error));
  });
  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (sock !== activeSocket) return;
    if (qr) {
      console.log("\nLeia o QR Code pelo WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      reconnecting = false;
      socketReady = true;
      console.log(`\n✅ WhatsApp conectado. Worker: ${WORKER_ID}`);
      console.log("Aguardando agendamentos e votos...\n");
      clearInterval(schedulerTimer);
      schedulerTimer = setInterval(() => { void runScheduler(); void finalizeDueAuctions(); void adminNotificationDrain.tick(); }, 3000);
      void syncOpenAuctionGroups().catch(error => console.warn("Falha ao sincronizar grupos abertos:", error?.message || error));
      void runScheduler();
      void finalizeDueAuctions();
    }
    if (connection === "close") {
      socketReady = false;
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
        setTimeout(() => void connect().catch(error => {
          console.error("Falha ao recriar conexão:", error?.message || error);
          process.exit(1); // Let the supervisor retry instead of staying disconnected.
        }), 5000);
      }
    }
  });
}

process.on("SIGINT", async () => {
  clearInterval(schedulerTimer);
  console.log("\nEncerrando bot...");
  if (dispatchQueue) await dispatchQueue.close();
  await sleep(100);
  process.exit(0);
});

connect().catch(error => {
  console.error("Erro fatal:", error?.message || error);
  process.exit(1);
});
