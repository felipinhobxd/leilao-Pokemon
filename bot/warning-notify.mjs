// Avisos globais: disparo da notificação aos administradores.
//
// O CONTADOR é global por participante e vive no banco
// (public.participant_warnings, idempotente por external_event_id): o RPC
// process_auction_command grava 1 aviso por redução REAL de valor e, quando o
// participante chega a EXATAMENTE 3, insere UMA linha em admin_notifications
// (também idempotente). Este módulo apenas ENTREGA a mensagem via WhatsApp:
// - marca sent_at só depois de enviar para TODOS os administradores;
// - rastreia payload.sent_to para um retry não reenviar a quem já recebeu
//   (falha parcial nunca gera DM duplicado);
// - in-flight guard + intervalo mínimo para não bombardear o banco.
import { createClient } from "@supabase/supabase-js";

export function parseAdminJids(raw) {
  const value = String(raw ?? process.env.BOT_ADMIN_WA_JIDS ?? "");
  return value.split(/[,\s]+/).map(item => item.trim()).filter(Boolean);
}

export const DEFAULT_ADMIN_JIDS = [
  "554197285978@s.whatsapp.net",
  "5519989759121@s.whatsapp.net",
];

const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  .format(Number(value ?? 0))
  .replace(/[\u00A0\u202F]/g, " ");
const dateTime = value => {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(date);
};

export function formatWarningNotification(payload) {
  const data = payload ?? {};
  const name = String(data.participant_name ?? "Participante").trim() || "Participante";
  const total = Number(data.total_warnings ?? 0);
  const lines = [
    "⚠️ USUÁRIO ATINGIU 3 AVISOS",
    "",
    `Usuário: ${name}`,
    `Total de avisos: ${total} (contador GLOBAL — acumula em todos os leilões)`,
    "",
    "Última ocorrência:",
    `Carta: ${String(data.card_name ?? "—")}`,
    data.lot_number != null ? `Enquete / Lote: ${data.lot_number}` : "Enquete / Lote: —",
    `Valor anterior: ${brl(data.previous_amount)}`,
    `Novo valor: ${brl(data.new_amount)}`,
    `Horário: ${dateTime(data.event_at)}`,
  ];
  const history = Array.isArray(data.warnings) ? data.warnings : [];
  if (history.length > 1) {
    lines.push("", "Avisos anteriores:");
    history.slice(0, -1).forEach((warning, index) => {
      lines.push(`${index + 1}º — ${String(warning.card_name ?? "Carta")} — ${brl(warning.previous_amount)} → ${brl(warning.new_amount)}`);
    });
  }
  return lines.join("\n");
}

export function createAdminNotificationDrain({ db, getSocket, adminJids = DEFAULT_ADMIN_JIDS, intervalMs = 15_000 }) {
  let inFlight = false;
  let lastTick = 0;
  return {
    async tick(nowMs = Date.now()) {
      if (inFlight || nowMs - lastTick < intervalMs) return 0;
      inFlight = true;
      lastTick = nowMs;
      try {
        const sock = getSocket?.();
        if (!sock || !adminJids.length) return 0;
        const { data: pending, error } = await db.from("admin_notifications")
          .select("id,participant_id,kind,payload,external_event_id,created_at")
          .is("sent_at", null)
          .order("created_at", { ascending: true })
          .limit(3);
        if (error) throw new Error(error.message);
        let delivered = 0;
        for (const notification of pending ?? []) {
          const payload = notification.payload ?? {};
          const alreadySent = new Set(Array.isArray(payload.sent_to) ? payload.sent_to : []);
          const remaining = adminJids.filter(jid => !alreadySent.has(jid));
          const sentNow = [];
          for (const jid of remaining) {
            try {
              await sock.sendMessage(jid, { text: formatWarningNotification(payload) });
              sentNow.push(jid);
            } catch (error) {
              console.error(`Aviso global: falha ao notificar ${jid}:`, error?.message || error);
            }
          }
          // Persiste progressivamente: um retry reenvia APENAS para quem não
          // recebeu (falha parcial nunca duplica DM).
          const sentTo = [...alreadySent, ...sentNow];
          const everyone = adminJids.every(jid => sentTo.includes(jid));
          const { error: updateError } = await db.from("admin_notifications")
            .update({ payload: { ...payload, sent_to: sentTo }, sent_at: everyone ? new Date().toISOString() : null })
            .eq("id", notification.id);
          if (updateError) throw new Error(updateError.message);
          if (everyone) {
            delivered += 1;
            console.log(`⚠️ Aviso global entregue (${notification.external_event_id}) para ${sentTo.length} administrador(es).`);
          }
        }
        return delivered;
      } catch (error) {
        console.error("Aviso global: falha ao processar notificações:", error?.message || error);
        return 0;
      } finally {
        inFlight = false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// DM do AVISO para o PRÓPRIO participante (pedido do operador 2026-09-24):
// quem reduz o próprio lance recebe, na hora, qual enquete/lote, os valores e
// o horário — e em que aviso está (de 3; aos 3 os admins são notificados).
// A regra dos 3 em si não muda: o contador continua global e por redução.
// ---------------------------------------------------------------------------
export function formatParticipantWarning(warning, count) {
  const data = warning ?? {};
  const total = Number.isFinite(Number(count)) && Number(count) > 0 ? Number(count) : 1;
  const lines = [
    "⚠️ AVISO DE ALTERAÇÃO DE LANCE",
    "",
    data.lot_number != null
      ? `Você diminuiu o seu lance na enquete do lote ${data.lot_number} (${String(data.card_name ?? "Carta")}):`
      : `Você diminuiu o seu lance na enquete (${String(data.card_name ?? "Carta")}):`,
    `• De: ${brl(data.previous_amount)}`,
    `• Para: ${brl(data.new_amount)}`,
    `• Horário: ${dateTime(data.occurred_at)}`,
    "",
    total >= 3
      ? `Este é o seu aviso nº ${total}. Os administradores já foram notificados.`
      : `Este é o seu aviso ${total} de 3 — ao atingir 3, os administradores são notificados.`,
  ];
  return lines.join("\n");
}

export function createParticipantWarningDrain({ db, getSocket, resolveJid, intervalMs = 15_000 }) {
  let inFlight = false;
  let lastTick = 0;
  return {
    async tick(nowMs = Date.now()) {
      if (inFlight || nowMs - lastTick < intervalMs) return 0;
      inFlight = true;
      lastTick = nowMs;
      try {
        const sock = getSocket?.();
        if (!sock) return 0;
        // notificado=false: coluna notified_at adicionada na 20260924180000.
        const { data: pending, error } = await db.from("participant_warnings")
          .select("id,participant_id,auction_id,card_name,lot_number,previous_amount,new_amount,external_event_id,occurred_at")
          .is("notified_at", null)
          .order("occurred_at", { ascending: true })
          .limit(3);
        if (error) throw new Error(error.message);
        let delivered = 0;
        for (const warning of pending ?? []) {
          // K = posição deste aviso no contador GLOBAL do usuário (mesma
          // régua que dispara a notificação dos admins no 3º).
          const { count, error: countError } = await db.from("participant_warnings")
            .select("id", { count: "exact", head: true })
            .eq("participant_id", warning.participant_id)
            .lte("occurred_at", warning.occurred_at);
          if (countError) throw new Error(countError.message);
          let done = false;
          const jid = resolveJid ? await resolveJid(warning.participant_id) : null;
          if (jid) {
            try {
              await sock.sendMessage(jid, { text: formatParticipantWarning(warning, count) });
              delivered += 1;
              done = true;
              console.log(`⚠️ DM de aviso entregue ao participante ${warning.participant_id} (${warning.external_event_id}).`);
            } catch (error) {
              console.error(`Aviso: falha na DM ao participante ${warning.participant_id}:`, error?.message || error);
            }
          } else {
            // Sem JID de telefone resolvível a DM é impossível: marca para não
            // rodar em círculo — o aviso CONTINUA contando (banco + admins).
            console.warn(`Aviso: participante ${warning.participant_id} sem JID para DM — aviso registrado sem aviso direto.`);
            done = true;
          }
          // notified_at só depois de decidir a entrega (crash → reenvio).
          if (done) {
            const { error: updateError } = await db.from("participant_warnings")
              .update({ notified_at: new Date().toISOString() })
              .eq("id", warning.id);
            if (updateError) throw new Error(updateError.message);
          }
        }
        return delivered;
      } catch (error) {
        console.error("Aviso: falha ao drenar avisos de participantes:", error?.message || error);
        return 0;
      } finally {
        inFlight = false;
      }
    },
  };
}
