import { Worker, Queue } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { dispatchMessageId, dispatchPollSecret } from './dispatch-id.mjs';
import { buildAuctionCaption } from './format.mjs';
import { syncGroupParticipants } from './group-participants.mjs';
import { normalizeUserJid } from './poll-identities.mjs';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BOT_ADMIN_USER_ID'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Variável obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USER_ID = process.env.BOT_ADMIN_USER_ID;
const WORKER_ID = process.env.BOT_WORKER_ID || `queue-worker-${process.pid}`;
const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || './sessao';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const logger = pino({ level: process.env.BOT_LOG_LEVEL || 'info' });

const connection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
};

const DISPATCH_QUEUE_NAME = 'whatsapp-dispatches';
const dispatchQueue = new Queue(DISPATCH_QUEUE_NAME, { connection });

let sock = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const contactNames = new Map();
const pollMessageCache = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function storageValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(storageValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, storageValue(item)]));
  }
  return value;
}

function reviveStoredMessage(value) {
  const revived = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  const secret = revived?.messageContextInfo?.messageSecret;
  if (typeof secret === 'string') {
    try {
      const bytes = Buffer.from(secret, 'base64');
      if (bytes.length === 32) revived.messageContextInfo.messageSecret = bytes;
    } catch {}
  }
  return revived;
}

function serializeMessage(value) {
  return storageValue(value);
}

function jidDigits(jid) {
  const local = String(jid ?? '').split('@')[0].split(':')[0];
  return /^\d{8,15}$/.test(local) ? local : null;
}

function phoneFromWhatsAppJid(jid) {
  const local = String(jid ?? '').split('@')[0];
  return local.startsWith('+') ? local : `+${local}`;
}

function uniqueUserJids(values) {
  return [...new Set(values.map(normalizeUserJid).filter(jid => jid && !String(jid).endsWith('@g.us')))];
}

function rememberContact(contact) {
  const name = String(contact?.notify || contact?.name || contact?.verifiedName || contact?.pushName || contact?.username || '').trim();
  if (!name) return;
  for (const jid of uniqueUserJids([contact?.id, contact?.lid, contact?.phoneNumber])) {
    contactNames.set(jid, name);
  }
}

async function getStoredPollMessage(key) {
  if (!key?.id) return undefined;
  const cached = pollMessageCache.get(key.id);
  if (cached?.message) return cached.message;
  const { data, error } = await db.from('whatsapp_dispatches').select('poll_message_json').eq('poll_message_id', key.id).maybeSingle();
  if (error || !data?.poll_message_json) return undefined;
  return reviveStoredMessage(data.poll_message_json);
}

async function ensureParticipant(identity) {
  const identities = uniqueUserJids([identity.voterJid, identity.rawJid, ...(identity.aliases ?? [])]);
  const { data, error } = await db.rpc('resolve_whatsapp_participant', {
    p_identities: identities,
    p_phone_e164: identity.phoneE164 || null,
    p_display_name: identity.displayName || 'Participante WhatsApp',
    p_seen_at: new Date().toISOString(),
  });
  if (error || !data) throw new Error(error?.message || 'participant_resolve_failed');
  return data;
}

async function syncAuctionGroup(groupJid) {
  try {
    const result = await syncGroupParticipants({ sock, groupJid, contactNames, ensureParticipant });
    logger.info(`👥 Grupo sincronizado: ${result.subject} · ${result.synced}/${result.total} membros identificados`);
    return result;
  } catch (error) {
    logger.warn('Não foi possível sincronizar participantes do grupo:', error?.message || error);
    return null;
  }
}

async function fetchAuctionContext(dispatch) {
  const [{ data: group, error: groupError }, { data: auction, error: auctionError }] = await Promise.all([
    db.from('whatsapp_groups').select('id,group_jid,name,active').eq('id', dispatch.group_id).single(),
    db.from('auctions').select('*').eq('id', dispatch.auction_id).single(),
  ]);
  if (groupError || !group?.active) throw new Error('whatsapp_group_unavailable');
  if (auctionError || !auction) throw new Error('auction_not_found');
  const { data: card, error: cardError } = await db.from('cards').select('*').eq('id', auction.card_id).single();
  if (cardError || !card) throw new Error('card_not_found');
  return { group, auction, card };
}

async function persistDispatchMessageIds(dispatch) {
  const announcementMessageId = dispatch.announcement_message_id || dispatchMessageId(dispatch.id, 'announcement');
  const pollMessageId = dispatch.poll_message_id || dispatchMessageId(dispatch.id, 'poll');
  if (dispatch.announcement_message_id === announcementMessageId && dispatch.poll_message_id === pollMessageId) {
    return { ...dispatch, announcement_message_id: announcementMessageId, poll_message_id: pollMessageId };
  }
  const { data, error } = await db.from('whatsapp_dispatches').update({
    announcement_message_id: announcementMessageId,
    poll_message_id: pollMessageId,
    updated_at: new Date().toISOString(),
  }).eq('id', dispatch.id).select('*').single();
  if (error || !data) throw new Error(error?.message || 'dispatch_message_ids_failed');
  return data;
}

async function sendDispatch(claimedDispatch) {
  if (!isConnected || !sock) {
    throw new Error('socket_not_connected');
  }

  let dispatch = await persistDispatchMessageIds(claimedDispatch);
  const { group, auction, card } = await fetchAuctionContext(dispatch);
  
  if (!['draft', 'open'].includes(auction.status)) throw new Error('auction_not_publishable');
  const options = Array.isArray(dispatch.poll_options) ? dispatch.poll_options : [];
  if (!options.length || options.length > 12) throw new Error('invalid_poll_options');
  const caption = buildAuctionCaption(card, auction);

  if (!dispatch.announcement_sent_at) {
    const announcement = card.image_url
      ? await sock.sendMessage(group.group_jid, { image: { url: card.image_url }, caption }, { messageId: dispatch.announcement_message_id })
      : await sock.sendMessage(group.group_jid, { text: caption }, { messageId: dispatch.announcement_message_id });
    if (!announcement?.key?.id) throw new Error('announcement_send_failed');
    const sentAt = new Date().toISOString();
    const { error } = await db.from('whatsapp_dispatches').update({ announcement_sent_at: sentAt, updated_at: sentAt }).eq('id', dispatch.id);
    if (error) throw new Error(error.message);
    dispatch = { ...dispatch, announcement_sent_at: sentAt };
  }

  if (!dispatch.poll_sent_at || !dispatch.poll_message_json) {
    const poll = await sock.sendMessage(group.group_jid, {
      poll: {
        name: dispatch.poll_title,
        values: options.map(option => String(option.label)),
        selectableCount: 1,
        messageSecret: dispatchPollSecret(dispatch.id),
      },
    }, { messageId: dispatch.poll_message_id });
    if (!poll?.key?.id || !poll.message) throw new Error('poll_send_failed');
    const sentAt = new Date().toISOString();
    const realPollMessageId = poll.key.id;
    const serializedPoll = serializeMessage(poll.message);
    dispatch = { ...dispatch, poll_message_id: realPollMessageId, poll_message_json: serializedPoll, poll_sent_at: sentAt };
    pollMessageCache.set(realPollMessageId, { key: poll.key, message: poll.message, dispatch, ready: false });
    const { error } = await db.from('whatsapp_dispatches').update({
      poll_message_id: realPollMessageId,
      poll_message_json: serializedPoll,
      poll_sent_at: sentAt,
      updated_at: sentAt,
    }).eq('id', dispatch.id);
    if (error) throw new Error(error.message);
  }

  if (auction.status === 'draft') {
    const { data, error } = await db.rpc('process_auction_command', { p_command: { type: 'AUCTION_OPEN', eventId: `wa-open:${dispatch.id}`, auctionId: auction.id }, p_admin_user_id: ADMIN_USER_ID });
    if (error) throw new Error(error.message);
  }
  await db.from('auctions').update({
    whatsapp_group_id: group.group_jid,
    poll_id: dispatch.poll_message_id,
    message_id: dispatch.announcement_message_id,
    updated_at: new Date().toISOString(),
  }).eq('id', auction.id);

  const now = new Date().toISOString();
  const { data: sentDispatch, error } = await db.from('whatsapp_dispatches').update({
    status: 'sent',
    sent_at: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    updated_at: now,
  }).eq('id', dispatch.id).select('*').single();
  if (error) throw new Error(error.message);
  dispatch = sentDispatch || { ...dispatch, status: 'sent', sent_at: now };

  const cached = pollMessageCache.get(dispatch.poll_message_id);
  if (cached) pollMessageCache.set(dispatch.poll_message_id, { ...cached, dispatch, ready: true });
  logger.info(`📤 Enquete enviada: ${card.name} → ${group.name}`);
  void syncAuctionGroup(group.group_jid);
  
  return dispatch;
}

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR, logger);
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger,
    browser: ['Leilão Pokémon Bot', 'Chrome', '120.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      logger.info('📱 QR Code disponível para escaneamento');
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = 
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut &&
        reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
      
      if (shouldReconnect) {
        reconnectAttempts++;
        logger.info(`🔄 Reconectando... tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        await sleep(5000 * Math.min(reconnectAttempts, 5));
        await connectWhatsApp();
      } else {
        logger.error('❌ Conexão encerrada. Reinicie o worker.');
        process.exit(1);
      }
    } else if (connection === 'open') {
      isConnected = true;
      reconnectAttempts = 0;
      logger.info('✅ WhatsApp conectado com sucesso');
    }
  });

  sock.ev.on('contacts.upsert', contacts => {
    for (const contact of contacts) rememberContact(contact);
  });
}

const worker = new Worker(DISPATCH_QUEUE_NAME, async (job) => {
  const dispatch = job.data.dispatch;
  const attempt = job.attemptsMade + 1;
  
  logger.info(`📬 Processando dispatch ${dispatch.id} (tentativa ${attempt})`);

  if (!isConnected || !sock) {
    logger.warn('⚠️ Socket não conectado, aguardando reconexão...');
    await sleep(5000);
    throw new Error('socket_not_connected');
  }

  try {
    await sendDispatch(dispatch);
    logger.info(`✅ Dispatch ${dispatch.id} concluído com sucesso`);
    return { success: true, dispatchId: dispatch.id };
  } catch (error) {
    logger.error(`❌ Erro no dispatch ${dispatch.id}:`, error?.message || error);
    
    if (error?.message === 'socket_not_connected') {
      logger.info('⏳ Aguardando reconexão do socket antes de retry...');
      await sleep(10000);
    }
    
    throw error;
  }
}, {
  connection,
  limiter: {
    max: 5,
    duration: 10000,
  },
});

worker.on('completed', (job) => {
  logger.info(`✅ Job ${job.id} completado`);
});

worker.on('failed', (job, err) => {
  logger.error(`❌ Job ${job?.id} falhou:`, err?.message || err);
  
  if (job && job.attemptsMade >= 5) {
    logger.error(`🚫 Job ${job.id} atingiu máximo de tentativas, marcando como failed no banco`);
    db.from('whatsapp_dispatches').update({
      status: 'failed',
      last_error: err?.message || 'max_attempts_reached',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    }).eq('id', job.data.dispatch.id);
  }
});

worker.on('error', (err) => {
  logger.error('❌ Erro no worker:', err?.message || err);
});

logger.info(`🚀 Queue worker iniciado (${WORKER_ID})`);
logger.info(`📍 Redis: ${REDIS_HOST}:${REDIS_PORT}`);
logger.info(`📦 Fila: ${DISPATCH_QUEUE_NAME}`);

await connectWhatsApp();

process.on('SIGINT', async () => {
  logger.info('🛑 Recebido SIGINT, fechando worker...');
  await worker.close();
  await dispatchQueue.close();
  if (sock) sock.end(undefined);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Recebido SIGTERM, fechando worker...');
  await worker.close();
  await dispatchQueue.close();
  if (sock) sock.end(undefined);
  process.exit(0);
});
