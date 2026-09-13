import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  getAggregateVotesInPollMessage,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import qrcode from "qrcode-terminal";

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

function voterFromUpdate(update) {
  const key = update?.pollUpdateMessageKey;
  if (!key) return null;
  if (key.fromMe) return sock?.user?.id ?? null;
  return key.participantAlt || key.participant || key.remoteJidAlt || key.remoteJid || null;
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

async function ensureParticipant(voterJid) {
  const { data: existing, error: selectError } = await db
    .from("participants")
    .select("id,display_name,status,suspension_until")
    .eq("whatsapp_id", voterJid)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) {
    await db.from("participants").update({ last_seen_at: new Date().toISOString() }).eq("id", existing.id);
    return existing;
  }

  const fallbackName = voterJid.split("@")[0] || "Participante WhatsApp";
  const { data: created, error: insertError } = await db
    .from("participants")
    .insert({ whatsapp_id: voterJid, display_name: fallbackName, status: "active" })
    .select("id,display_name,status,suspension_until")
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

function buildAnnouncement(card, auction) {
  const lines = [
    "🥇 *Leilão liberado agora!*",
    "",
    "Essa carta vai para quem der o maior lance:",
    "",
    `🃏 *Carta:* ${card.name}${card.card_number ? ` - ${card.card_number}` : ""}`,
  ];
  if (card.condition) lines.push(`⭐ *Condição:* ${card.condition}`);
  if (card.language) lines.push(`🌐 *Idioma:* ${card.language}`);
  lines.push(`💵 *Lance inicial:* ${brl(auction.starting_price)}`);
  if (auction.buyout_price != null) lines.push(`🏁 *Arremate:* ${brl(auction.buyout_price)}`);
  if (auction.scheduled_end_at) lines.push(`⏰ *Encerra:* ${new Date(auction.scheduled_end_at).toLocaleString("pt-BR")}`);
  lines.push("", "Maior lance leva. A opção 🔥 ARREMATE encerra imediatamente.");
  return lines.join("\n");
}

async function sendDispatch(dispatch) {
  const { group, auction, card } = await fetchAuctionContext(dispatch);
  if (auction.status !== "draft") throw new Error("auction_not_draft");
  const options = Array.isArray(dispatch.poll_options) ? dispatch.poll_options : [];
  if (!options.length || options.length > 12) throw new Error("invalid_poll_options");

  const caption = buildAnnouncement(card, auction);
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
  const voterJid = voterFromUpdate(pollUpdate);
  if (!voterJid || voterJid.endsWith("@g.us")) return;

  const participant = await ensureParticipant(voterJid);
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
      await auditLateVote(dispatch.auction_id, participant.id, "BUYOUT_WITHDRAW_ATTEMPT", eventId, { voter_jid: voterJid, event_at: occurredAt });
    } else {
      try {
        await processCommand({ type: "BID_WITHDRAWN", eventId, auctionId: dispatch.auction_id, participantId: participant.id, occurredAt });
      } catch (error) {
        if (String(error?.message || error).includes("auction_not_open")) {
          await auditLateVote(dispatch.auction_id, participant.id, "BID_WITHDRAWN_AFTER_CLOSE", eventId, { voter_jid: voterJid, event_at: occurredAt });
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
  const isBuyout = Boolean(selected.isBuyout);
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

    console.log(`${isBuyout ? "🔥 ARREMATE" : "💰 Lance"}: ${participant.display_name} → ${brl(amount)}`);

    if (isBuyout) {
      const { group, card } = await fetchAuctionContext(dispatch);
      await sock.sendMessage(group.group_jid, {
        text: `🏆 *ARREMATADO!*\n\n🃏 ${card.name}\n👤 ${participant.display_name}\n💰 ${brl(result?.auction?.final_price ?? amount)}`,
      });
    }
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("auction_not_open") || message.includes("deadline_expired") || message.includes("participant_not_eligible")) {
      await auditLateVote(dispatch.auction_id, participant.id, "WHATSAPP_VOTE_REJECTED", eventId, {
        voter_jid: voterJid,
        option: selected.label,
        amount,
        reason: message.slice(0, 300),
        event_at: occurredAt,
      });
      console.log(`⚠️ Voto rejeitado: ${participant.display_name} → ${selected.label}`);
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
    for (const pollUpdate of update.pollUpdates) {
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
  sock.ev.on("messages.update", updates => void handleMessageUpdates(updates));

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
