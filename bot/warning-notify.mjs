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
            // Terminal: QUEM, em qual enquete/lote e quais valores — o operador
            // acompanha ao vivo sem abrir o painel.
            console.log(`⚠️ 3 AVISOS: ${String(payload.participant_name ?? "Participante")} — última redução no lote ${payload.lot_number ?? "—"} (${payload.card_name ?? "Carta"}): ${brl(payload.previous_amount)} → ${brl(payload.new_amount)} · DM enviada a ${sentTo.length} admin(s).`);
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
